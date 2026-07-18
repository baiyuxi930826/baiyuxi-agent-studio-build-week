/**
 * targetAgents resolver (F229 Phase B)
 *
 * Resolves which agent(s) should receive a relay message for a given thread.
 *
 * Priority order (砚砚 P1: fail-closed, never blind-post):
 * 1. User explicitly specified targetAgents → use directly
 * 2. Thread recent participants (last 3 non-system messages) → candidates
 * 3. feat_index attribution → candidates
 * 4. Candidates > 1 or == 0 → return candidates with needsSelection=true
 *    (UI shows selection card, user picks)
 * 5. Exactly 1 candidate → auto-select
 */

import type { AgentId } from '@agent-studio/shared';
import { agentRegistry } from '@agent-studio/shared';
import type { IMessageStore } from '../agents/services/stores/ports/MessageStore.js';
import type { IThreadStore } from '../agents/services/stores/ports/ThreadStore.js';

export interface TargetAgentsResult {
  /** Resolved target agents (empty if needsSelection + no candidates) */
  targetAgents: string[];
  /** True if user must manually select (ambiguous or empty candidates) */
  needsSelection: boolean;
  /** Source of resolution for audit trail */
  source: 'explicit' | 'participant' | 'feat_index' | 'ambiguous' | 'none';
}

export interface TargetAgentsResolverDeps {
  messageStore: IMessageStore;
  threadStore: IThreadStore;
}

/**
 * Resolve target agents for a relay intent.
 *
 * @param explicitAgents - User-specified target agents (e.g. from @mention in their message)
 * @param threadId - Target thread to relay to
 * @param deps - Store dependencies
 */
export async function resolveTargetAgents(
  explicitAgents: string[] | undefined,
  threadId: string | undefined,
  deps: TargetAgentsResolverDeps,
): Promise<TargetAgentsResult> {
  // 1. User explicitly specified — validate against registry (cloud P2 fix).
  //    Filter out hallucinated/unknown agentIds so they don't reach confirm card.
  //    Guard: skip validation when registry is empty (not yet initialized at startup,
  //    or running in unit tests). Same pattern as agent-config-loader.ts:720.
  if (explicitAgents && explicitAgents.length > 0) {
    const registryPopulated = agentRegistry.getAllIds().length > 0;
    const validAgents = registryPopulated ? explicitAgents.filter((id) => agentRegistry.has(id)) : explicitAgents;
    if (validAgents.length > 0) {
      return { targetAgents: validAgents, needsSelection: false, source: 'explicit' };
    }
    // All explicit agents invalid → fall through to participant/none resolution
  }

  // 2. Thread participant resolution
  if (threadId) {
    const participants = await resolveFromParticipants(threadId, deps);
    if (participants.length === 1) {
      return { targetAgents: participants, needsSelection: false, source: 'participant' };
    }
    if (participants.length > 1) {
      return { targetAgents: participants, needsSelection: true, source: 'ambiguous' };
    }
  }

  // 3. No candidates found
  return { targetAgents: [], needsSelection: true, source: 'none' };
}

/**
 * Get recent non-system agent participants from a thread.
 * Returns unique agentIds from the last 3 agent messages.
 */
async function resolveFromParticipants(threadId: string, deps: TargetAgentsResolverDeps): Promise<string[]> {
  try {
    const participants = await deps.threadStore.getParticipants(threadId);
    // Filter out empty/system entries
    return (participants as AgentId[]).filter((id) => id && id !== 'system');
  } catch {
    return [];
  }
}
