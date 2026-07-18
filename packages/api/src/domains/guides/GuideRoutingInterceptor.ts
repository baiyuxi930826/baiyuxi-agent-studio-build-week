/**
 * B-2: Guide Routing Interceptor — decouples guide logic from routing core.
 *
 * Three phases, called at well-defined points by route-serial / route-parallel:
 * 1. prepareGuideContext()  — resolve existing guide state only (before loop)
 * 2. guideContextForAgent()   — decide per-agent injection (inside loop)
 * 3. ackGuideCompletion()   — write completionAcked (after agent output)
 *
 * Routing core stays guide-agnostic: no guide imports, no state machine knowledge.
 */

import type { GuideStateV1 } from '../agents/services/stores/ports/ThreadStore.js';
import type { GuideStateBridge, IGuideSessionStore } from './GuideSessionRepository.js';
import { sessionToLegacyState } from './GuideSessionRepository.js';
import { canAccessGuideState, hasHiddenForeignNonTerminalGuideState } from './guide-state-access.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Matches InvocationContext.guideCandidate in SystemPromptBuilder. */
export interface GuideCandidate {
  id: string;
  name: string;
  estimatedTime: string;
  status: 'offered' | 'awaiting_choice' | 'active' | 'completed';
  isNewOffer?: boolean;
  userSelection?: string;
}

/** Thread shape required by guide interceptor (subset of full thread record). */
interface GuideThread {
  id: string;
  createdBy: string;
  guideState?: GuideStateV1;
  bootcampState?: { phase?: string };
}

/** Internal state produced by prepare(), consumed by inject/ack. */
export interface GuideRoutingContext {
  candidate?: GuideCandidate;
  offerOwner?: string;
  offerSelectionFallback?: string;
  completionOwner?: string;
  completionFallback?: string;
  hiddenForeign: boolean;
}

// ---------------------------------------------------------------------------
// Ownership helpers (moved from route-serial / route-parallel)
// ---------------------------------------------------------------------------

function shouldHandleCompleted(
  completionOwner: string | undefined,
  targetAgentIds: ReadonlySet<string>,
  fallback: string | undefined,
  agentId: string,
): boolean {
  if (!completionOwner) return true;
  if (completionOwner === agentId) return true;
  if (!targetAgentIds.has(completionOwner)) return fallback === agentId;
  return false;
}

