import type { AgentId, ReportingMode } from '@agent-studio/shared';
import type { InvocationQueue } from '../domains/agents/services/agents/invocation/InvocationQueue.js';
import type { QueueProcessor } from '../domains/agents/services/agents/invocation/QueueProcessor.js';
import { parseIntent } from '../domains/agents/services/context/IntentParser.js';
import type { AgentRouter } from '../domains/agents/services/index.js';
import type { IMessageStore } from '../domains/agents/services/stores/ports/MessageStore.js';
import { enrichWithParentThreadHeader } from './proposal-enrich-header.js';

export { enrichWithParentThreadHeader } from './proposal-enrich-header.js';

type ProposalRouter = Pick<AgentRouter, 'resolveTargetsAndIntent'>;
type ProposalInvocationQueue = Pick<InvocationQueue, 'enqueue' | 'backfillMessageId' | 'rollbackEnqueue'>;
type ProposalQueueProcessor = Pick<QueueProcessor, 'processNext'>;

function canonicalAgentIdHandle(agentId: string): string {
  return `@${agentId}`;
}

export interface ProposalInitialMessageDispatchDeps {
  router?: ProposalRouter;
  invocationQueue?: ProposalInvocationQueue;
  queueProcessor?: ProposalQueueProcessor;
}

export interface AppendApprovedInitialMessageInput extends ProposalInitialMessageDispatchDeps {
  proposalId: string;
  userId: string;
  threadId: string;
  /**
   * Raw user-typed initialMessage. dispatch is now the single owner of the
   * full plan: it runs router resolve + parseIntent + computes effective
   * targets/intent/reporter, then calls enrichWithParentThreadHeader to
   * build the enqueued+stored content. Routes only pass raw user input +
   * parent thread metadata; dispatch handles every transformation.
   *
   * Why this routing flows through dispatch only (round-9 plan-based):
   *   - parseIntent and router.resolveTargetsAndIntent MUST read raw, not
   *     enriched. enriched content carries server-injected text (parent
   *     title, chain protocol) that can trip both `#tag` and `@-mention`
   *     parsers, causing serial proposals to flip to parallel
   *     (round-2 P2) and parent-title `@agent` mentions to silently wake +
   *     persist into participants (round-3 P2).
   *   - The reporter handle for explicit `#ideate` parallel mode must be
   *     derived from the router's resolved canonical agentId — NOT from a raw `@<token>` regex
   *     (round-7/8 補锅匠 trap: every handle shape — CJK, dotted,
   *     hyphenated — wanted a new charclass). Plan-based ownership in
   *     dispatch is the only place that has both pieces.
   */
  rawInitialMessage: string;
  /** Source thread id — injected into the "## 主 Thread" header. */
  sourceThreadId: string;
  /** Source thread title — optional display in the parent header. */
  sourceThreadTitle?: string | null;
  /**
   * Proposed chain participants in user-intended order.
   *
   * Default behaviour: dispatch wakes ONLY `preferredAgents[0]` (the chain
   * starter); subsequent agents are driven by the agent-side @-mention chain in
   * their own replies — "他们自己决定下一个要把谁叫出来" (owner spec
   * 2026-05-27).
   *
   * Explicit-intent overrides (read from raw initialMessage, NOT enriched):
   *   - `#ideate` tag → wake all `preferredAgents` (or `resolved.targetAgents` if
   *     `preferredAgents` empty) in parallel; chain protocol injection is
   *     suppressed by `enrichWithParentThreadHeader` so agents are not told to
   *     hand off serially while they were woken parallel (砚砚 round-5 P1).
   *   - `#execute` tag with `preferredAgents=[]` and multiple `resolved.targetAgents`
   *     → preserve all router-resolved targets (砚砚 round-5 P2: silently
   *     collapsing to the first target would discard explicit user intent).
   */
  preferredAgents?: readonly AgentId[];
  /** F128 Phase AA (AC-AA1): reporting mode (undefined → enrich default final-only, supersedes AC-Y6 none). */
  reportingMode?: ReportingMode;
  /** Phase AA (AC-AA4): the agent that proposed this thread — seed message author. */
  sourceAgentId?: AgentId | null;
  /** Phase AA (AC-AA5): invocation id from the proposal — for crossPost metadata. */
  sourceInvocationId?: string | null;
  messageStore: IMessageStore;
}

