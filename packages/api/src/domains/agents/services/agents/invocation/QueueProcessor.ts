/**
 * QueueProcessor
 * 处理 InvocationQueue 中的排队条目：自动出队 + 暂停管理。
 *
 * 两个入口：
 * - onInvocationComplete（系统级）：invocation 完成后调用，succeeded 时自动出队
 * - processNext（用户级）：co-creator手动触发处理自己的下一条
 */

import { resolveCliTimeoutMs } from '../../../../../utils/cli-timeout.js';
import { emitQueueUpdated, enrichQueueEntries } from '../../../../../utils/queue-enrichment.js';
import { hydrateReplyPreview, type IMessageStore } from '../../stores/ports/MessageStore.js';
import { mergeTokenUsage, type TokenUsage } from '../../types.js';
import {
  accumulateTextAggregate,
  accumulateTextParts,
  flattenTextParts,
  flattenTurnTextParts,
} from '../text-aggregation.js';
import {
  type CollaborationContinuityCapsuleV1,
  extractContinuityCapsuleFromAgentMessage,
  formatContinuationPrompt,
  isCollaborationContinuityCapsuleV1,
} from './CollaborationContinuityCapsule.js';
import type { InvocationQueue, QueueEntry } from './InvocationQueue.js';
import {
  type CommitInvocationInput,
  type ConsumedContinuationToken,
  type InvocationFinalStatus,
  type PrepareInvocationInput,
  type PrepareInvocationResult,
  SessionContinuationCoordinator,
  type SessionStrategy,
} from './SessionContinuationCoordinator.js';
import { stampVisibleTurn } from './visible-turn.js';

/** Minimal interfaces for deps — avoid importing full types for testability */

interface TrackerLike {
  start(threadId: string, agentId: string, userId: string, agentIds?: string[]): AbortController;
  startAll(threadId: string, agentIds: string[], userId?: string): AbortController;
  complete(threadId: string, agentId: string, controller?: AbortController): void;
  completeSlot?(threadId: string, agentId: string, controller?: AbortController): void;
  completeAll(threadId: string, agentIds: string[], controller?: AbortController): void;
  trackExternalSlot?(
    threadId: string,
    agentId: string,
    controller: AbortController,
    userId?: string,
    agentIds?: string[],
  ): boolean;
  has(threadId: string, agentId?: string): boolean;
  /** F-parallel-cancel: expose a slot's own controller for per-agent cancel isolation. */
  getController?(threadId: string, agentId: string): AbortController | undefined;
  /** F-parallel-cancel: aggregate final status — whole-invocation abort vs per-agent cancel. */
  resolveFinalStatus?(
    threadId: string,
    targetAgents: readonly string[],
    batch: { aborted: boolean; reason?: string },
  ): 'succeeded' | 'canceled' | 'canceled_by_user';
}

export interface InvocationRecordStoreLike {
  create(input: Record<string, unknown>): Promise<{ outcome: string; invocationId: string }>;
  update(id: string, data: Record<string, unknown>): Promise<void>;
}

export interface RouterLike {
  routeExecution(
    userId: string,
    content: string,
    threadId: string,
    messageId: string | null,
    targetAgents: string[],
    intent: { intent: string },
    opts?: Record<string, unknown>,
  ): AsyncIterable<{ type: string; agentId?: string; [key: string]: unknown }>;
  ackCollectedCursors(userId: string, threadId: string, cursors: Map<string, string>): Promise<void>;
}

interface SocketManagerLike {
  broadcastAgentMessage(msg: unknown, threadId: string): void;
  broadcastToRoom(room: string, event: string, data: unknown): void;
  emitToUser(userId: string, event: string, data: unknown): void;
}

interface LoggerLike {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

/** #813: Minimal thread store interface for passive continuation. */
export interface ThreadStoreLike {
  getMemberSessionStrategy?(
    threadId: string,
    agentId: string,
    userId: string,
  ): 'resume' | 'reborn' | undefined | Promise<'resume' | 'reborn' | undefined>;
  setPendingContinuation(
    threadId: string,
    agentId: string,
    userId: string,
    entry: { capsule: Record<string, unknown>; createdAt: number },
  ): void | Promise<void>;
  consumePendingContinuation(
    threadId: string,
    agentId: string,
    userId: string,
  ):
    | { capsule: Record<string, unknown>; createdAt: number }
    | null
    | Promise<{ capsule: Record<string, unknown>; createdAt: number } | null>;
  /** #836: Check if a agent uses reborn session strategy in this thread.
   *  Reborn agents skip continuation consume/enqueue — every invocation starts fresh. */
  isRebornSession?(threadId: string, agentId: string): boolean | Promise<boolean>;
}

export interface SessionContinuationCoordinatorLike {
  resolveSessionStrategy?(threadId: string, agentId: string, userId: string): Promise<SessionStrategy>;
  prepareInvocationContext(input: PrepareInvocationInput): Promise<PrepareInvocationResult>;
  commitInvocationOutcome(input: CommitInvocationInput): Promise<void>;
}

/** Minimal outbound delivery interface — avoids importing full OutboundDeliveryHook. */
export interface OutboundDeliveryHookLike {
  deliver(
    threadId: string,
    content: string,
    agentId: string,
    richBlocks?: ReadonlyArray<{ kind: string; [key: string]: unknown }>,
    threadMeta?: { threadShortId?: string; threadTitle?: string; deepLinkUrl?: string },
    origin?: string,
    triggerMessageId?: string,
  ): Promise<void>;
}

/** Minimal streaming outbound interface — avoids importing full StreamingOutboundHook. */
export interface StreamingOutboundHookLike {
  onStreamStart(
    threadId: string,
    agentId: string,
    invocationId: string,
    senderHint?: { id: string; name?: string },
  ): Promise<void>;
  onStreamChunk(threadId: string, accumulatedText: string, invocationId: string): Promise<void>;
  onStreamEnd(threadId: string, finalText: string, invocationId: string): Promise<void>;
  cleanupPlaceholders?(threadId: string, invocationId: string): Promise<void>;
  /** F151: Signal adapters that delivery batch is complete for a thread. */
  notifyDeliveryBatchDone?(threadId: string, chainDone: boolean): Promise<void>;
}

/** Thread metadata for outbound delivery (deep link, title, etc.) */
interface ThreadMetaLike {
  threadShortId?: string;
  threadTitle?: string;
  deepLinkUrl?: string;
}

export interface QueueProcessorDeps {
  queue: InvocationQueue;
  invocationTracker: TrackerLike;
  invocationRecordStore: InvocationRecordStoreLike;
  router: RouterLike;
  socketManager: SocketManagerLike;
  messageStore: IMessageStore;
  log: LoggerLike;
  /** F088 fix: optional outbound delivery hook (late-bound after gateway bootstrap). */
  outboundHook?: OutboundDeliveryHookLike;
  /** F088 fix: optional streaming outbound hook (late-bound after gateway bootstrap). */
  streamingHook?: StreamingOutboundHookLike;
  /** F088 fix: optional thread metadata lookup for outbound delivery. */
  threadMetaLookup?: (threadId: string) => ThreadMetaLike | undefined | Promise<ThreadMetaLike | undefined>;
  /** Outbound delivery timeout in ms (default 10_000). Mirrors ConnectorInvokeTrigger. */
  deliverTimeoutMs?: number;
  /** #813: Thread store for passive continuation (write/consume pending continuation). */
  threadStore?: ThreadStoreLike;
  /** F224: continuation lifecycle coordinator boundary. */
  sessionContinuationCoordinator?: SessionContinuationCoordinatorLike;
}

/** F122B B6: Completion hook — called when a queue entry finishes execution. */
export type EntryCompleteHook = (
  entryId: string,
  status: 'succeeded' | 'failed' | 'canceled' | 'canceled_by_user',
  responseText: string,
) => void;

export type ContinuationEnqueueOutcome =
  | 'enqueued'
  | 'skipped_missing_capsule'
  | 'skipped_invalid_capsule'
  | 'skipped_existing_entry'
  | 'skipped_rate_limited'
  | 'queue_full';

export class QueueProcessor {
  private deps: QueueProcessorDeps;
  /** F108: Per-slot mutex — prevents concurrent double-start per (thread, agent) pair.
   *  F118 D4: Map value = processingStartedAt for zombie detection. */
  private processingSlots = new Map<string, number>();
  /** F108: Per-slot pause tracking (set on canceled/failed, cleared on next execution) */
  private pausedSlots = new Map<string, 'canceled' | 'failed'>();
  private pauseEpoch = new Map<string, number>();
  /** Suppress auto-resume on next canceled_by_user completion (single-shot per slot).
   *  Set by cancelAll handler so user cancel = "stop everything", not "start next".
   *  Map value = timestamp — auto-expires after SUPPRESS_TTL_MS to prevent stale
   *  suppresses from multi-agent cancelAll (secondary agents may never fire onInvocationComplete). */
  private suppressedAutoResume = new Map<string, number>();
  private static readonly SUPPRESS_TTL_MS = 60_000;
  /** F122B B6: Per-entry completion hooks (for multi-mention response aggregation). */
  private entryCompleteHooks = new Map<string, EntryCompleteHook>();
  /** F118 D4: max age before a processingSlot is considered zombie (default 2.5× CLI timeout = 75min) */
  private processingSlotTtlMs: number;
  private readonly sessionContinuationCoordinator?: SessionContinuationCoordinatorLike;
  /** #502 PR2: bounded auto-continuation guard, in-memory per process. */
  private continuationWindows = new Map<string, number[]>();
  private static readonly CONTINUATION_WINDOW_MS = 60 * 60 * 1000;
  private static readonly MAX_CONTINUATIONS_PER_WINDOW = 5;

