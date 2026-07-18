/**
 * F173 Phase B: Thread-Runtime Ledger.
 *
 * Per-thread, runtime-only state container that replaces the scattered
 * top-level Maps in useAgentMessages.ts (active/finalized/replaced/
 * sawStreamData/pendingTimeoutDiag/timeoutHandle/lastObservedExplicitInvocationId).
 *
 * Design (砚砚 2026-04-22 push back + Phase B kickoff alignment):
 * - Map<threadId, ThreadRuntimeRefs> — explicit per-thread isolation, no shared
 *   mutable refs across threads
 * - Each leaf carries explicit TTL (expiresAt) so callback merge windows /
 *   replaced suppression / late-event tolerance can be reasoned about
 * - lastObservedExplicitInvocationId replaces the agentInvocations fallback that
 *   AC-B9 wanted to retire (ledger-local, not global UI state)
 * - timeoutHandle is per-thread so cleanup cancels at thread granularity
 *
 * Pure module — no React, no zustand, no socket. Testable in isolation.
 */

type AgentId = string;
type InvocationId = string;
type ThreadId = string;

/**
 * F194 cloud R3 (2026-06-15, 砚砚 co-author): runtime-only provenance of how the
 * active bubble got seeded — distinguishes THIS turn's fresh seed (safe to upgrade
 * to a turn id) from an earlier same-parent residue (must stay isolated). NOT
 * persisted to ChatMessage.extra; lives only in the in-memory runtime ledger.
 *  - 'fresh-parent-seed': created this turn before the turn id was known (parent-only).
 *  - 'recovered': adopted from an existing identity-matched in-flight bubble.
 *  - 'bound': bound to a resolved turn id.
 */
export type ActiveSeedSource = 'fresh-parent-seed' | 'recovered' | 'bound';

export type ActiveEntry = {
  messageId: string;
  invocationId?: string;
  seedSource?: ActiveSeedSource;
  /** Runtime-only proof that a fresh parent seed was created in the current pre-turn event segment. */
  freshParentSeedAt?: number;
  freshParentSeedSeq?: number;
  lastTouched: number;
};

export type FinalizedEntry = {
  messageId: string;
  invocationId?: string;
  /** Callback merge window — late callback within this TTL can still merge into the bubble. */
  expiresAt: number;
};

export type ReplacedEntry = {
  /** Late stream/event suppression window for this replaced invocationId. */
  expiresAt: number;
};

export type SawStreamDataEntry = {
  invocationId?: string;
  lastTouched: number;
};

export type ThreadRuntimeRefs = {
  active: Map<AgentId, ActiveEntry>;
  finalized: Map<AgentId, FinalizedEntry>;
  replaced: Map<AgentId, Map<InvocationId, ReplacedEntry>>;
  sawStreamData: Map<AgentId, SawStreamDataEntry>;
  pendingTimeoutDiag: Map<AgentId, Record<string, unknown>>;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
  lastObservedExplicitInvocationId: Map<AgentId, InvocationId>;
  lastTouched: number;
};

export type ThreadRuntimeLedger = {
  getOrCreate(threadId: ThreadId): ThreadRuntimeRefs;
  /** Read-only existence check, does NOT touch lastTouched. */
  has(threadId: ThreadId): boolean;
  /** Hard delete. Used by AC-B3 GC sweep + thread record delete event. */
  remove(threadId: ThreadId): void;
  /** Read-only iteration, does NOT touch lastTouched. Used by sweep. */
  entries(): IterableIterator<[ThreadId, ThreadRuntimeRefs]>;
};

export function createThreadRuntimeLedger(): ThreadRuntimeLedger {
  const refs = new Map<ThreadId, ThreadRuntimeRefs>();

  function makeEntry(): ThreadRuntimeRefs {
    return {
      active: new Map(),
      finalized: new Map(),
      replaced: new Map(),
      sawStreamData: new Map(),
      pendingTimeoutDiag: new Map(),
      timeoutHandle: null,
      lastObservedExplicitInvocationId: new Map(),
      lastTouched: Date.now(),
    };
  }

  return {
    getOrCreate(threadId) {
      let entry = refs.get(threadId);
      if (!entry) {
        entry = makeEntry();
        refs.set(threadId, entry);
      } else {
        entry.lastTouched = Date.now();
      }
      return entry;
    },
    has(threadId) {
      return refs.has(threadId);
    },
    remove(threadId) {
      refs.delete(threadId);
    },
    entries() {
      return refs.entries();
    },
  };
}