export interface AppendApprovedInitialMessageResult {
  messageId: string;
  warning?: string;
}

export async function appendApprovedInitialMessage({
  proposalId,
  userId,
  threadId,
  rawInitialMessage,
  sourceThreadId,
  sourceThreadTitle,
  preferredAgents,
  reportingMode,
  sourceAgentId,
  sourceInvocationId,
  messageStore,
  router,
  invocationQueue,
  queueProcessor,
}: AppendApprovedInitialMessageInput): Promise<AppendApprovedInitialMessageResult> {
  // Phase AA (AC-AA5): crossPost metadata for frontend pill + jump-to-source
  const crossPostExtra = {
    crossPost: {
      sourceThreadId,
      ...(sourceInvocationId ? { sourceInvocationId } : {}),
    },
  };
  // Phase AA (AC-AA6): use canonical @agentId handles in generated routing
  // instructions so copyable targetAgents values cannot drift through aliases.
  const sourceAgentHandle = sourceAgentId ? canonicalAgentIdHandle(sourceAgentId) : null;
  if (!router || !invocationQueue || !queueProcessor) {
    const enrichedFallback = enrichWithParentThreadHeader(
      rawInitialMessage,
      sourceThreadId,
      sourceThreadTitle,
      preferredAgents,
      rawInitialMessage,
      null,
      canonicalAgentIdHandle,
      reportingMode,
      sourceAgentHandle,
    );
    const stored = await messageStore.append({
      userId,
      agentId: sourceAgentId ?? null, // AC-AA4: source agent is the message author
      content: enrichedFallback,
      mentions: [],
      timestamp: Date.now(),
      threadId,
      extra: crossPostExtra, // AC-AA5: crossPost metadata
    });
    return {
      messageId: stored.id,
      warning: 'initialMessage dispatch skipped: routing dependencies unavailable',
    };
  }

  // Router resolve + parseIntent BOTH read raw (round-2/3 P2 — server-injected
  // header text must NOT leak into the @-mention persist boundary).
  const resolved = await router.resolveTargetsAndIntent(rawInitialMessage, threadId, { persist: true });
  const parsed = parseIntent(rawInitialMessage, preferredAgents?.length ?? resolved.targetAgents.length);

  // F128 dispatch model — "他们自己决定下一个要把谁叫出来" (owner-defined, 2026-05-27):
  //
  // Default behaviour: wake ONLY the first agent. Subsequent turns are driven by
  // agent-side @-mentions in the chain (the first agent reads initialMessage,
  // sees the order/rules, and @s the next agent; that agent does the same).
  // Dispatch does NOT pre-fire all proposedAgents — that would scramble
  // ordering and force a parallel race where the user wants a chain (接龙
  // / 轮转 / 讨论).
  //
  // First-agent preference:
  //   1. preferredAgents[0] — the card's first picked member is the narrative
  //      intent ("you chose them, in this order, the first one starts").
  //   2. router-resolved first mention — fallback when preferredAgents is empty
  //      but the message text @-mentions someone.
  //
  // Explicit #ideate escape hatch: if the user really wants parallel
  // ideation (everyone replies independently at once), they tag #ideate in
  // the initialMessage. That brings back the legacy "wake all" behaviour.
  //
  // 砚砚 round-5 P2 escape hatch: explicit #execute + no preferredAgents +
  // raw text @-mentions multiple agents means the user is asking for serial
  // multi-agent execution (the F088 router contract for #execute outside
  // F128). Silently collapsing to the first target would discard explicit
  // user intent. preferredAgents non-empty still wins (card order is ground
  // truth — first-agent chain starter), but preferredAgents=[] + explicit
  // #execute should preserve all router-resolved targets.
  let targetAgents: readonly AgentId[];
  let intentName: string;
  if (parsed.explicit && parsed.intent === 'ideate') {
    targetAgents = preferredAgents && preferredAgents.length > 0 ? preferredAgents : resolved.targetAgents;
    intentName = 'ideate';
  } else if (
    parsed.explicit &&
    parsed.intent === 'execute' &&
    (!preferredAgents || preferredAgents.length === 0) &&
    resolved.targetAgents.length > 0
  ) {
    targetAgents = resolved.targetAgents;
    intentName = 'execute';
  } else {
    const firstCandidate = preferredAgents?.[0] ?? resolved.targetAgents[0];
    targetAgents = firstCandidate ? [firstCandidate] : [];
    intentName = 'execute';
  }

  // Round-9 plan-based reporter resolution: compute canonical reporter
  // handle from the router-resolved agentId (not raw token regex). This
  // closes the round-7/8 補锅匠 trap — the router has already resolved aliases
  // (CJK / dotted / hyphenated) to canonical agentIds.
  let parallelReporterHandle: string | null = null;
  if (parsed.explicit && parsed.intent === 'ideate') {
    const reporterAgentId = preferredAgents?.[0] ?? resolved.targetAgents[0];
    if (reporterAgentId) {
      parallelReporterHandle = canonicalAgentIdHandle(reporterAgentId);
    }
  }

  // Build the full enqueued+stored content: parent thread header + mode-aware
  // report-back rule + (serial only) chain protocol. dispatch is the single
  // owner of this pipeline; routes only pass raw + parent metadata.
  const content = enrichWithParentThreadHeader(
    rawInitialMessage,
    sourceThreadId,
    sourceThreadTitle,
    preferredAgents,
    rawInitialMessage,
    parallelReporterHandle,
    canonicalAgentIdHandle,
    reportingMode,
    sourceAgentHandle, // Phase AA (AC-AA6): routing credentials
  );

  if (targetAgents.length === 0) {
    const stored = await messageStore.append({
      userId,
      agentId: sourceAgentId ?? null, // AC-AA4
      content,
      mentions: [],
      timestamp: Date.now(),
      threadId,
      extra: crossPostExtra, // AC-AA5
    });
    return {
      messageId: stored.id,
      warning: 'initialMessage dispatch skipped: no target agents resolved',
    };
  }

  const enqueueResult = invocationQueue.enqueue({
    threadId,
    userId,
    idempotencyKey: `proposal-initial:${proposalId}`,
    content,
    source: 'user',
    targetAgents: targetAgents as AgentId[],
    intent: intentName,
  });

  if (enqueueResult.outcome === 'full' || !enqueueResult.entry) {
    const stored = await messageStore.append({
      userId,
      agentId: sourceAgentId ?? null, // AC-AA4
      content,
      mentions: [...targetAgents],
      timestamp: Date.now(),
      threadId,
      extra: crossPostExtra, // AC-AA5
    });
    return {
      messageId: stored.id,
      warning: 'initialMessage dispatch skipped: queue is full',
    };
  }

  let storedMessageId = enqueueResult.entry.messageId ?? null;
  if (!enqueueResult.deduped || !storedMessageId) {
    try {
      const stored = await messageStore.append({
        userId,
        agentId: sourceAgentId ?? null, // AC-AA4
        content,
        mentions: [...targetAgents],
        timestamp: Date.now(),
        threadId,
        idempotencyKey: `proposal-initial:${proposalId}`,
        deliveryStatus: 'queued',
        extra: crossPostExtra, // AC-AA5
      });
      storedMessageId = stored.id;
      invocationQueue.backfillMessageId(threadId, userId, enqueueResult.entry.id, stored.id);
    } catch (err) {
      invocationQueue.rollbackEnqueue(threadId, userId, enqueueResult.entry.id);
      throw err;
    }
  }

  try {
    const started = await queueProcessor.processNext(threadId, userId);
    if (!started.started) {
      return {
        messageId: storedMessageId,
        warning: 'initialMessage queued but did not start automatically',
      };
    }
  } catch (err) {
    return {
      messageId: storedMessageId,
      warning: `initialMessage queued but auto-start failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return { messageId: storedMessageId };
}