  constructor(deps: QueueProcessorDeps, opts?: { processingSlotTtlMs?: number }) {
    this.deps = deps;
    this.processingSlotTtlMs = opts?.processingSlotTtlMs ?? 2.5 * resolveCliTimeoutMs(undefined);
    this.sessionContinuationCoordinator =
      deps.sessionContinuationCoordinator ?? QueueProcessor.createSessionContinuationCoordinator(deps.threadStore);
  }

  private static createSessionContinuationCoordinator(
    threadStore?: ThreadStoreLike,
  ): SessionContinuationCoordinatorLike | undefined {
    if (!threadStore) return undefined;
    return new SessionContinuationCoordinator({
      threadStore: {
        getMemberSessionStrategy: async (threadId, agentId, userId) => {
          if (threadStore.getMemberSessionStrategy) {
            return (await threadStore.getMemberSessionStrategy(threadId, agentId, userId)) ?? undefined;
          }
          if (threadStore.isRebornSession && (await threadStore.isRebornSession(threadId, agentId))) {
            return 'reborn';
          }
          return undefined;
        },
        consumePendingContinuation: async (threadId, agentId, userId) => {
          const entry = await threadStore.consumePendingContinuation(threadId, agentId, userId);
          return (entry?.capsule as unknown as CollaborationContinuityCapsuleV1 | undefined) ?? null;
        },
        setPendingContinuation: async (threadId, agentId, userId, capsule) => {
          await threadStore.setPendingContinuation(threadId, agentId, userId, {
            capsule: capsule as unknown as Record<string, unknown>,
            createdAt: Date.now(),
          });
        },
      },
    });
  }

  /** F088 fix: Late-bind outbound hook (set after gateway bootstrap). */
  setOutboundHook(hook: OutboundDeliveryHookLike): void {
    (this.deps as { outboundHook?: OutboundDeliveryHookLike }).outboundHook = hook;
  }

  /** F088 fix: Late-bind streaming hook (set after gateway bootstrap). */
  setStreamingHook(hook: StreamingOutboundHookLike): void {
    (this.deps as { streamingHook?: StreamingOutboundHookLike }).streamingHook = hook;
  }

  /** F088 fix: Late-bind threadMetaLookup (set after gateway bootstrap). */
  setThreadMetaLookup(
    lookup: (threadId: string) => ThreadMetaLike | undefined | Promise<ThreadMetaLike | undefined>,
  ): void {
    (this.deps as { threadMetaLookup?: typeof lookup }).threadMetaLookup = lookup;
  }

  /**
   * F122B B6: Register a completion hook for a specific queue entry.
   * Called by multi-mention dispatch to capture response text for aggregation.
   * Hook is auto-removed after invocation (one-shot).
   */
  registerEntryCompleteHook(entryId: string, hook: EntryCompleteHook): void {
    this.entryCompleteHooks.set(entryId, hook);
  }

  /** F122B B6: Remove a completion hook (e.g. on abort before execution). */
  unregisterEntryCompleteHook(entryId: string): void {
    this.entryCompleteHooks.delete(entryId);
  }

  private static slotKey(threadId: string, agentId: string): string {
    return JSON.stringify([threadId, agentId]);
  }

  private static slotMatchesThread(key: string, threadId: string): boolean {
    return QueueProcessor.parseSlotKey(key)?.threadId === threadId;
  }

  private static parseSlotKey(key: string): { threadId: string; agentId: string } | null {
    try {
      const parsed = JSON.parse(key);
      if (
        Array.isArray(parsed) &&
        parsed.length === 2 &&
        typeof parsed[0] === 'string' &&
        typeof parsed[1] === 'string'
      ) {
        return { threadId: parsed[0], agentId: parsed[1] };
      }
    } catch {
      // Legacy in-memory keys from older code are not expected after restart.
    }
    const legacySep = key.indexOf(':');
    if (legacySep > 0) {
      return { threadId: key.slice(0, legacySep), agentId: key.slice(legacySep + 1) };
    }
    return null;
  }

  /**
   * F118 D4: Sweep zombie processingSlots.
   * A slot is zombie when: age > TTL AND invocationTracker has no active slot for the same key.
   * The tracker check prevents false-positive cleanup of genuinely slow invocations.
   */
  private sweepZombieSlots(threadId: string): void {
    const now = Date.now();
    const ttl = this.processingSlotTtlMs;
    for (const [key, startedAt] of this.processingSlots) {
      if (!QueueProcessor.slotMatchesThread(key, threadId)) continue;
      if (now - startedAt <= ttl) continue;
      // Only release if tracker also has no active invocation — double-confirm zombie
      const agentId = QueueProcessor.parseSlotKey(key)?.agentId;
      if (!agentId) continue;
      if (!this.deps.invocationTracker.has(threadId, agentId)) {
        this.processingSlots.delete(key);
        this.deps.log.warn({ threadId, agentId, ageMs: now - startedAt }, '[F118 D4] zombie processingSlot released');
      }
    }
  }

  /** Check if a slot's queue is paused (canceled/failed AND has queued entries). */
  isPaused(threadId: string, agentId?: string): boolean {
    if (agentId) {
      return (
        this.pausedSlots.has(QueueProcessor.slotKey(threadId, agentId)) && this.hasDispatchableQueuedForThread(threadId)
      );
    }
    // Backward compat: check if any slot for this thread is paused
    for (const key of this.pausedSlots.keys()) {
      if (QueueProcessor.slotMatchesThread(key, threadId)) {
        if (this.hasDispatchableQueuedForThread(threadId)) return true;
      }
    }
    return false;
  }

  /** Expose queued-state for route fairness decisions in non-queue entry paths (retry/connector). */
  hasQueuedForThread(threadId: string): boolean {
    return this.deps.queue.hasQueuedForThread(threadId);
  }

  /** A2A fairness gate: only user-sourced entries should block text-scan A2A. */
  hasQueuedUserMessagesForThread(threadId: string): boolean {
    return this.deps.queue.hasQueuedUserMessagesForThread(threadId);
  }

  /** F185 Phase B: non-agent fairness gate for text-scan A2A — user + connector block, agent does not. */
  hasQueuedNonAgentForThread(threadId: string): boolean {
    return this.deps.queue.hasQueuedNonAgentForThread(threadId);
  }

  /** F185 Phase B: thin enqueue wrapper for deferred A2A entries from retry/invocations path. */
  enqueueRaw(input: any) {
    return this.deps.queue.enqueue(input);
  }

  /** A2A dedup: check if a specific agent already has a queued or processing entry for this thread. */
  hasQueuedAgentForAgent(threadId: string, agentId: string): boolean {
    return this.deps.queue.hasQueuedAgentForAgent(threadId, agentId);
  }

  hasActiveOrQueuedAgentForAgent(threadId: string, agentId: string): boolean {
    return this.deps.queue.hasActiveOrQueuedAgentForAgent(threadId, agentId);
  }

  /** #555: Agent-specific busy check — covers processingSlots + queue entries for this agent. */
  isAgentBusy(threadId: string, agentId: string): boolean {
    const startedAt = this.processingSlots.get(QueueProcessor.slotKey(threadId, agentId));
    if (startedAt !== undefined && Date.now() - startedAt < this.processingSlotTtlMs) return true;
    return this.deps.queue.hasQueuedOrProcessingForAgent(threadId, agentId);
  }

  async enqueueContinuation(input: {
    threadId: string;
    userId: string;
    agentId: string;
    capsule?: CollaborationContinuityCapsuleV1 | null;
    excludeEntryId?: string;
  }): Promise<{ outcome: ContinuationEnqueueOutcome; entry?: QueueEntry }> {
    const { threadId, userId, agentId, capsule, excludeEntryId } = input;
    if (!capsule) {
      this.deps.log.warn({ threadId, agentId }, '[QueueProcessor] continuation skipped: missing capsule');
      return { outcome: 'skipped_missing_capsule' };
    }
    if (!isCollaborationContinuityCapsuleV1(capsule)) {
      this.deps.log.warn({ threadId, agentId }, '[QueueProcessor] continuation skipped: invalid capsule');
      return { outcome: 'skipped_invalid_capsule' };
    }
    if (capsule.threadId !== threadId || capsule.agentId !== agentId) {
      this.deps.log.warn(
        {
          threadId,
          agentId,
          capsuleThreadId: capsule.threadId,
          capsuleAgentId: capsule.agentId,
        },
        '[QueueProcessor] continuation skipped: capsule target mismatch',
      );
      return { outcome: 'skipped_invalid_capsule' };
    }

    const now = Date.now();
    const key = `${threadId}:${agentId}`;
    const recent = (this.continuationWindows.get(key) ?? []).filter(
      (t) => now - t < QueueProcessor.CONTINUATION_WINDOW_MS,
    );
    if (recent.length >= QueueProcessor.MAX_CONTINUATIONS_PER_WINDOW) {
      this.setContinuationWindow(key, recent);
      this.deps.log.warn({ threadId, agentId }, '[QueueProcessor] continuation skipped: rate limited');
      return { outcome: 'skipped_rate_limited' };
    }

    const continuationKey = QueueProcessor.continuationKey(capsule);
    if (
      this.deps.queue.hasPendingForAgent(threadId, agentId, {
        excludeEntryId,
        sources: ['agent'],
        sourceCategories: ['continuation'],
        continuationKey,
      })
    ) {
      this.setContinuationWindow(key, recent);
      this.deps.log.info(
        { threadId, agentId, continuationKey },
        '[QueueProcessor] continuation skipped: pending entry exists',
      );
      return { outcome: 'skipped_existing_entry' };
    }

    const result = this.deps.queue.enqueue({
      threadId,
      userId,
      content: formatContinuationPrompt(capsule),
      source: 'agent',
      sourceCategory: 'continuation',
      continuationKey,
      targetAgents: [agentId],
      intent: 'execute',
      autoExecute: true,
      callerAgentId: agentId,
      priority: 'urgent',
    });
    if (result.outcome === 'full' || !result.entry) {
      this.setContinuationWindow(key, recent);
      this.deps.log.warn({ threadId, agentId }, '[QueueProcessor] continuation skipped: queue full');
      return { outcome: 'queue_full' };
    }

    recent.push(now);
    this.setContinuationWindow(key, recent);
    await emitQueueUpdated(
      this.deps.socketManager,
      userId,
      threadId,
      this.deps.queue.list(threadId, userId),
      this.deps.messageStore,
      'continuation_enqueued',
    );
    return { outcome: 'enqueued', entry: result.entry };
  }