/**
 * AC-B9: record the last explicit invocationId observed for a (thread, agent).
 *
 * Replaces the global `agentInvocations` fallback in `shouldSuppressLateStreamChunk`.
 * When a stream chunk arrives without an explicit `msg.invocationId`, callers
 * use `getLastObservedExplicit` (ledger-local) instead of reading global UI state.
 */
export function markExplicitInvocationObserved(
  ledger: ThreadRuntimeLedger,
  threadId: ThreadId,
  agentId: AgentId,
  invocationId: InvocationId,
): void {
  const entry = ledger.getOrCreate(threadId);
  entry.lastObservedExplicitInvocationId.set(agentId, invocationId);
}

export function getLastObservedExplicit(
  ledger: ThreadRuntimeLedger,
  threadId: ThreadId,
  agentId: AgentId,
): InvocationId | undefined {
  const entry = ledger.getOrCreate(threadId);
  return entry.lastObservedExplicitInvocationId.get(agentId);
}

/**
 * AC-B6: mark a (thread, agent, invocationId) as replaced, with explicit TTL.
 *
 * The TTL is the late-event suppression window — events arriving for this
 * invocationId within ttlMs after the mark will be suppressed. After ttlMs,
 * the marker can be evicted (`evictExpiredReplaced`) and late events are
 * treated as fresh (rare path, but unavoidable in network reorder).
 */
export function markInvocationReplaced(
  ledger: ThreadRuntimeLedger,
  threadId: ThreadId,
  agentId: AgentId,
  invocationId: InvocationId,
  ttlMs: number,
): void {
  const entry = ledger.getOrCreate(threadId);
  let perAgent = entry.replaced.get(agentId);
  if (!perAgent) {
    perAgent = new Map();
    entry.replaced.set(agentId, perAgent);
  }
  perAgent.set(invocationId, { expiresAt: Date.now() + ttlMs });
}

export function isInvocationReplaced(
  ledger: ThreadRuntimeLedger,
  threadId: ThreadId,
  agentId: AgentId,
  invocationId: InvocationId,
): boolean {
  const entry = ledger.getOrCreate(threadId);
  const perAgent = entry.replaced.get(agentId);
  if (!perAgent) return false;
  const marker = perAgent.get(invocationId);
  if (!marker) return false;
  return marker.expiresAt > Date.now();
}

/**
 * AC-B6: drop replaced markers whose TTL has elapsed.
 * Returns the count of evicted markers (across all agents in this thread).
 */
export function evictExpiredReplaced(ledger: ThreadRuntimeLedger, threadId: ThreadId): number {
  const entry = ledger.getOrCreate(threadId);
  const now = Date.now();
  let evicted = 0;
  for (const [, perAgent] of entry.replaced) {
    for (const [invocationId, marker] of perAgent) {
      if (marker.expiresAt <= now) {
        perAgent.delete(invocationId);
        evicted++;
      }
    }
  }
  return evicted;
}

/**
 * AC-B1/B5/B7: register the currently active bubble for a (thread, agent).
 *
 * "Active" = the bubble that should receive subsequent stream chunks and
 * terminal events for this agent. Replaces the global activeRefs Map in
 * useAgentMessages.ts.
 */
export function setActiveBubble(
  ledger: ThreadRuntimeLedger,
  threadId: ThreadId,
  agentId: AgentId,
  bubble: {
    messageId: string;
    invocationId?: string;
    seedSource?: ActiveSeedSource;
    freshParentSeedAt?: number;
    freshParentSeedSeq?: number;
  },
): void {
  const entry = ledger.getOrCreate(threadId);
  entry.active.set(agentId, {
    messageId: bubble.messageId,
    ...(bubble.invocationId ? { invocationId: bubble.invocationId } : {}),
    ...(bubble.seedSource ? { seedSource: bubble.seedSource } : {}),
    ...(bubble.freshParentSeedAt !== undefined ? { freshParentSeedAt: bubble.freshParentSeedAt } : {}),
    ...(bubble.freshParentSeedSeq !== undefined ? { freshParentSeedSeq: bubble.freshParentSeedSeq } : {}),
    lastTouched: Date.now(),
  });
}

/**
 * Read the current active bubble for a (thread, agent), if any.
 */