function shouldHandleOffered(
  offerOwner: string | undefined,
  targetAgentIds: ReadonlySet<string>,
  fallback: string | undefined,
  agentId: string,
  hasSelection: boolean,
  allowFallback = false,
): boolean {
  if (!offerOwner) return true;
  if (offerOwner === agentId) return true;
  if ((hasSelection || allowFallback) && !targetAgentIds.has(offerOwner)) {
    return fallback === agentId;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Phase 1: Prepare — helpers
// ---------------------------------------------------------------------------

async function resolveRegistryEntry(guideId: string): Promise<{ name: string; estimatedTime: string } | undefined> {
  try {
    const { getRegistryEntries } = await import('./guide-registry-loader.js');
    const entry = getRegistryEntries().find((e) => e.id === guideId);
    if (!entry) return undefined;
    return { name: entry.name, estimatedTime: entry.estimated_time };
  } catch {
    return undefined;
  }
}

function needsFallback(offeredBy: string | undefined, targetAgentIds: ReadonlySet<string>): boolean {
  return offeredBy !== undefined && !targetAgentIds.has(offeredBy);
}

/** Resolve offer/completion ownership into ctx. */
function resolveOwnership(
  gs: GuideStateV1,
  selectionMatch: RegExpMatchArray | null,
  justCompleted: boolean,
  targetAgents: readonly string[],
  targetAgentIds: ReadonlySet<string>,
  ctx: GuideRoutingContext,
): void {
  if (gs.status === 'offered' || gs.status === 'awaiting_choice') {
    ctx.offerOwner = gs.offeredBy;
    if ((selectionMatch || gs.status === 'awaiting_choice') && needsFallback(gs.offeredBy, targetAgentIds)) {
      ctx.offerSelectionFallback = targetAgents[0];
    }
  }
  if (justCompleted) {
    ctx.completionOwner = gs.offeredBy;
    if (needsFallback(gs.offeredBy, targetAgentIds)) {
      ctx.completionFallback = targetAgents[0];
    }
  }
}

/** Build candidate + ownership from existing thread guide state. */
async function resolveExistingCandidate(
  gs: GuideStateV1,
  message: string,
  targetAgents: readonly string[],
  targetAgentIds: ReadonlySet<string>,
  ctx: GuideRoutingContext,
): Promise<void> {
  const justCompleted = gs.status === 'completed' && !gs.completionAcked;
  const shouldInject = (gs.status !== 'completed' && gs.status !== 'cancelled') || justCompleted;
  if (!shouldInject) return;

  const entry = await resolveRegistryEntry(gs.guideId);
  const selectionMatch = message.match(/^引导流程：(.+)$/);
  ctx.candidate = {
    id: gs.guideId,
    name: entry?.name ?? gs.guideId,
    estimatedTime: entry?.estimatedTime ?? '',
    status: gs.status as GuideCandidate['status'],
    ...(gs.status === 'offered' ? { isNewOffer: false } : {}),
    ...(selectionMatch ? { userSelection: selectionMatch[1] } : {}),
  };

  resolveOwnership(gs, selectionMatch, justCompleted, targetAgents, targetAgentIds, ctx);
}

// ---------------------------------------------------------------------------
// Bootcamp → Guide bridge: auto-offer guide at specific bootcamp phases
// ---------------------------------------------------------------------------

/** Maps bootcamp phases to guide IDs that should be auto-offered. */
const BOOTCAMP_PHASE_GUIDE_MAP: Record<string, string> = {
  'phase-7.5-add-teammate': 'bootcamp-add-teammate',
  'phase-10-retro': 'bootcamp-farewell',
};

async function resolveBootcampGuide(
  thread: GuideThread | null | undefined,
  targetAgents: readonly string[],
  ctx: GuideRoutingContext,
  dismissTracker?: import('./GuideDismissTracker.js').IGuideDismissTracker,
): Promise<void> {
  const phase = thread?.bootcampState?.phase;
  if (!phase) return;
  const guideId = BOOTCAMP_PHASE_GUIDE_MAP[phase];
  if (!guideId) return;

  // Respect user dismissal — don't re-offer guides the user explicitly dismissed
  if (dismissTracker && thread) {
    const userId = thread.createdBy ?? 'default-user';
    const counts = await dismissTracker.getDismissCounts(userId, [guideId]).catch((): Record<string, number> => ({}));
    if ((counts[guideId] ?? 0) > 0) return;
  }

  const entry = await resolveRegistryEntry(guideId);
  if (!entry) return;

  ctx.candidate = {
    id: guideId,
    name: entry.name,
    estimatedTime: entry.estimatedTime,
    status: 'offered',
    isNewOffer: true,
  };
  ctx.offerOwner = targetAgents[0];
}

// ---------------------------------------------------------------------------
// Phase 1: Prepare
// ---------------------------------------------------------------------------

/**
 * Resolve existing guide state from thread.
 * Called once before the routing loop. Accepts the already-fetched thread record
 * so the routing core doesn't re-read.
 */
export async function prepareGuideContext(params: {
  thread: GuideThread | null | undefined;
  guideSessionStore?: IGuideSessionStore;
  targetAgents: readonly string[];
  message: string;
  userId: string;
  threadId: string;
  log?: { info: (...args: unknown[]) => void };
  dismissTracker?: import('./GuideDismissTracker.js').IGuideDismissTracker;
}): Promise<GuideRoutingContext> {
  const { thread, guideSessionStore, targetAgents, message, userId, threadId, dismissTracker } = params;
  const targetAgentIds = new Set(targetAgents);
  const ctx: GuideRoutingContext = { hiddenForeign: false };

  // Read guide state from independent store (B-4) or fallback to thread.guideState
  let guideState: GuideStateV1 | undefined;
  if (guideSessionStore) {
    const session = await guideSessionStore.getByThread(threadId).catch(() => null);
    if (session) {
      const legacy = sessionToLegacyState(session);
      ctx.hiddenForeign = hasHiddenForeignNonTerminalGuideState(thread, legacy, userId);
      guideState = canAccessGuideState(thread, legacy, userId) ? legacy : undefined;
    }
  } else if (thread) {
    const threadGuideState = thread.guideState;
    ctx.hiddenForeign = hasHiddenForeignNonTerminalGuideState(thread, threadGuideState, userId);
    guideState = canAccessGuideState(thread, threadGuideState, userId) ? threadGuideState : undefined;
  }

  if (guideState) {
    await resolveExistingCandidate(guideState, message, targetAgents, targetAgentIds, ctx);
  }

  // F171: Bootcamp phase → guide bridge (auto-offer before keyword matching)
  if (!ctx.candidate && !ctx.hiddenForeign) {
    await resolveBootcampGuide(thread, targetAgents, ctx, dismissTracker);
  }

  return ctx;
}

// ---------------------------------------------------------------------------
// Phase 2: Per-agent injection
// ---------------------------------------------------------------------------

/**
 * Returns the guide-related fields to spread into InvocationContext for a specific agent.
 * Empty object means this agent should not see guide state.
 */
export function guideContextForAgent(
  ctx: GuideRoutingContext,
  agentId: string,
  targetAgentIds: ReadonlySet<string>,
  threadId: string,
): { guideCandidate: GuideCandidate; threadId: string } | Record<string, never> {
  const c = ctx.candidate;
  if (!c) return {};

  const eligible =
    c.status === 'completed'
      ? shouldHandleCompleted(ctx.completionOwner, targetAgentIds, ctx.completionFallback, agentId)
      : c.status === 'offered' || c.status === 'awaiting_choice'
        ? shouldHandleOffered(
            ctx.offerOwner,
            targetAgentIds,
            ctx.offerSelectionFallback,
            agentId,
            Boolean(c.userSelection),
            c.status === 'awaiting_choice',
          )
        : true; // active: always inject

  return eligible ? { guideCandidate: c, threadId } : {};
}

// ---------------------------------------------------------------------------
// Phase 3: Completion ack
// ---------------------------------------------------------------------------

/**
 * After a agent produces visible output, ack guide completion so the one-shot
 * congratulation message isn't re-injected on the next turn.
 */
export async function ackGuideCompletion(params: {
  ctx: GuideRoutingContext;
  agentId: string;
  agentProducedOutput: boolean;
  targetAgentIds: ReadonlySet<string>;
  threadId: string;
  userId: string;
  guideStore: GuideStateBridge;
  threadStore: { get(id: string): GuideThread | null | Promise<GuideThread | null> };
}): Promise<void> {
  const { ctx, agentId, agentProducedOutput, targetAgentIds, threadId, userId, guideStore, threadStore } = params;
  if (!agentProducedOutput) return;
  if (ctx.candidate?.status !== 'completed') return;
  if (!shouldHandleCompleted(ctx.completionOwner, targetAgentIds, ctx.completionFallback, agentId)) return;

  try {
    // Re-verify access at ack time (thread for ownership, guideStore for state)
    const [thread, gs] = await Promise.all([threadStore.get(threadId), guideStore.get(threadId)]);
    if (!thread || !gs) return;
    if (!canAccessGuideState(thread, gs, userId)) return;
    if (gs.guideId === ctx.candidate.id && gs.status === 'completed' && !gs.completionAcked) {
      await guideStore.set(threadId, { ...gs, completionAcked: true });
    }
  } catch {
    /* best-effort: ack failure means next turn re-injects, which is acceptable */
  }
}