  private static continuationKey(capsule: CollaborationContinuityCapsuleV1): string {
    const seal = capsule.seal;
    const sealPart = seal ? `${seal.sessionId}:${seal.sessionSeq}` : `created:${capsule.createdAt}`;
    return `${capsule.threadId}:${capsule.agentId}:${capsule.invocationId ?? 'unknown-invocation'}:${sealPart}`;
  }

  private setContinuationWindow(key: string, recent: number[]): void {
    if (recent.length === 0) {
      this.continuationWindows.delete(key);
      return;
    }
    this.continuationWindows.set(key, recent);
  }

  /** F151: Check if thread has any queued or processing entries (used by delivery-batch-done signal). */
  isThreadBusy(threadId: string): boolean {
    if (this.hasDispatchableQueuedForThread(threadId)) return true;
    this.sweepZombieSlots(threadId);
    for (const key of this.processingSlots.keys()) {
      if (QueueProcessor.slotMatchesThread(key, threadId)) return true;
    }
    return false;
  }

  /** Active execution only; queued leftovers are not enough to keep new broadcasts in queue mode. */
  hasActiveExecution(threadId: string): boolean {
    if (this.deps.invocationTracker.has(threadId)) return true;
    this.sweepZombieSlots(threadId);
    const now = Date.now();
    for (const [key, startedAt] of this.processingSlots) {
      if (!QueueProcessor.slotMatchesThread(key, threadId)) continue;
      if (now - startedAt < this.processingSlotTtlMs) return true;
    }
    return false;
  }

  /** F151: Signal streaming adapters that delivery is done for this thread invocation.
   *  Fires on both success AND failure — failed invocations must close the task
   *  immediately instead of waiting for TASK_TIMEOUT_MS (P2-1 review fix). */
  private signalDeliveryBatchDone(threadId: string, _status: string): void {
    if (!this.deps.streamingHook?.notifyDeliveryBatchDone) return;
    const threadStillBusy = this.deps.invocationTracker.has(threadId) || this.isThreadBusy(threadId);
    this.deps.streamingHook.notifyDeliveryBatchDone(threadId, !threadStillBusy).catch((err) => {
      this.deps.log.warn({ err, threadId }, '[QueueProcessor] notifyDeliveryBatchDone failed');
    });
  }

  /** Returns pause reason when paused; otherwise undefined. */
  getPauseReason(threadId: string, agentId?: string): 'canceled' | 'failed' | undefined {
    if (!this.isPaused(threadId, agentId)) return undefined;
    if (agentId) {
      return this.pausedSlots.get(QueueProcessor.slotKey(threadId, agentId));
    }
    // Backward compat: return first paused slot's reason
    for (const [key, reason] of this.pausedSlots.entries()) {
      if (QueueProcessor.slotMatchesThread(key, threadId)) return reason;
    }
    return undefined;
  }

  /** #595: auto-recovery delay for failed/canceled slots (ms) */
  private static readonly PAUSE_RECOVERY_DELAY_MS = 10_000;

  /**
   * System-level entry: called when an invocation completes.
   * F108: Now slot-aware — agentId identifies which slot completed.
   * - succeeded → auto-dequeue oldest across users
   * - canceled/failed → pause slot, notify users, auto-recover after delay
   */
  async onInvocationComplete(
    threadId: string,
    agentId: string,
    status: 'succeeded' | 'failed' | 'canceled' | 'canceled_by_user',
  ): Promise<void> {
    const sk = QueueProcessor.slotKey(threadId, agentId);
    if (status === 'succeeded' || status === 'canceled_by_user') {
      this.pausedSlots.delete(sk);
      // Check suppress flag: cancelAll sets this so user cancel = "stop everything".
      // Status-gated: ONLY consume on 'canceled_by_user', not 'succeeded'.
      // Reason: if user does cancelAll → steer, the steer's new invocation may
      // complete with 'succeeded' before the cancelled invocation's 'canceled_by_user'
      // arrives. Without the status gate, 'succeeded' would consume the flag and
      // the late 'canceled_by_user' would incorrectly auto-resume the queue.
      const suppressTs = this.suppressedAutoResume.get(sk);
      // Clean up stale suppress (multi-agent cancelAll: secondary agents may never complete)
      if (suppressTs !== undefined && Date.now() - suppressTs >= QueueProcessor.SUPPRESS_TTL_MS) {
        this.suppressedAutoResume.delete(sk);
      }
      if (
        status === 'canceled_by_user' &&
        suppressTs !== undefined &&
        Date.now() - suppressTs < QueueProcessor.SUPPRESS_TTL_MS
      ) {
        this.suppressedAutoResume.delete(sk); // single-shot: consume it
        this.deps.log.info(
          { threadId, agentId },
          'Auto-resume suppressed (cancelAll) — queued entries preserved but not started',
        );
        return;
      }
      if (this.hasDispatchableQueuedForThread(threadId)) {
        await this.tryExecuteNextAcrossUsers(threadId, agentId);
        await this.tryAutoExecute(threadId);
        if (status === 'canceled_by_user') {
          this.deps.log.info({ threadId, agentId }, 'Auto-resumed queued entry after user cancel');
        }
      }
    } else {
      if (this.hasQueuedAutoContinuationForThreadAgent(threadId, agentId)) {
        this.pausedSlots.delete(sk);
        await this.tryAutoExecute(threadId, {
          onlyContinuation: true,
          bypassNonAgentGate: true,
          onlyTargetAgent: agentId,
        });
        return;
      }
      // canceled or failed → pause ONLY if there are queued entries to manage.
      if (!this.hasDispatchableQueuedForThread(threadId)) {
        this.pausedSlots.delete(sk);
        return;
      }
      const epoch = (this.pauseEpoch.get(sk) ?? 0) + 1;
      this.pauseEpoch.set(sk, epoch);
      this.pausedSlots.set(sk, status);
      await this.emitPausedToQueuedUsers(threadId, status);

      // #595: auto-recover paused slot after delay — prevents indefinite stuck state
      setTimeout(() => {
        if (this.pauseEpoch.get(sk) !== epoch) return;
        this.pausedSlots.delete(sk);
        this.deps.log.info(
          { threadId, agentId, status },
          '[QueueProcessor] Auto-recovering paused slot after timeout (#595)',
        );
        if (this.hasDispatchableQueuedForThread(threadId)) {
          void this.tryExecuteNextAcrossUsers(threadId, agentId).catch((err) => {
            this.deps.log.error({ err, threadId, agentId }, '[QueueProcessor] Auto-recovery dequeue failed');
          });
        }
      }, QueueProcessor.PAUSE_RECOVERY_DELAY_MS);
    }
  }

  /**
   * Preemptively clear paused state for a slot.
   * Used by force-send: the old invocation's async cleanup will call
   * onInvocationComplete('canceled'/'failed') which pauses the slot,
   * but force-send already starts a new invocation — the pause is stale.
   */
  clearPause(threadId: string, agentId?: string): void {
    if (agentId) {
      const sk = QueueProcessor.slotKey(threadId, agentId);
      this.pausedSlots.delete(sk);
    } else {
      for (const key of [...this.pausedSlots.keys()]) {
        if (QueueProcessor.slotMatchesThread(key, threadId)) {
          this.pausedSlots.delete(key);
        }
      }
    }
  }

  /**
   * F108: Force-release the per-slot mutex.
   *
   * Used by queue steer immediate: we cancel the current invocation, but the
   * old queue execution's `.then()` cleanup that deletes the mutex may not have
   * run yet. Releasing early avoids a user-visible false 409 ("queue busy").
   *
   * Idempotent: repeated deletes are safe.
   */
  releaseSlot(threadId: string, agentId: string): void {
    this.processingSlots.delete(QueueProcessor.slotKey(threadId, agentId));
  }

  /**
   * Suppress auto-resume for the next canceled_by_user completion on this slot.
   * Called from the cancelAll handler: user intent = "stop everything", so
   * onInvocationComplete should NOT auto-dequeue the next entry.
   *
   * Single-shot: consumed (cleared) after one onInvocationComplete call.
   */
  suppressAutoResume(threadId: string, agentId: string): void {
    this.suppressedAutoResume.set(QueueProcessor.slotKey(threadId, agentId), Date.now());
  }

  /**
   * @deprecated Use releaseSlot(threadId, agentId) instead. Kept for backward compat during migration.
   */
  releaseThread(threadId: string): void {
    for (const key of [...this.processingSlots.keys()]) {
      if (QueueProcessor.slotMatchesThread(key, threadId)) this.processingSlots.delete(key);
    }
  }

  /**
   * User-level entry: co-creator manually triggers processing their next entry.
   */
  async processNext(threadId: string, userId: string): Promise<{ started: boolean; entry?: QueueEntry }> {
    // Clear all paused slots for this thread (manual resume clears all)
    this.clearPause(threadId);
    return this.tryExecuteNextForUser(threadId, userId);
  }