export function getActiveBubble(
  ledger: ThreadRuntimeLedger,
  threadId: ThreadId,
  agentId: AgentId,
): ActiveEntry | undefined {
  const entry = ledger.getOrCreate(threadId);
  return entry.active.get(agentId);
}

/**
 * Clear the active bubble for a (thread, agent). Used on terminal / replace.
 * No-op if nothing is set.
 */
export function clearActiveBubble(ledger: ThreadRuntimeLedger, threadId: ThreadId, agentId: AgentId): void {
  const entry = ledger.getOrCreate(threadId);
  entry.active.delete(agentId);
}

/**
 * Record that a (thread, agent) has produced at least one stream data chunk.
 * Used by terminal handlers to distinguish "genuine empty" vs "had content".
 * Replaces the top-level sawStreamDataRef Set in useAgentMessages.ts.
 */
export function markStreamData(
  ledger: ThreadRuntimeLedger,
  threadId: ThreadId,
  agentId: AgentId,
  invocationId?: InvocationId,
): void {
  const entry = ledger.getOrCreate(threadId);
  entry.sawStreamData.set(agentId, {
    ...(invocationId ? { invocationId } : {}),
    lastTouched: Date.now(),
  });
}

export function hadStreamData(ledger: ThreadRuntimeLedger, threadId: ThreadId, agentId: AgentId): boolean {
  const entry = ledger.getOrCreate(threadId);
  return entry.sawStreamData.has(agentId);
}

/**
 * Clear sawStreamData marker for a (thread, agent). Used after terminal
 * processing finishes attributing the empty/non-empty signal.
 */
export function clearStreamData(ledger: ThreadRuntimeLedger, threadId: ThreadId, agentId: AgentId): void {
  const entry = ledger.getOrCreate(threadId);
  entry.sawStreamData.delete(agentId);
}

/**
 * AC-B10: decide what to do with a terminal event (done/error/cancel).
 *
 * Returns a decision object so callers don't have to recompute slot-fresh /
 * fallback decisions at the call site. `source` exposes how we identified the
 * target so logging/diagnostics can attribute the decision.
 *
 * Decision rules (in order) — ledger only short-circuits with POSITIVE signal:
 *  1. explicit invocationId AND in replaced map → stale=true, source='explicit'
 *  2. explicit invocationId AND matches active bubble → stale=false, source='explicit', targetMessageId
 *  3. no explicit invocationId AND active bubble exists for agent → stale=false, source='active', targetMessageId
 *  4. nothing matched → stale=false, source='none' — defer to caller's legacy
 *     4-source resolver (isStaleTerminalEvent) for invocationless terminals
 *     when ledger has no positive signal
 *
 * (slotFresh source is reserved for future InvocationTracker slot-fresh signal
 * integration; not yet wired in pure ledger.)
 *
 * Cloud Codex P1 round 2 (2026-04-24): earlier revisions had an
 * 'unboundFallback' branch that marked invocationless terminals stale when
 * lastObservedExplicit was replaced. That signal is not updated in callback-
 * only runs (markSawStream is stream-path only), so the branch could skip
 * legitimate cleanup for the new invocation. The branch was removed; ledger
 * no longer uses negative inference. 'unboundFallback' has been dropped from
 * TerminalDecisionSource.
 */
export type TerminalDecisionSource = 'explicit' | 'active' | 'slotFresh' | 'none';

export type TerminalDecision = {
  stale: boolean;
  source: TerminalDecisionSource;
  targetMessageId?: string;
};

export function decideTerminalEventTarget(
  ledger: ThreadRuntimeLedger,
  threadId: ThreadId,
  agentId: AgentId,
  explicitInvocationId: InvocationId | undefined,
): TerminalDecision {
  const entry = ledger.getOrCreate(threadId);
  const active = entry.active.get(agentId);

  if (explicitInvocationId) {
    if (isInvocationReplaced(ledger, threadId, agentId, explicitInvocationId)) {
      return { stale: true, source: 'explicit' };
    }
    if (active && active.invocationId === explicitInvocationId) {
      return { stale: false, source: 'explicit', targetMessageId: active.messageId };
    }
    return { stale: false, source: 'none' };
  }

  // For invocationless terminals with a live active bubble, honor active as
  // the "this agent has work in flight" signal. If no active bubble either,
  // fall through to source='none' so the caller's legacy 4-source resolver
  // decides. Ledger does NOT use lastObservedExplicit as a stale signal on
  // its own — see round 2 note on the TerminalDecisionSource type for why.
  if (active) {
    return { stale: false, source: 'active', targetMessageId: active.messageId };
  }

  // Cloud Codex P1 (2026-04-24 round 2): do NOT mark stale based on
  // `lastObservedExplicit` alone. In callback-only runs, `markSawStream` is
  // not called (stream-only write path), so `lastObservedExplicit` never
  // updates for the new invocation and can still point at the old replaced
  // one. Marking stale there skips legitimate terminal cleanup and leaves
  // the thread stuck in-running. Defer to the legacy resolver: return
  // source='none' so the caller's 4-source resolver can decide.
  return { stale: false, source: 'none' };
}