  /**
   * F122B: Try to auto-execute any queued autoExecute entries whose target agent slot is free.
   * Called immediately after enqueuing an agent entry.
   * Scans all entries and starts every one whose agent slot is free (parallel multi-agent).
   * Per-agent slot mutex (processingSlots + invocationTracker) prevents conflicts.
   */
  async tryAutoExecute(
    threadId: string,
    opts: { onlyContinuation?: boolean; bypassNonAgentGate?: boolean; onlyTargetAgent?: string } = {},
  ): Promise<void> {
    this.sweepZombieSlots(threadId);
    if (!opts.bypassNonAgentGate && this.hasDispatchableNonAgentQueued(threadId)) return;
    const entries = (this.deps.queue.listAutoExecute?.(threadId) ?? [])
      .filter((entry) => !opts.onlyContinuation || entry.sourceCategory === 'continuation')
      .filter((entry) => !opts.onlyTargetAgent || entry.targetAgents[0] === opts.onlyTargetAgent)
      .sort((a, b) => a.createdAt - b.createdAt);
    if (entries.length > 0) {
      const now = Date.now();
      this.deps.log.info(
        {
          threadId,
          entryCount: entries.length,
          entries: entries.map((entry) => ({
            id: entry.id,
            targetAgent: entry.targetAgents[0] ?? 'unknown',
            createdAt: entry.createdAt,
            ageMs: now - entry.createdAt,
          })),
        },
        '[DIAG/a2a] tryAutoExecute candidate scan',
      );
    }

    for (const entry of entries) {
      const entryAgent = entry.targetAgents[0] ?? 'unknown';
      const sk = QueueProcessor.slotKey(threadId, entryAgent);
      // Skip if slot is busy (mutex or tracker)
      if (this.processingSlots.has(sk)) continue;
      if (this.deps.invocationTracker.has(threadId, entryAgent)) continue;

      // Guard: markProcessingById may fail if entry was consumed between snapshot and now
      if (!this.deps.queue.markProcessingById(threadId, entry.id)) continue;
      this.processingSlots.set(sk, Date.now());
      void this.executeEntry(entry).then(
        (status) => {
          this.processingSlots.delete(sk);
          this.onInvocationComplete(threadId, entryAgent, status).catch(() => {});
          this.signalDeliveryBatchDone(threadId, status);
        },
        () => {
          this.processingSlots.delete(sk);
          this.onInvocationComplete(threadId, entryAgent, 'failed').catch(() => {});
          this.signalDeliveryBatchDone(threadId, 'failed');
        },
      );
      // Continue scanning — start all entries with free agent slots (parallel dispatch)
    }
  }

  // ── Internal ──

  private hasDispatchableQueuedForThread(threadId: string): boolean {
    return this.deps.queue.hasDispatchableQueuedForThread(threadId);
  }

  private hasDispatchableNonAgentQueued(threadId: string): boolean {
    if (!this.deps.queue.hasQueuedNonAgentForThread?.(threadId)) return false;
    for (const userId of this.deps.queue.listUsersForThread(threadId)) {
      for (const entry of this.deps.queue.list(threadId, userId)) {
        if (entry.source === 'agent' || entry.status !== 'queued') continue;
        const agent = entry.targetAgents[0];
        if (!agent || !this.pausedSlots.has(QueueProcessor.slotKey(threadId, agent))) return true;
      }
    }
    return false;
  }

  private hasQueuedAutoContinuationForThreadAgent(threadId: string, agentId: string): boolean {
    return (this.deps.queue.listAutoExecute?.(threadId) ?? []).some(
      (entry) =>
        entry.source === 'agent' && entry.sourceCategory === 'continuation' && entry.targetAgents[0] === agentId,
    );
  }

  private async tryExecuteNextAcrossUsers(
    threadId: string,
    agentId: string,
  ): Promise<{ started: boolean; entry?: QueueEntry }> {
    this.sweepZombieSlots(threadId);

    // F175: scan by comparator order, skip entries whose target slot is busy
    const busyAgents = new Set<string>();
    for (;;) {
      const entry = this.deps.queue.markProcessingAcrossUsers(threadId, busyAgents);
      if (!entry) return { started: false };

      const entryAgent = entry.targetAgents[0] ?? agentId;
      const entrySk = QueueProcessor.slotKey(threadId, entryAgent);

      if (this.processingSlots.has(entrySk) || this.deps.invocationTracker.has(threadId, entryAgent)) {
        this.deps.queue.rollbackProcessing(threadId, entry.id);
        busyAgents.add(entryAgent);
        continue;
      }

      this.processingSlots.set(entrySk, Date.now());
      void this.executeEntry(entry).then(
        (status) => {
          this.processingSlots.delete(entrySk);
          this.onInvocationComplete(threadId, entryAgent, status).catch(() => {});
          this.signalDeliveryBatchDone(threadId, status);
        },
        () => {
          this.processingSlots.delete(entrySk);
          this.onInvocationComplete(threadId, entryAgent, 'failed').catch(() => {});
          this.signalDeliveryBatchDone(threadId, 'failed');
        },
      );

      return { started: true, entry };
    }
  }

  private async tryExecuteNextForUser(
    threadId: string,
    userId: string,
  ): Promise<{ started: boolean; entry?: QueueEntry }> {
    this.sweepZombieSlots(threadId);
    // F108 P1-3 fix: peek at next entry's target agent to check slot mutex BEFORE marking processing.
    // This prevents entries from getting stuck as 'processing' when the slot is busy.
    const nextEntry = this.deps.queue.peekNextQueued(threadId, userId);
    if (!nextEntry) return { started: false };

    const entryAgent = nextEntry.targetAgents[0] ?? 'unknown';
    const sk = QueueProcessor.slotKey(threadId, entryAgent);

    // Mutex check — per-slot (before mutating queue state)
    if (this.processingSlots.has(sk)) {
      // 2026-06-02: observability — this silent !started is the source of a QUEUE_BUSY that gives
      // no clue why. Log the busy source so future "can't steer/dequeue" is diagnosable from logs.
      this.deps.log.info(
        { event: 'queue_not_started', threadId, entryAgent, reason: 'processing_slot_busy' },
        '[QueueProcessor] processNext skipped: processingSlot busy',
      );
      return { started: false };
    }
    // Fix: skip if agent already has an active invocation via CLI/messages.ts (same guard as above)
    if (this.deps.invocationTracker.has(threadId, entryAgent)) {
      this.deps.log.info(
        { event: 'queue_not_started', threadId, entryAgent, reason: 'tracker_active' },
        '[QueueProcessor] processNext skipped: invocationTracker active',
      );
      return { started: false };
    }

    // Now safe to mark processing — slot is available
    const entry = this.deps.queue.markProcessing(threadId, userId);
    if (!entry) return { started: false };

    this.processingSlots.set(sk, Date.now());
    // Fire-and-forget execution — chain onInvocationComplete AFTER mutex release
    void this.executeEntry(entry).then(
      (status) => {
        this.processingSlots.delete(sk);
        this.onInvocationComplete(threadId, entryAgent, status).catch(() => {});
        this.signalDeliveryBatchDone(threadId, status);
      },
      () => {
        this.processingSlots.delete(sk);
        this.onInvocationComplete(threadId, entryAgent, 'failed').catch(() => {});
        this.signalDeliveryBatchDone(threadId, 'failed');
      },
    );

    return { started: true, entry };
  }

  /**
   * Execute a queue entry — mirrors messages.ts background invocation pipeline.
   * Creates InvocationRecord → tracker.start → route execution → complete → cleanup.
   * Returns final status for chain auto-dequeue (called by tryExecuteNext*).
   */
  private async executeEntry(entry: QueueEntry): Promise<'succeeded' | 'failed' | 'canceled' | 'canceled_by_user'> {
    const { queue, invocationTracker, invocationRecordStore, router, socketManager, messageStore, log } = this.deps;
    const { threadId, userId, targetAgents, intent, messageId } = entry;
    const primaryAgent = targetAgents[0] ?? 'unknown';

    const batchedEntryIds: string[] = [];
    const batchedMessageIds: string[] = [];
    let content = entry.content;

    let controller: AbortController | undefined;
    let invocationId: string | undefined;
    let finalStatus: InvocationFinalStatus = 'failed';
    let responseText = '';
    const cursorBoundaries = new Map<string, string>();
    const continuationCapsules = new Map<string, CollaborationContinuityCapsuleV1>();
    // Cloud Codex P2: track consumed continuation so we can re-store on failure/cancel.
    let consumedContinuation: ConsumedContinuationToken | undefined;
    // Cloud Codex P2: defer A2A consumption to success path — entries stay in queue
    // until the batch actually succeeds. The invocationTracker prevents double-pickup.
    let deferredA2AConsume = new Set<string>();
    // R4 fix: hoist streamStartPromise above try so the catch block can await it
    // before calling onStreamEnd → cleanupPlaceholders (the correct failure cleanup
    // sequence per messages.ts cleanupStreamingOnFailure).
    let streamStartPromise: Promise<void> | undefined;

    try {
      // 1. Create InvocationRecord (before batching — avoid claiming entries on duplicate)
      // Connector-sourced entries use connector-${messageId} to match the direct-execution
      // idempotency path, so retries after queue processing are also caught persistently.
      const idempotencyKey = entry.source === 'connector' && messageId ? `connector-${messageId}` : `queue-${entry.id}`;
      const createResult = await invocationRecordStore.create({
        threadId,
        userId,
        targetAgents,
        intent,
        idempotencyKey,
      });

      if (createResult.outcome === 'duplicate') {
        log.warn({ threadId, entryId: entry.id }, '[QueueProcessor] Duplicate invocation, skipping');
        finalStatus = 'succeeded';
        return 'succeeded';
      }
      invocationId = createResult.invocationId;

      // F175: user-message batching — collect adjacent matching entries
      // Placed after idempotency check so batched entries aren't dropped on duplicate
      if (entry.source === 'user') {
        const batch = queue.collectUserBatch(threadId, userId);
        const sortedTargets = [...entry.targetAgents].sort();
        const matching = batch.filter(
          (e) =>
            e.source === 'user' &&
            e.intent === entry.intent &&
            e.targetAgents.length === sortedTargets.length &&
            [...e.targetAgents].sort().every((t, i) => t === sortedTargets[i]),
        );
        for (const be of matching) {
          if (!queue.markProcessingById(threadId, be.id)) continue;
          batchedEntryIds.push(be.id);
          if (be.messageId) batchedMessageIds.push(be.messageId);
          content = content + '\n' + be.content;
        }
      }

      // 2. Start tracking ALL target agents (shared controller for F5/reconnect recovery)
      controller = invocationTracker.startAll(threadId, targetAgents, userId);

      // F216 c3: supersede tombstone guard. If a same-turn follow-up arrived during the
      // pre-start window (between markProcessingById and startAll), callback-a2a-trigger
      // removed this entry as a tombstone signal. Detect it here and self-abort before
      // routeExecution — the follow-up is already queued and will run after this returns.
      //
      // Status: 'canceled_by_user' (not plain 'canceled') so onInvocationComplete takes
      // the immediate-restart branch (tryAutoExecute) rather than the 10s pause branch.
      // No suppressedAutoResume flag is set (only cancelAll sets it), so the suppress
      // check is a no-op. Result: follow-up restarts immediately after slot release.
      if (!queue.list(threadId, userId).some((e) => e.id === entry.id)) {
        log.info(
          { threadId, entryId: entry.id },
          '[F216-c3] entry superseded during pre-start window — self-abort before routeExecution',
        );
        // Close the invocation record (created but never executed).
        if (invocationId) {
          await invocationRecordStore.update(invocationId, { status: 'canceled' });
        }
        finalStatus = 'canceled_by_user';
        return 'canceled_by_user';
      }

      // 3. Backfill message ID
      if (messageId) {
        await invocationRecordStore.update(invocationId, {
          userMessageId: messageId,
        });
      }

      // 4. Mark running
      await invocationRecordStore.update(invocationId, {
        status: 'running',
      });

      // F220 Phase 1: queued execution needs the same earliest liveness signal
      // as direct /api/messages execution. intent_mode stays deferred until the
      // first CLI event (#768); spawn_started is only "process is being spawned".
      if (!controller.signal.aborted) {
        socketManager.broadcastToRoom(`thread:${threadId}`, 'spawn_started', {
          threadId,
          targetAgents,
          invocationId,
        });
      }

      // 5. intent_mode deferred to first CLI event (#768: avoid "replying" when CLI never starts)
      let intentModeBroadcast = false;

      // 6. Emit queue_updated (processing)
      await emitQueueUpdated(socketManager, userId, threadId, queue.list(threadId, userId), messageStore, 'processing');

      // F098-D: Mark queued messages as delivered (set deliveredAt = now)
      // F117: Collect full message objects for frontend bubble rendering
      const allMessageIds: string[] = [messageId ?? '', ...(entry.mergedMessageIds ?? []), ...batchedMessageIds].filter(
        Boolean,
      );
      const currentContextMessageIds = new Set(allMessageIds);
      const deliveredNow = Date.now();
      const deliveredIds: string[] = [];
      const deliveredMessages: Array<{
        id: string;
        content: string;
        agentId: string | null;
        timestamp: number;
        mentions: readonly string[];
        userId: string;
        contentBlocks?: readonly unknown[];
        extra?: Record<string, unknown>;
        origin?: string;
        replyTo?: string;
        replyPreview?: { senderAgentId: string | null; content: string; deleted?: boolean; kind?: string };
        mentionsUser?: boolean;
      }> = [];
      for (const mid of allMessageIds) {
        try {
          const result = await messageStore.markDelivered(mid, deliveredNow);
          if (result) {
            deliveredIds.push(mid);
            let preview: Awaited<ReturnType<typeof hydrateReplyPreview>> | null = null;
            if (result.replyTo) {
              try {
                preview = await hydrateReplyPreview(messageStore, result.replyTo);
              } catch {
                /* best-effort: preview failure must not drop the delivered message */
              }
            }
            deliveredMessages.push({
              id: result.id,
              content: result.content,
              agentId: result.agentId,
              timestamp: result.timestamp,
              mentions: result.mentions,
              userId: result.userId,
              contentBlocks: result.contentBlocks,
              ...(result.extra ? { extra: result.extra as Record<string, unknown> } : {}),
              ...(result.origin ? { origin: result.origin } : {}),
              ...(result.replyTo ? { replyTo: result.replyTo } : {}),
              ...(preview ? { replyPreview: preview } : {}),
              ...(result.mentionsUser ? { mentionsUser: true } : {}),
            });
          }
        } catch {
          /* best-effort: delivery timestamp is non-critical */
        }
      }
      // Notify frontend only for successfully persisted IDs (cloud P2: avoid phantom timestamps)
      // F117: Include messages array so frontend can render user bubble on delivery
      if (deliveredIds.length > 0) {
        socketManager.emitToUser(userId, 'messages_delivered', {
          threadId,
          messageIds: deliveredIds,
          deliveredAt: deliveredNow,
          messages: deliveredMessages,
        });
      }

      // 6b. #815: Consume redundant A2A trigger entries — if target agents are
      // already being processed in this batch, queued A2A entries for those agents
      // are pure triggers whose source messages are already visible in context.
      // Two-step: find candidates, then async-filter by message delivery status.
      // Text-scan A2A entries reference persisted agent messages (deliveryStatus
      // undefined/delivered → safe to consume). Callback A2A entries reference
      // messages with deliveryStatus:'queued' → NOT safe (message not yet delivered).
      const activeAgentSet = new Set(targetAgents);
      const a2aCandidates = queue.findSubsumedA2ACandidates(threadId, userId, activeAgentSet);
      if (a2aCandidates.length > 0) {
        const safeToConsume = new Set<string>();
        for (const candidate of a2aCandidates) {
          if (!candidate.messageId) continue; // no message ref → conservative, skip
          const candidateMessageIds = [candidate.messageId, ...(candidate.mergedMessageIds ?? [])];
          if (!candidateMessageIds.every((mid) => currentContextMessageIds.has(mid))) {
            continue; // delivered historical trigger, but not part of this invocation context
          }
          const msg = await messageStore.getById(candidate.messageId);
          if (!msg) continue; // message not found → skip
          if (msg.deliveryStatus === 'queued') continue; // not yet delivered → don't consume
          // Cloud Codex P2: also check mergedMessageIds — coalesced entries can
          // have additional trigger messages that are still queued (e.g. a callback
          // post_message coalesced into a text-scan A2A entry). If ANY merged
          // trigger is still queued, don't consume the entry.
          let mergedSafe = true;
          if (candidate.mergedMessageIds?.length) {
            for (const mid of candidate.mergedMessageIds) {
              const mergedMsg = await messageStore.getById(mid);
              if (mergedMsg?.deliveryStatus === 'queued') {
                mergedSafe = false;
                break;
              }
            }
          }
          if (!mergedSafe) continue;
          safeToConsume.add(candidate.id);
        }
        if (safeToConsume.size > 0) {
          // Cloud Codex P2: defer actual removal to the success path in `finally`.
          // If the batch fails/cancels, entries stay in queue for retry.
          // invocationTracker prevents double-pickup during execution.
          deferredA2AConsume = safeToConsume;
          log.info(
            {
              threadId,
              deferredCount: safeToConsume.size,
              deferredIds: [...safeToConsume],
            },
            '[QueueProcessor] #815: identified subsumed A2A entries (deferred to success)',
          );
        }
      }

      // 6c. F224: single-agent continuation lifecycle is owned by
      // SessionContinuationCoordinator. Multi-target still skips prepare because
      // content is shared across agents; a agent-specific continuation prompt would leak.
      if (this.sessionContinuationCoordinator && targetAgents.length === 1) {
        const singleAgentId = targetAgents[0]!;
        try {
          const originalContent = content;
          const prepared = await this.sessionContinuationCoordinator.prepareInvocationContext({
            threadId,
            agentId: singleAgentId,
            userId,
            content,
          });
          content = prepared.content;
          consumedContinuation = prepared.consumedContinuation;

          if (prepared.sessionPolicy === 'reborn') {
            log.info(
              { threadId, agentId: singleAgentId },
              '[QueueProcessor] #836: reborn session — coordinator skipped continuation consume',
            );
            // A legacy/fallback continuation entry already contains stale pre-reborn
            // context. Drop it so reborn starts fresh.
            if (entry.sourceCategory === 'continuation') {
              log.info(
                { threadId, agentId: singleAgentId, entryId: entry.id },
                '[QueueProcessor] #836: reborn session — dropping stale continuation queue entry',
              );
              if (invocationId) {
                await invocationRecordStore.update(invocationId, { status: 'succeeded' });
              }
              finalStatus = 'succeeded';
              return 'succeeded';
            }
          }

          if (prepared.consumedContinuation) {
            const capsule = prepared.consumedContinuation.capsule;
            const sameQueuedContinuation =
              entry.sourceCategory === 'continuation' &&
              entry.continuationKey === QueueProcessor.continuationKey(capsule);
            if (sameQueuedContinuation) {
              content = originalContent;
            }
            log.info(
              {
                threadId,
                agentId: singleAgentId,
                capsuleCreatedAt: capsule.createdAt,
                promptAlreadyQueued: sameQueuedContinuation,
              },
              '[QueueProcessor] #813: coordinator prepared pending continuation context for execution',
            );
          }
        } catch (err) {
          log.warn(
            { threadId, agentId: singleAgentId, err },
            '[QueueProcessor] F224: prepareInvocationContext failed, proceeding without continuation context',
          );
        }
      }

      // 7. Route execution
      const persistenceContext: { richBlocks?: Array<{ kind: string; [key: string]: unknown }> } = {};
      const collectedTextParts: string[] = [];
      // #845 fix: per-agent token usage from done events (same pattern as messages.ts / ConnectorInvokeTrigger).
      // Without this, queued/connector invocations succeed without writing usageByAgent, leaving 159+ orphans
      // in the daily usage report.
      const collectedUsage = new Map<string, TokenUsage>();

      // F088 fix: Track per-turn content for outbound delivery (same pattern as ConnectorInvokeTrigger)
      const outboundTurns: Array<{
        agentId: string;
        textParts: string[];
        richBlocks?: Array<{ kind: string; [key: string]: unknown }>;
      }> = [];
      let currentTurnAgentId: string | undefined;

      // F039 remaining: queued image messages must be visible to agents.
      // Aggregate contentBlocks from the stored user messages (messageId + merged).
      const messageIds: string[] = [messageId ?? '', ...(entry.mergedMessageIds ?? []), ...batchedMessageIds].filter(
        Boolean,
      );
      const contentBlocks: unknown[] = [];
      for (const id of messageIds) {
        try {
          const stored = await messageStore.getById(id);
          if (stored?.contentBlocks && stored.contentBlocks.length > 0) {
            contentBlocks.push(...stored.contentBlocks);
          }
        } catch (err) {
          log.warn(
            { threadId, entryId: entry.id, messageId: id, err },
            '[QueueProcessor] messageStore.getById failed, degrading to text-only execution',
          );
        }
      }

      // F122B B6: Collect response text for completion hook (multi-mention aggregation).
      const hook = this.entryCompleteHooks.get(entry.id);

      // F088 fix: start streaming placeholder on external platforms
      if (this.deps.streamingHook) {
        streamStartPromise = this.deps.streamingHook
          .onStreamStart(threadId, primaryAgent, invocationId, entry.senderMeta)
          .catch((err) => {
            log.warn({ err, threadId }, '[QueueProcessor] StreamingHook.onStreamStart failed');
          });
      }

      // F151: Mid-loop delivery to preserve ordering (same fix as ConnectorInvokeTrigger)
      const deliveredTurnIndices = new Set<number>();
      const DELIVER_TIMEOUT_MS = this.deps.deliverTimeoutMs ?? 10_000;
      let threadMeta: ThreadMetaLike | undefined;
      let threadMetaPromise: Promise<ThreadMetaLike | undefined> | undefined;
      if (this.deps.outboundHook && this.deps.threadMetaLookup) {
        const rawResult = this.deps.threadMetaLookup(threadId);
        if (rawResult) {
          const LOOKUP_TIMEOUT_MS = 2000;
          threadMetaPromise = Promise.race([
            Promise.resolve(rawResult).catch((err: unknown) => {
              log.warn({ err, threadId }, '[QueueProcessor] threadMetaLookup late rejection');
              return undefined;
            }),
            new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), LOOKUP_TIMEOUT_MS)),
          ]);
        }
      }