/**
 * AC-B3/B5: register a finalized bubble with a callback merge window TTL.
 *
 * Late callbacks arriving within ttlMs after finalize can still merge into
 * this bubble (consistent with `findAssistantDuplicate` Phase 2 soft rule).
 * After ttlMs, the finalized entry is treated as evictable by sweep.
 */
export function setFinalizedBubble(
  ledger: ThreadRuntimeLedger,
  threadId: ThreadId,
  agentId: AgentId,
  bubble: { messageId: string; invocationId?: string },
  ttlMs: number,
): void {
  const entry = ledger.getOrCreate(threadId);
  entry.finalized.set(agentId, {
    messageId: bubble.messageId,
    ...(bubble.invocationId ? { invocationId: bubble.invocationId } : {}),
    expiresAt: Date.now() + ttlMs,
  });
}

/**
 * AC-B3 helper: read-only existence check (no touch).
 */
export function hasThread(ledger: ThreadRuntimeLedger, threadId: ThreadId): boolean {
  return ledger.has(threadId);
}

/**
 * Read the finalized bubble messageId for a (thread, agent) within its callback
 * merge window. Returns undefined if no finalized entry OR it has expired.
 */
export function getFinalizedMessageId(
  ledger: ThreadRuntimeLedger,
  threadId: ThreadId,
  agentId: AgentId,
): string | undefined {
  const entry = ledger.getOrCreate(threadId);
  const finalized = entry.finalized.get(agentId);
  if (!finalized) return undefined;
  if (finalized.expiresAt <= Date.now()) return undefined;
  return finalized.messageId;
}

/**
 * Clear the finalized bubble entry for a (thread, agent). Used when the next
 * invocation starts and the old finalized is no longer relevant.
 */
export function clearFinalized(ledger: ThreadRuntimeLedger, threadId: ThreadId, agentId: AgentId): void {
  const entry = ledger.getOrCreate(threadId);
  entry.finalized.delete(agentId);
}

/**
 * Clear ALL finalized bubble entries for a thread (across all agents).
 * Used by useAgentMessages.resetRefs when navigation / explicit reset happens
 * — preserves the original "stale finalized must not patch new callback"
 * semantic that the per-agent ref's .clear() used to provide.
 */
export function clearAllFinalizedForThread(ledger: ThreadRuntimeLedger, threadId: ThreadId): void {
  const entry = ledger.getOrCreate(threadId);
  entry.finalized.clear();
}

/**
 * AC-B6 selective clear: drop ALL replaced markers for a (thread, agent) pair.
 * Used by callers that want to forget an entire invocation lineage on the
 * agent (e.g. user-explicit cancel, thread-scoped reset).
 */
export function clearAllReplacedForAgent(ledger: ThreadRuntimeLedger, threadId: ThreadId, agentId: AgentId): void {
  const entry = ledger.getOrCreate(threadId);
  entry.replaced.delete(agentId);
}

/**
 * AC-B6 selective surgical remove: drop a single (thread, agent, invocationId)
 * marker without touching others. Mirrors `removeReplacedInvocation` from the
 * old shared-replaced-invocations module.
 */
export function removeReplacedInvocationFromLedger(
  ledger: ThreadRuntimeLedger,
  threadId: ThreadId,
  agentId: AgentId,
  invocationId: InvocationId,
): void {
  const entry = ledger.getOrCreate(threadId);
  const perAgent = entry.replaced.get(agentId);
  if (!perAgent) return;
  perAgent.delete(invocationId);
  if (perAgent.size === 0) entry.replaced.delete(agentId);
}