      for await (const msg of router.routeExecution(
        userId,
        content,
        threadId,
        messageId,
        targetAgents,
        { intent, ...(entry.suggestedSkill ? { promptTags: [`skill:${entry.suggestedSkill}`] } : {}) },
        {
          ...(contentBlocks.length > 0 ? { contentBlocks } : {}),
          ...(controller.signal ? { signal: controller.signal } : {}),
          // F-parallel-cancel: per-agent signal so canceling one concurrent agent (e.g. @codex)
          // does not abort its siblings (e.g. @gpt52). startAll gives each agent its own per-agent
          // controller; route-parallel resolves them through this getter.
          // NOTE (cloud review clarification): `controller` (line 808) is the INDEPENDENT batch
          // gate returned by startAll — NOT a primary agent controller. A single-agent cancel aborts
          // only that agent's per-agent controller, NOT the batch gate, so the consume-loop
          // `if (controller.signal.aborted) break` (993 / 1090) fires ONLY on whole-invocation
          // abort (cancelAll / force / thread-delete), never on single-agent cancel — the sibling
          // keeps streaming. (See InvocationTracker.startAll returning a fresh batchController.)
          signalForAgent: (agentId: string) => invocationTracker.getController?.(threadId, agentId)?.signal,
          queueHasQueuedMessages: (tid: string) => queue.hasQueuedNonAgentForThread(tid),
          deferA2AEnqueue: (e: any) => queue.enqueue(e),
          hasQueuedOrActiveAgentForAgent: (tid: string, agentId: string) =>
            queue.hasActiveOrQueuedAgentForAgent(tid, agentId, { excludeEntryId: entry.id }),
          invocationController: controller,
          trackA2ASlot: (tid: string, agentId: string, uid: string, ctrl: AbortController) => {
            invocationTracker.trackExternalSlot?.(tid, agentId, ctrl, uid, [agentId]);
          },
          completeA2ASlots: (tid: string, agentIds: readonly string[], ctrl: AbortController) => {
            for (const agentId of agentIds) invocationTracker.completeSlot?.(tid, agentId, ctrl);
          },
          cursorBoundaries,
          persistenceContext,
          ...(invocationId ? { parentInvocationId: invocationId } : {}),
          ...(entry.a2aTriggerMessageId ? { a2aTriggerMessageId: entry.a2aTriggerMessageId } : {}),
          ...(entry.callerTraceContext ? { callerTraceContext: entry.callerTraceContext } : {}),
          // F222 P1: Only user-originated queue entries trigger frustration detection.
          // Whitelist (not blacklist) — agent + connector sources both suppressed.
          frustrationAutoIssueEligible: entry.source === 'user',
          // #949 P1-1: Connector-sourced queue entries have no ball-pass expectation.
          // A2A/agent entries still get the verdict-pass handoff guard.
          verdictPassWarningEnabled: entry.source !== 'connector',
        },
      )) {
        if (controller.signal.aborted) {
          break;
        }
        // #768: Broadcast intent_mode on first CLI event — proves CLI is alive.
        if (!intentModeBroadcast) {
          socketManager.broadcastToRoom(`thread:${threadId}`, 'intent_mode', {
            threadId,
            mode: intent,
            targetAgents,
            invocationId,
          });
          intentModeBroadcast = true;
        }
        if (hook && msg.agentId === primaryAgent && msg.type === 'text' && (msg as { content?: string }).content) {
          responseText = accumulateTextAggregate(
            responseText,
            (msg as { content?: string }).content!,
            (msg as { textMode?: 'append' | 'replace' }).textMode,
          );
        }
        const continuationCapsule = extractContinuityCapsuleFromAgentMessage(msg);
        if (continuationCapsule) {
          continuationCapsules.set(continuationCapsule.agentId, continuationCapsule);
        }
        if ((msg.type === 'done' || msg.type === 'error') && msg.agentId) {
          invocationTracker.completeSlot?.(threadId, msg.agentId, controller);
        }

        // #845 fix: accumulate per-agent token usage on done events. Mirrors messages.ts:992-994
        // and ConnectorInvokeTrigger.ts:386-387. Without this, queue-* and connector-* invocations
        // succeed but never write usageByAgent, dropping ~159/164 records from the daily report.
        // RouterLike.routeExecution yields an opaque record type, so narrow metadata via local cast.
        if (msg.type === 'done' && msg.agentId) {
          const metadata = (msg as { metadata?: { usage?: TokenUsage } }).metadata;
          if (metadata?.usage) {
            collectedUsage.set(msg.agentId, mergeTokenUsage(collectedUsage.get(msg.agentId), metadata.usage));
          }
        }

        // F088 fix: collect per-turn content for outbound delivery
        if (msg.type === 'done' && msg.agentId) {
          if (persistenceContext.richBlocks) {
            const turn = outboundTurns[outboundTurns.length - 1];
            if (turn && turn.agentId === msg.agentId && currentTurnAgentId === msg.agentId) {
              turn.richBlocks = [...persistenceContext.richBlocks];
            } else {
              outboundTurns.push({
                agentId: msg.agentId,
                textParts: [],
                richBlocks: [...persistenceContext.richBlocks],
              });
            }
            persistenceContext.richBlocks = undefined;
          }
          currentTurnAgentId = undefined;
          // F151: Deliver completed agent's turns immediately (same fix as ConnectorInvokeTrigger)
          if (this.deps.outboundHook) {
            if (threadMetaPromise) {
              threadMeta = await threadMetaPromise;
              threadMetaPromise = undefined;
            }
            for (let i = 0; i < outboundTurns.length; i++) {
              if (deliveredTurnIndices.has(i)) continue;
              const turn = outboundTurns[i];
              if (turn.agentId !== msg.agentId) continue;
              const turnContent = turn.textParts.join('');
              if (!turnContent && !turn.richBlocks?.length) continue;
              try {
                await Promise.race([
                  this.deps.outboundHook.deliver(
                    threadId,
                    turnContent,
                    turn.agentId,
                    turn.richBlocks,
                    threadMeta,
                    undefined,
                    messageId ?? undefined,
                  ),
                  new Promise<void>((_, reject) =>
                    setTimeout(() => reject(new Error('deliver timeout')), DELIVER_TIMEOUT_MS),
                  ),
                ]);
                deliveredTurnIndices.add(i);
              } catch (err) {
                log.error(
                  { err, threadId, agentId: turn.agentId },
                  '[QueueProcessor] Mid-loop delivery failed, will retry in final phase',
                );
              }
            }
          }
        }
        if (msg.type === 'text' && typeof (msg as Record<string, unknown>).content === 'string') {
          const textContent = (msg as Record<string, unknown>).content as string;
          const textMode = (msg as { textMode?: 'append' | 'replace' }).textMode;
          accumulateTextParts(collectedTextParts, textContent, textMode);
          if (msg.agentId) {
            if (msg.agentId !== currentTurnAgentId) {
              outboundTurns.push({ agentId: msg.agentId, textParts: [] });
              currentTurnAgentId = msg.agentId;
            }
            const turn = outboundTurns[outboundTurns.length - 1];
            accumulateTextParts(turn.textParts, textContent, textMode);
          }
          if (this.deps.streamingHook) {
            const accumulated =
              outboundTurns.length > 0 ? flattenTurnTextParts(outboundTurns) : flattenTextParts(collectedTextParts);
            this.deps.streamingHook.onStreamChunk(threadId, accumulated, invocationId).catch((err) => {
              log.warn({ err, threadId }, '[QueueProcessor] StreamingHook.onStreamChunk failed');
            });
          }
        }
        if (controller.signal.aborted) {
          break;
        }

        // F194 Phase Z9 (砚砚 R1 P1-2): unified visible turn stamp via helper.
        const msgInvocationId = (msg as { invocationId?: string }).invocationId;
        socketManager.broadcastAgentMessage(
          {
            ...msg,
            ...(invocationId ? stampVisibleTurn(invocationId, msgInvocationId) : {}),
          },
          threadId,
        );
      }

      // 8. Check abort before marking succeeded (F122B B6 P1: abort→succeeded bug fix)
      // F-parallel-cancel: AGGREGATE finalStatus — batch gate abort (whole invocation) OR every
      // target agent singly cancelled → canceled. A single-agent cancel no longer aborts the batch
      // gate, so raw controller.signal.aborted only covers the whole-invocation case. (completeAll
      // runs later, so cancel tombstones are still visible to resolveFinalStatus here.)
      const batchReason = controller.signal.reason;
      const aggFinalStatus = invocationTracker.resolveFinalStatus
        ? invocationTracker.resolveFinalStatus(threadId, targetAgents, {
            aborted: controller.signal.aborted,
            reason: batchReason as string | undefined,
          })
        : controller.signal.aborted
          ? // Fallback (tracker without resolveFinalStatus) must stay equivalent to the old logic:
            // whole-invocation abort → reason decides canceled_by_user vs canceled.
            batchReason === 'user_cancel' || batchReason === 'cancel_all'
            ? 'canceled_by_user'
            : 'canceled'
          : 'succeeded';
      if (aggFinalStatus !== 'succeeded') {
        log.info({ threadId, entryId: entry.id }, '[QueueProcessor] Entry aborted/cancelled during execution');
        // F148 fix: ack cursors for agents that completed before abort (monotonic CAS, safe to call)
        if (cursorBoundaries.size > 0) {
          await router.ackCollectedCursors(userId, threadId, cursorBoundaries);
        }
        await invocationRecordStore.update(invocationId, { status: 'canceled' });
        finalStatus = aggFinalStatus;
        // Suppress auto-resume ONLY for cancelAll (stop everything), NOT single-agent cancel.
        // Single-agent cancel should still auto-resume the next queued entry (backward compat).
        // 'cancel_all' = cancelAll button; 'user_cancel' = single-agent — only cancel_all suppresses.
        if (batchReason === 'cancel_all') {
          const entryAgent = entry.targetAgents[0] ?? 'unknown';
          this.suppressedAutoResume.set(QueueProcessor.slotKey(threadId, entryAgent), Date.now());
        }
        return finalStatus;
      }

      // 9. Ack cursors + mark succeeded
      await router.ackCollectedCursors(userId, threadId, cursorBoundaries);
      await invocationRecordStore.update(invocationId, {
        status: 'succeeded',
        // #845 fix: carry token usage same as messages.ts:1152-1158. Without this, queued/connector
        // succeeded invocations never recorded usageByAgent → daily stats undercount.
        ...(collectedUsage.size > 0
          ? {
              usageByAgent: Object.fromEntries(collectedUsage),
            }
          : {}),
      });

      finalStatus = 'succeeded';

      // 10. Outbound delivery: send remaining per-turn content to bound external chats
      await this.deliverOutbound(
        threadId,
        primaryAgent,
        invocationId!,
        collectedTextParts,
        outboundTurns,
        persistenceContext,
        streamStartPromise,
        log,
        messageId ?? undefined,
        deliveredTurnIndices,
        threadMeta,
      );