/**
 * AC-B6 thread-level clear: drop ALL replaced markers across ALL agents in a
 * thread. Used by `clearReplacedInvocationsForThread` from the old shared
 * module — preserves the per-thread isolation expected by handleStop /
 * resetRefs.
 */
export function clearAllReplacedForThread(ledger: ThreadRuntimeLedger, threadId: ThreadId): void {
  const entry = ledger.getOrCreate(threadId);
  entry.replaced.clear();
}

/**
 * Iterate active bubbles for a thread (read-only). Used by handlers that
 * scan all active agents (e.g. timeout cleanup). Empty iterator if thread has
 * no active bubbles.
 */
export function getAllActiveBubblesForThread(
  ledger: ThreadRuntimeLedger,
  threadId: ThreadId,
): IterableIterator<[AgentId, ActiveEntry]> {
  const entry = ledger.getOrCreate(threadId);
  return entry.active.entries();
}

/**
 * Count of active bubbles in a thread. Used for diagnostic logging.
 */
export function getActiveBubbleCount(ledger: ThreadRuntimeLedger, threadId: ThreadId): number {
  const entry = ledger.getOrCreate(threadId);
  return entry.active.size;
}

/**
 * Clear ALL active bubbles for a thread. Used by handleStop and resetRefs
 * (preserves the per-agent ref's .clear() semantic on explicit reset events).
 */
export function clearAllActiveBubblesForThread(ledger: ThreadRuntimeLedger, threadId: ThreadId): void {
  const entry = ledger.getOrCreate(threadId);
  entry.active.clear();
}

/**
 * F118 AC-C3: pendingTimeoutDiag — keyed by (thread, agent) to prevent
 * cross-agent mismatch. Replaces the top-level pendingTimeoutDiagRef Map.
 */
export function setPendingTimeoutDiag(
  ledger: ThreadRuntimeLedger,
  threadId: ThreadId,
  agentId: AgentId,
  diag: Record<string, unknown>,
): void {
  const entry = ledger.getOrCreate(threadId);
  entry.pendingTimeoutDiag.set(agentId, diag);
}

export function getPendingTimeoutDiag(
  ledger: ThreadRuntimeLedger,
  threadId: ThreadId,
  agentId: AgentId,
): Record<string, unknown> | null {
  const entry = ledger.getOrCreate(threadId);
  return entry.pendingTimeoutDiag.get(agentId) ?? null;
}

export function clearPendingTimeoutDiag(ledger: ThreadRuntimeLedger, threadId: ThreadId, agentId: AgentId): void {
  const entry = ledger.getOrCreate(threadId);
  entry.pendingTimeoutDiag.delete(agentId);
}

/**
 * AC-B3: hard delete a thread's runtime entry.
 *
 * Use only when the thread record itself is deleted (server-confirmed).
 * UI close / thread switch / hide → NOT this. Those go through the GC sweep
 * with idle threshold (1h) so transient navigation doesn't lose state.
 */
export function removeThread(ledger: ThreadRuntimeLedger, threadId: ThreadId): void {
  ledger.remove(threadId);
}

/**
 * AC-B3: GC sweep — drop thread entries that meet ALL of:
 *   - lastTouched < cutoff (idle past threshold)
 *   - no active bubbles (entry.active.size === 0)
 *   - no finalized bubble within callback merge window (all finalized expired)
 *
 * `event handler 进来第一步 touch` 保证刚到的事件不会被误吃 — sweep 用 read-only
 * `entries()` 不会更新 lastTouched，只有真正 idle 的 thread 才命中。
 *
 * Returns the number of threads dropped.
 */
export function sweepIdleThreads(ledger: ThreadRuntimeLedger, cutoff: number): number {
  const now = Date.now();
  const toDrop: ThreadId[] = [];

  for (const [threadId, entry] of ledger.entries()) {
    if (entry.lastTouched >= cutoff) continue; // fresh
    if (entry.active.size > 0) continue; // still has active bubbles
    // Check finalized callback merge window
    let hasPendingFinalized = false;
    for (const [, finalized] of entry.finalized) {
      if (finalized.expiresAt > now) {
        hasPendingFinalized = true;
        break;
      }
    }
    if (hasPendingFinalized) continue;
    toDrop.push(threadId);
  }

  for (const threadId of toDrop) {
    ledger.remove(threadId);
  }
  return toDrop.length;
}