      return 'succeeded';
    } catch (err) {
      finalStatus = 'failed';
      log.error({ threadId, entryId: entry.id, err }, '[QueueProcessor] executeEntry failed');
      // F148 fix: ack cursors for agents that completed before the exception
      if (cursorBoundaries.size > 0) {
        try {
          await router.ackCollectedCursors(userId, threadId, cursorBoundaries);
        } catch {
          /* best-effort — don't mask the original error */
        }
      }
      const errMsg = err instanceof Error ? err.message : String(err);
      // Best-effort: mark record failed + broadcast error
      try {
        if (invocationId) {
          await invocationRecordStore.update(invocationId, {
            status: 'failed',
            error: errMsg,
          });
        }
        socketManager.broadcastAgentMessage(
          {
            type: 'error',
            agentId: targetAgents[0] ?? 'system',
            error: errMsg,
            isFinal: true,
            timestamp: Date.now(),
          },
          threadId,
        );
      } catch {
        /* ignore secondary errors */
      }

      // R4 fix (#873): correct failure cleanup sequence per messages.ts
      // cleanupStreamingOnFailure — onStreamEnd moves sessions from active →
      // pendingCleanup; cleanupPlaceholders only acts on pendingCleanup, so
      // calling it alone is a no-op when sessions are still active.
      if (this.deps.streamingHook && invocationId) {
        try {
          const STREAM_START_TIMEOUT_MS = 5000;
          if (streamStartPromise) {
            await Promise.race([streamStartPromise, new Promise<void>((r) => setTimeout(r, STREAM_START_TIMEOUT_MS))]);
          }
          await this.deps.streamingHook.onStreamEnd(threadId, '', invocationId);
          await this.deps.streamingHook.cleanupPlaceholders?.(threadId, invocationId);
        } catch (cleanupErr) {
          log.warn({ err: cleanupErr, threadId }, '[QueueProcessor] Error-path streaming cleanup failed');
        }
      }

      // R3 P2 fix (#873): Deliver error message to external IM so user sees
      // a reply instead of silence (mirrors ConnectorInvokeTrigger error path).
      // R6 fix: timeout prevents adapter hang from pinning queue slot (Cloud P1).
      if (this.deps.outboundHook) {
        const ERROR_DELIVER_TIMEOUT_MS = this.deps.deliverTimeoutMs ?? 10_000;
        try {
          await Promise.race([
            this.deps.outboundHook.deliver(
              threadId,
              '抱歉，处理消息时遇到问题，请稍后重试。',
              primaryAgent,
              undefined,
              undefined,
              undefined,
              messageId ?? undefined,
            ),
            new Promise<void>((_, reject) =>
              setTimeout(() => reject(new Error('deliver timeout')), ERROR_DELIVER_TIMEOUT_MS),
            ),
          ]);
        } catch (deliverErr) {
          log.error({ err: deliverErr, threadId }, '[QueueProcessor] Error-path outbound delivery failed');
        }
      }

      return 'failed';
    } finally {
      // Always cleanup tracker + queue (all target agent slots)
      invocationTracker.completeAll(threadId, targetAgents, controller);
      queue.removeProcessedAcrossUsers(threadId, entry.id);
      // F175: on success remove batched entries; on failure/cancel rollback so they can retry
      if (finalStatus === 'succeeded') {
        for (const bid of batchedEntryIds) {
          queue.removeProcessedAcrossUsers(threadId, bid);
        }
        // #815 + Cloud Codex P2: now that the batch succeeded, actually consume
        // the subsumed A2A entries that were deferred earlier.
        if (deferredA2AConsume.size > 0) {
          const consumedA2A = queue.consumeEntriesById(deferredA2AConsume);
          for (const c of consumedA2A) {
            this.entryCompleteHooks.delete(c.id);
          }
          log.info(
            { threadId, consumedCount: consumedA2A.length },
            '[QueueProcessor] #815: consumed deferred A2A entries after successful batch',
          );
          socketManager.emitToUser(userId, 'queue_updated', {
            threadId,
            queue: queue.list(threadId, userId),
            action: 'a2a_subsumed',
          });
        }
      } else {
        for (const bid of batchedEntryIds) {
          queue.rollbackProcessing(threadId, bid);
        }
        // Cloud Codex P2: deferred A2A entries stay in queue on failure — no rollback needed.
      }
      const producedCapsules = [...continuationCapsules.values()];
      for (const continuationCapsule of producedCapsules) {
        if (finalStatus === 'canceled_by_user') {
          log.info(
            { threadId, agentId: continuationCapsule.agentId },
            '[QueueProcessor] F224: user-canceled invocation — storing continuation without auto-enqueue',
          );
          continue;
        }
        if (!(await this.shouldEnqueueContinuation(continuationCapsule, userId))) {
          log.info(
            { threadId, agentId: continuationCapsule.agentId },
            '[QueueProcessor] #836: reborn session — skipping continuation enqueue',
          );
          continue;
        }
        const result = await this.enqueueContinuation({
          threadId,
          userId,
          agentId: continuationCapsule.agentId,
          capsule: continuationCapsule,
        });
      }
      if (this.sessionContinuationCoordinator) {
        try {
          await this.sessionContinuationCoordinator.commitInvocationOutcome({
            finalStatus,
            threadId,
            agentId: primaryAgent,
            userId,
            consumedContinuation,
            producedCapsules,
          });
        } catch (err) {
          log.warn({ threadId, targetAgents, err }, '[QueueProcessor] F224: commitInvocationOutcome failed');
        }
      }
      await emitQueueUpdated(socketManager, userId, threadId, queue.list(threadId, userId), messageStore, 'completed');
      // F122B B6: Fire completion hook (one-shot) and clean up
      const completeHook = this.entryCompleteHooks.get(entry.id);
      if (completeHook) {
        this.entryCompleteHooks.delete(entry.id);
        try {
          completeHook(entry.id, finalStatus, responseText);
        } catch {
          /* best-effort: hook errors must not break queue chain */
        }
      }
      // Chain auto-dequeue is handled by tryExecuteNext* (calls onInvocationComplete
      // AFTER releasing processingThreads mutex to avoid self-blocking).
    }
  }

  private async shouldEnqueueContinuation(capsule: CollaborationContinuityCapsuleV1, userId: string): Promise<boolean> {
    if (!this.sessionContinuationCoordinator?.resolveSessionStrategy) return true;
    try {
      return (
        (await this.sessionContinuationCoordinator.resolveSessionStrategy(
          capsule.threadId,
          capsule.agentId,
          userId,
        )) !== 'reborn'
      );
    } catch (err) {
      this.deps.log.warn(
        { threadId: capsule.threadId, agentId: capsule.agentId, err },
        '[QueueProcessor] F224: resolveSessionStrategy failed for continuation enqueue, defaulting to enqueue',
      );
      return true;
    }
  }

  /**
   * F088 fix: Deliver collected outbound turns to bound external chats.
   * Mirrors ConnectorInvokeTrigger ⑥ logic: per-turn delivery, streaming cleanup, late-success fallback.
   */
  private async deliverOutbound(
    threadId: string,
    primaryAgent: string,
    invocationId: string,
    collectedTextParts: string[],
    outboundTurns: Array<{
      agentId: string;
      textParts: string[];
      richBlocks?: Array<{ kind: string; [key: string]: unknown }>;
    }>,
    persistenceContext: { richBlocks?: Array<{ kind: string; [key: string]: unknown }> },
    streamStartPromise: Promise<void> | undefined,
    log: LoggerLike,
    triggerMessageId?: string,
    deliveredTurnIndices?: Set<number>,
    preResolvedMeta?: ThreadMetaLike | undefined,
  ): Promise<void> {
    const finalContent =
      outboundTurns.length > 0 ? flattenTurnTextParts(outboundTurns) : flattenTextParts(collectedTextParts);

    // Finalize streaming — ensure start completed before ending
    if (this.deps.streamingHook) {
      if (streamStartPromise) {
        const STREAM_START_TIMEOUT_MS = 5000;
        await Promise.race([
          streamStartPromise,
          new Promise<void>((resolve) => setTimeout(resolve, STREAM_START_TIMEOUT_MS)),
        ]);
      }
      await this.deps.streamingHook.onStreamEnd(threadId, finalContent, invocationId).catch((err) => {
        log.warn({ err, threadId }, '[QueueProcessor] StreamingHook.onStreamEnd failed');
      });
    }

    const hasContent = collectedTextParts.length > 0 || outboundTurns.length > 0;
    if (this.deps.outboundHook && hasContent) {
      // F151: Use pre-resolved threadMeta from mid-loop delivery, or do fresh lookup
      let threadMeta: ThreadMetaLike | undefined = preResolvedMeta;
      if (threadMeta === undefined && !(deliveredTurnIndices && deliveredTurnIndices.size > 0)) {
        try {
          const LOOKUP_TIMEOUT_MS = 2000;
          const rawResult = this.deps.threadMetaLookup?.(threadId);
          if (rawResult) {
            const lookupPromise = Promise.resolve(rawResult).catch((err: unknown) => {
              log.warn({ err, threadId }, '[QueueProcessor] threadMetaLookup late rejection');
              return undefined;
            });
            const timeout = new Promise<undefined>((resolve) =>
              setTimeout(() => resolve(undefined), LOOKUP_TIMEOUT_MS),
            );
            threadMeta = await Promise.race([lookupPromise, timeout]);
          }
        } catch (lookupErr) {
          log.warn({ err: lookupErr, threadId }, '[QueueProcessor] threadMetaLookup failed');
        }
      }

      const DELIVER_TIMEOUT_MS = this.deps.deliverTimeoutMs ?? 10_000;
      // F151: skip turns already delivered mid-loop
      const nonEmptyTurns = outboundTurns.filter(
        (t, i) =>
          !(deliveredTurnIndices && deliveredTurnIndices.has(i)) &&
          (t.textParts.length > 0 || (t.richBlocks && t.richBlocks.length > 0)),
      );

      let deliveryFailed = false;
      const inflightDeliverPromises: Promise<void>[] = [];

      // BUG-5 (2026-03-25): iLink context_token is reusable — SINGLE_TOKEN_CONNECTORS
      // merge logic removed. Each turn now delivers independently for all connectors.
      if (nonEmptyTurns.length > 1) {
        for (const turn of nonEmptyTurns) {
          const turnContent = turn.textParts.join('');
          const deliverPromise = this.deps.outboundHook.deliver(
            threadId,
            turnContent,
            turn.agentId,
            turn.richBlocks,
            threadMeta,
            undefined,
            triggerMessageId,
          );
          inflightDeliverPromises.push(deliverPromise);
          try {
            await Promise.race([
              deliverPromise,
              new Promise<void>((_, reject) =>
                setTimeout(() => reject(new Error('deliver timeout')), DELIVER_TIMEOUT_MS),
              ),
            ]);
          } catch (err) {
            deliveryFailed = true;
            log.error({ err, threadId, agentId: turn.agentId }, '[QueueProcessor] Outbound delivery error');
          }
        }
      } else if (nonEmptyTurns.length === 1) {
        const turn = nonEmptyTurns[0];
        const richBlocks = persistenceContext.richBlocks ?? turn.richBlocks;
        const deliverPromise = this.deps.outboundHook.deliver(
          threadId,
          finalContent,
          turn.agentId,
          richBlocks,
          threadMeta,
          undefined,
          triggerMessageId,
        );
        inflightDeliverPromises.push(deliverPromise);
        try {
          await Promise.race([
            deliverPromise,
            new Promise<void>((_, reject) =>
              setTimeout(() => reject(new Error('deliver timeout')), DELIVER_TIMEOUT_MS),
            ),
          ]);
        } catch (err) {
          deliveryFailed = true;
          log.error({ err, threadId }, '[QueueProcessor] Outbound delivery error');
        }
      } else if (!(deliveredTurnIndices && deliveredTurnIndices.size > 0)) {
        // Fallback: no per-turn delivery happened — deliver remaining content as one
        const richBlocks = persistenceContext.richBlocks;
        if (richBlocks) {
          const deliverPromise = this.deps.outboundHook.deliver(
            threadId,
            finalContent,
            primaryAgent,
            richBlocks,
            threadMeta,
            undefined,
            triggerMessageId,
          );
          inflightDeliverPromises.push(deliverPromise);
          try {
            await Promise.race([
              deliverPromise,
              new Promise<void>((_, reject) =>
                setTimeout(() => reject(new Error('deliver timeout')), DELIVER_TIMEOUT_MS),
              ),
            ]);
          } catch (err) {
            deliveryFailed = true;
            log.error({ err, threadId }, '[QueueProcessor] Outbound delivery error');
          }
        }
      }

      if (!deliveryFailed && this.deps.streamingHook?.cleanupPlaceholders) {
        await this.deps.streamingHook.cleanupPlaceholders(threadId, invocationId).catch((err) => {
          log.warn({ err, threadId }, '[QueueProcessor] StreamingHook.cleanupPlaceholders failed');
        });
      } else if (deliveryFailed && this.deps.streamingHook?.cleanupPlaceholders) {
        const cleanupFn = this.deps.streamingHook.cleanupPlaceholders.bind(this.deps.streamingHook);
        Promise.allSettled(inflightDeliverPromises).then((results) => {
          if (results.every((r) => r.status === 'fulfilled')) {
            cleanupFn(threadId, invocationId).catch((err) => {
              log.warn({ err, threadId }, '[QueueProcessor] Placeholder cleanup failed after late-success delivery');
            });
          }
        });
      }
    } else {
      // R6+R7 fix: deliver fallback FIRST (with timeout), then cleanup placeholder
      // only on success — preserves "thinking" card if delivery fails (Cloud P2).
      // Timeout prevents adapter hang from pinning queue slot (Cloud P1).
      // R7: late-success cleanup mirrors normal content-delivery pattern (lines 1783-1798).
      const SILENT_DELIVER_TIMEOUT_MS = this.deps.deliverTimeoutMs ?? 10_000;
      let silentDeliveryOk = !this.deps.outboundHook;
      let silentDeliverPromise: Promise<void> | undefined;
      if (this.deps.outboundHook) {
        silentDeliverPromise = this.deps.outboundHook.deliver(
          threadId,
          '处理完成，但未产生回复内容。',
          primaryAgent,
          undefined,
          preResolvedMeta,
          undefined,
          triggerMessageId,
        );
        try {
          await Promise.race([
            silentDeliverPromise,
            new Promise<void>((_, reject) =>
              setTimeout(() => reject(new Error('deliver timeout')), SILENT_DELIVER_TIMEOUT_MS),
            ),
          ]);
          silentDeliveryOk = true;
        } catch (deliverErr) {
          log.error({ err: deliverErr, threadId }, '[QueueProcessor] Silent-path outbound delivery failed');
        }
      }
      if (silentDeliveryOk && this.deps.streamingHook?.cleanupPlaceholders) {
        await this.deps.streamingHook.cleanupPlaceholders(threadId, invocationId).catch((err) => {
          log.warn({ err, threadId }, '[QueueProcessor] StreamingHook.cleanupPlaceholders failed (silent)');
        });
      } else if (silentDeliverPromise && this.deps.streamingHook?.cleanupPlaceholders) {
        // R7: timeout fired but delivery may still succeed — defer cleanup to late-success
        const cleanupFn = this.deps.streamingHook.cleanupPlaceholders.bind(this.deps.streamingHook);
        silentDeliverPromise
          .then(() => {
            cleanupFn(threadId, invocationId).catch((err: unknown) => {
              log.warn({ err, threadId }, '[QueueProcessor] Silent late-success placeholder cleanup failed');
            });
          })
          .catch(() => {
            /* delivery truly failed — thinking card stays as fallback UX */
          });
      }
    }
  }

  /** Emit queue_paused to each user who has queued entries for this thread. */
  private async emitPausedToQueuedUsers(threadId: string, reason: 'canceled' | 'failed'): Promise<void> {
    const users = this.deps.queue.listUsersForThread(threadId);
    for (const userId of users) {
      const userQueue = this.deps.queue.list(threadId, userId);
      if (!userQueue.some((e) => e.status === 'queued')) continue;
      const enriched = await enrichQueueEntries(userQueue, this.deps.messageStore);
      this.deps.socketManager.emitToUser(userId, 'queue_paused', {
        threadId,
        reason,
        queue: enriched,
      });
    }
  }
}
