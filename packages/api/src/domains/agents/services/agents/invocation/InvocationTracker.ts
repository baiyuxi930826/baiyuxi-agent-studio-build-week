/**
 * Invocation Tracker (SlotTracker)
 * 追踪每个 thread 中每个智能体的活跃调用 — per-thread-per-agent 多槽
 *
 * F108: ExecutionSlot(threadId, agentId) 为并发执行的基本单元。
 * - 同一 agentId 在同一 thread 仍保持单锁语义（新调用 abort 旧调用）
 * - 不同 agentId 在同一 thread 可以并发执行
 *
 * F118 D3: TTL guard — slots exceeding maxSlotTtlMs are auto-cleaned on read.
 */

import { createModuleLogger } from '../../../../../infrastructure/logger.js';
import { resolveCliTimeoutMs } from '../../../../../utils/cli-timeout.js';

const log = createModuleLogger('invocation-tracker');

interface ActiveInvocation {
  controller: AbortController;
  userId: string;
  agentId: string;
  /** Agent(s) being invoked — used for cancel feedback broadcast */
  agentIds: string[];
  /** Server-side wall-clock start time (ms since epoch) */
  startedAt: number;
  /** For startAll slots: reference to the INDEPENDENT batch gate controller (whole-invocation
   *  abort — F-parallel-cancel). NOT a per-agent controller. */
  batchController?: AbortController;
  /**
   * F-parallel-cancel tombstone: 'active' = running; 'canceled' = single-agent cancelled but the
   * slot is RETAINED so getController() still returns the aborted controller. This is critical for
   * "pre-invoke cancel": a agent cancelled before the route layer grabbed its own signal must still
   * see an aborted signal (not fall back to the batch gate). Tombstones are inactive for has()/
   * busy gates and are purged at the next start-family or complete-family call for the slot.
   */
  state: 'active' | 'canceled';
  /** Abort reason recorded at cancel time (e.g. 'user_cancel' / 'preempted'). */
  cancelReason?: string;
}

/** F-parallel-cancel: observable slot lifecycle state for callers that need to distinguish
 *  "no slot" from "cancelled tombstone". */
export type SlotState = 'active' | 'canceled' | 'absent';

export interface ActiveSlotInfo {
  agentId: string;
  startedAt: number;
}

export interface CancelResult {
  cancelled: boolean;
  agentIds: string[];
}

export interface DeleteGuard {
  /** Whether the guard was acquired (no active invocation at acquire time) */
  acquired: boolean;
  /** Release the guard after delete completes (success or failure) */
  release: () => void;
}

export class InvocationTracker {
  /** Key: `${threadId}:${agentId}` (slotKey) */
  private active = new Map<string, ActiveInvocation>();
  private deleting = new Set<string>();
  /** F118 D3: max age before a slot is considered stale (default 2.5× CLI timeout = 75min) */
  private maxSlotTtlMs: number;

  constructor(opts?: { maxSlotTtlMs?: number }) {
    this.maxSlotTtlMs = opts?.maxSlotTtlMs ?? 2.5 * resolveCliTimeoutMs(undefined);
  }

  private slotKey(threadId: string, agentId: string): string {
    return `${threadId}:${agentId}`;
  }

  /** F118 D3: Check if an invocation has exceeded the TTL. Auto-deletes if expired. */
  private isExpired(key: string, inv: ActiveInvocation): boolean {
    if (Date.now() - inv.startedAt > this.maxSlotTtlMs) {
      this.active.delete(key);
      return true;
    }
    return false;
  }

  /**
   * Start a new invocation for a slot (threadId + agentId).
   * Only aborts existing invocation for the SAME slot — other agents' slots untouched.
   * If thread is being deleted, returns a pre-aborted controller.
   */
  start(threadId: string, agentId: string, userId: string = 'unknown', agentIds: string[] = []): AbortController {
    if (this.deleting.has(threadId)) {
      const controller = new AbortController();
      controller.abort();
      return controller;
    }
    const key = this.slotKey(threadId, agentId);
    // Abort existing invocation for this SAME slot only
    this.active.get(key)?.controller.abort('preempted');
    const controller = new AbortController();
    this.active.set(key, { controller, userId, agentId, agentIds, startedAt: Date.now(), state: 'active' });
    return controller;
  }

  /**
   * F122 Phase A.1: Non-preemptive thread-level start.
   * Atomically checks if ANY slot in the thread is active (or deleting),
   * then registers the new slot — all in one synchronous operation.
   *
   * Returns AbortController on success, null if thread is busy or deleting.
   * Unlike start(), this NEVER aborts existing invocations.
   */
  tryStartThread(
    threadId: string,
    agentId: string,
    userId: string = 'unknown',
    agentIds: string[] = [],
  ): AbortController | null {
    if (this.deleting.has(threadId)) return null;
    if (this.has(threadId)) return null;
    const controller = new AbortController();
    const key = this.slotKey(threadId, agentId);
    this.active.set(key, { controller, userId, agentId, agentIds, startedAt: Date.now(), state: 'active' });
    return controller;
  }

  /**
   * Atomically check-and-guard for thread deletion.
   * Synchronous: checks ALL slots + marks deleting in one tick.
   * Caller MUST call release() in a finally block after delete completes.
   */
  guardDelete(threadId: string): DeleteGuard {
    if (this.deleting.has(threadId)) {
      return { acquired: false, release: () => {} };
    }
    // Check if ANY slot is active for this thread
    if (this.has(threadId)) {
      return { acquired: false, release: () => {} };
    }
    this.deleting.add(threadId);
    return {
      acquired: true,
      release: () => this.deleting.delete(threadId),
    };
  }

  /**
   * Cancel an active invocation for a specific slot.
   * If requestUserId is provided, only cancels if it matches the invocation owner.
   * Optional abortReason is forwarded to AbortController.abort(reason).
   */
  cancel(threadId: string, agentId: string, requestUserId?: string, abortReason?: string): CancelResult {
    const key = this.slotKey(threadId, agentId);
    const inv = this.active.get(key);
    if (!inv) return { cancelled: false, agentIds: [] };
    if (requestUserId && inv.userId !== requestUserId) return { cancelled: false, agentIds: [] };
    const { agentIds } = inv;
    inv.controller.abort(abortReason);
    // F211-REG6 instrument (observation-only): the cancel funnel is the complete chokepoint for the
    // hardcoded 'user_cancel' reason (SocketManager:211 + queue.ts). Logging abortReason + msSinceStart
    // here (vs only at the WS layer) disambiguates WS-sourced cancels from any non-WS path, and a very
    // short msSinceStart hints at reconnect/teardown churn rather than a deliberate mid-turn Stop.
    log.info(
      {
        event: 'f211_reg6_invocation_abort',
        method: 'cancel',
        threadId,
        agentId,
        abortReason: abortReason ?? null,
        msSinceStart: Date.now() - inv.startedAt,
      },
      'F211-REG6: invocation aborted (cancel funnel) — abortReason provenance',
    );
    // F-parallel-cancel: tombstone — do NOT delete the slot. Keep it as a 'canceled' tombstone so
    // getController() still returns the aborted controller for a agent cancelled BEFORE the route
    // layer grabbed its own signal (pre-invoke cancel must not be lost / fall back to the batch
    // gate). Purged at the next start-family or complete-family call for this slot.
    inv.state = 'canceled';
    inv.cancelReason = abortReason;
    return { cancelled: true, agentIds };
  }

  /**
   * Cancel ALL active slots for a thread.
   * F156: When requestUserId is provided, only cancels invocations owned by that user.
   * Without requestUserId, cancels all (system/admin action, e.g. thread deletion).
   * Returns the agentIds that were actually cancelled (for orchestrator scoping).
   */
  cancelAll(threadId: string, requestUserId?: string, abortReason?: string): string[] {
    const prefix = `${threadId}:`;
    const cancelledAgentIds: string[] = [];
    // F211-REG6 instrument (observation-only): per-agent age evidence for the all-scope path,
    // mirroring cancel()'s msSinceStart. An all-scope cancel / force-reset must also answer
    // "just started" vs "ran a while" — without this, the cancelAll log can't distinguish them.
    const cancelledSlots: Array<{ agentId: string; msSinceStart: number }> = [];
    // F-parallel-cancel: cancelAll is the "stop the whole invocation" path (force-reset /
    // cancel_all button), so it must abort the INDEPENDENT batch gate too — single-agent cancel
    // does NOT (see startAll). Collect + dedup batch controllers of the slots we cancel.
    const batchControllers = new Set<AbortController>();
    for (const [key, inv] of this.active) {
      if (key.startsWith(prefix)) {
        if (requestUserId && inv.userId !== requestUserId) continue;
        cancelledAgentIds.push(inv.agentId);
        cancelledSlots.push({ agentId: inv.agentId, msSinceStart: Date.now() - inv.startedAt });
        inv.controller.abort(abortReason);
        if (inv.batchController) batchControllers.add(inv.batchController);
        this.active.delete(key);
      }
    }
    for (const bc of batchControllers) bc.abort(abortReason);
    if (cancelledAgentIds.length > 0) {
      // F211-REG6 instrument (observation-only): mirror the cancel() funnel for the cancel_all path.
      log.info(
        {
          event: 'f211_reg6_invocation_abort',
          method: 'cancelAll',
          threadId,
          abortReason: abortReason ?? null,
          cancelledAgentIds,
          cancelledSlots,
        },
        'F211-REG6: invocations aborted (cancelAll funnel) — abortReason provenance',
      );
    }
    return cancelledAgentIds;
  }

  /**
   * F-parallel-cancel (cloud #6 2026-05-30): SCOPED preempt — cancel only the invocation(s) the
   * given anchor agents belong to (their shared batch gate + every slot under it), NOT the whole
   * thread. `force` delivery uses this so preempting @codex doesn't also abort an unrelated `opus`
   * side-dispatch (whisper to an idle agent) running in the same thread. cancelAll() stays the
   * whole-thread reset (cancel_all button / thread delete). Returns cancelled agentIds for broadcast.
   */
  cancelInvocation(threadId: string, anchorAgents: string[], requestUserId?: string, abortReason?: string): string[] {
    const prefix = `${threadId}:`;
    const anchorSet = new Set(anchorAgents);
    // 1. Resolve the batch gate(s) the anchor agents belong to.
    const targetBatches = new Set<AbortController>();
    for (const agentId of anchorAgents) {
      const inv = this.active.get(this.slotKey(threadId, agentId));
      if (!inv) continue;
      if (requestUserId && inv.userId !== requestUserId) continue;
      if (inv.batchController) targetBatches.add(inv.batchController);
    }
    // 2. Cancel the anchors themselves + any slot sharing a target batch gate (the anchor's whole
    //    invocation, incl. multi-agent siblings). Slots under a DIFFERENT batch (or a standalone
    //    side-dispatch) are left running — that is the whole point vs cancelAll().
    const cancelledAgentIds: string[] = [];
    for (const [key, inv] of this.active) {
      if (!key.startsWith(prefix)) continue;
      if (requestUserId && inv.userId !== requestUserId) continue;
      const isAnchor = anchorSet.has(inv.agentId);
      const sharesBatch = inv.batchController !== undefined && targetBatches.has(inv.batchController);
      if (!isAnchor && !sharesBatch) continue;
      cancelledAgentIds.push(inv.agentId);
      inv.controller.abort(abortReason);
      this.active.delete(key);
    }
    for (const bc of targetBatches) bc.abort(abortReason);
    return cancelledAgentIds;
  }

  /** Get the userId who started the invocation for a specific slot. */
  getUserId(threadId: string, agentId: string): string | null {
    const key = this.slotKey(threadId, agentId);
    return this.active.get(key)?.userId ?? null;
  }

  /** Get target agent IDs of the active invocation for a specific slot. */
  getAgentIds(threadId: string, agentId: string): string[] {
    const key = this.slotKey(threadId, agentId);
    return this.active.get(key)?.agentIds ?? [];
  }

  /**
   * Get the AbortController for a specific slot, so the execution layer can subscribe
   * to a agent's OWN cancel signal (per-agent isolation). Returns undefined if there is no
   * active (non-expired) slot.
   *
   * F-parallel-cancel: startAll/tryStartThreadAll give each agent an INDEPENDENT controller
   * but only RETURN primaryController (agentIds[0]'s). Concurrent execution must resolve
   * each agent's signal through this getter — using the shared primaryController.signal made
   * "cancel one agent" abort all siblings (and "cancel a non-primary agent" abort nothing).
   */
  getController(threadId: string, agentId: string): AbortController | undefined {
    const key = this.slotKey(threadId, agentId);
    const inv = this.active.get(key);
    if (!inv) return undefined;
    if (this.isExpired(key, inv)) return undefined;
    // NOTE: a 'canceled' tombstone intentionally still returns its (now aborted) controller —
    // that is the whole point of the tombstone (pre-invoke cancel must surface an aborted signal).
    return inv.controller;
  }

  /**
   * F-parallel-cancel: observable slot lifecycle state — distinguishes 'absent' (no slot),
   * 'canceled' (cancelled tombstone), and 'active'. Lets callers tell "this agent was singly
   * cancelled" apart from "never tracked" without relying on raw undefined (which conflates the
   * two and re-creates the false-green route gap).
   */
  getSlotState(threadId: string, agentId: string): SlotState {
    const key = this.slotKey(threadId, agentId);
    const inv = this.active.get(key);
    if (!inv) return 'absent';
    if (this.isExpired(key, inv)) return 'absent';
    return inv.state;
  }

  /**
   * F-parallel-cancel: aggregate final status of a (possibly multi-agent) invocation, per the model
   * agreed with 砚砚:
   *  - whole-invocation abort (batch gate aborted: cancelAll / force / thread-delete / preempt)
   *    → 'canceled_by_user' (user_cancel/cancel_all reason) or 'canceled' (other reasons)
   *  - else if EVERY target agent is a canceled tombstone → 'canceled_by_user' (cancelled agent-by-agent)
   *  - else → 'succeeded' (at least one agent ran to completion)
   * `controller.signal.aborted` alone now means ONLY whole-invocation abort — a single-agent cancel
   * no longer aborts the batch gate, so callers must use this aggregate rather than raw `.aborted`.
   */
  resolveFinalStatus(
    threadId: string,
    targetAgents: readonly string[],
    batch: { aborted: boolean; reason?: string },
  ): 'succeeded' | 'canceled' | 'canceled_by_user' {
    if (batch.aborted) {
      return batch.reason === 'user_cancel' || batch.reason === 'cancel_all' ? 'canceled_by_user' : 'canceled';
    }
    if (targetAgents.length === 0) return 'succeeded';
    const allCanceled = targetAgents.every((c) => this.getSlotState(threadId, c) === 'canceled');
    return allCanceled ? 'canceled_by_user' : 'succeeded';
  }

  /** Mark an invocation as complete (cleanup). Only removes if controller matches. */
  complete(threadId: string, agentId: string, controller?: AbortController): void {
    const key = this.slotKey(threadId, agentId);
    const inv = this.active.get(key);
    if (!inv) return;
    if (controller && inv.controller !== controller) return;
    // F-parallel-cancel (cloud P1): keep a CANCELED tombstone so aggregate resolveFinalStatus()
    // still sees this agent was cancelled. Route consumers call complete/completeSlot on the
    // abort-induced terminal (error/done) message BEFORE the aggregate finalStatus check; deleting
    // here would make getSlotState() return 'absent' → 'succeeded' even though the user cancelled.
    // Canceled tombstones are purged on the next start*/tryStart* for the slot (re-occupation).
    if (inv.state === 'canceled') return;
    this.active.delete(key);
  }

  /**
   * Mark a SINGLE slot from a batch invocation as complete.
   * Unlike complete(), this also matches batchController so a startAll()/tryStartThreadAll()
   * caller can retire finished agents one-by-one without waiting for the whole batch.
   */
  completeSlot(threadId: string, agentId: string, controller?: AbortController): void {
    const key = this.slotKey(threadId, agentId);
    const inv = this.active.get(key);
    if (!inv) return;
    if (controller && inv.controller !== controller && inv.batchController !== controller) return;
    // F-parallel-cancel (cloud P1): keep a CANCELED tombstone (see complete()) — completeSlot is
    // exactly the call route consumers fire on the abort-induced terminal message BEFORE the
    // aggregate finalStatus check, so deleting a canceled slot here would lose the cancellation
    // and resolveFinalStatus() would wrongly return 'succeeded'.
    if (inv.state === 'canceled') return;
    this.active.delete(key);
  }

  /**
   * Whether a thread/slot has an active invocation.
   * - has(threadId, agentId) — specific slot check
   * - has(threadId) — any slot active in thread?
   */
  has(threadId: string, agentId?: string): boolean {
    if (agentId) {
      const key = this.slotKey(threadId, agentId);
      const inv = this.active.get(key);
      if (!inv) return false;
      // F-parallel-cancel: a canceled tombstone is INACTIVE (slot retained only so getController
      // can still hand back the aborted controller for a pre-invoke cancel).
      if (inv.state === 'canceled') return false;
      return !this.isExpired(key, inv);
    }
    // Thread-level: check if ANY non-expired, non-canceled slot is active
    const prefix = `${threadId}:`;
    for (const [key, inv] of this.active) {
      if (key.startsWith(prefix) && inv.state !== 'canceled' && !this.isExpired(key, inv)) return true;
    }
    return false;
  }

  /**
   * Start tracking ALL target agents for a unified multi-agent dispatch.
   * Each agent gets its own independent AbortController (per-agent cancel safe).
   * Returns the primaryAgent's (agentIds[0]) controller for execution signal.
   * All slots share a `batchController` ref so completeAll can match the batch.
   */
  startAll(threadId: string, agentIds: string[], userId: string = 'unknown'): AbortController {
    if (this.deleting.has(threadId)) {
      const controller = new AbortController();
      controller.abort();
      return controller;
    }
    const now = Date.now();
    // F-parallel-cancel: batchController is the "whole-invocation gate" — INDEPENDENT from any
    // per-agent controller. Canceling one agent aborts only that agent's own controller, NOT this batch
    // controller, so upper consumers that gate on the returned controller (messages.ts pre-check /
    // QueueProcessor break + record-canceled) don't mistake a single-agent cancel for a
    // whole-invocation cancel. cancelAll aborts the batch controller. Per-agent execution signals are
    // resolved via getController(threadId, agentId) (route layer signalForAgent), not this return value.
    const batchController = new AbortController();
    for (const agentId of agentIds) {
      const key = this.slotKey(threadId, agentId);
      this.active.get(key)?.controller.abort('preempted');
      const controller = new AbortController();
      this.active.set(key, { controller, userId, agentId, agentIds, startedAt: now, batchController, state: 'active' });
    }
    return batchController;
  }

  /**
   * Track an additional slot that is executed by an already-running route.
   * Used by routeSerial A2A worklist targets so thread-level queue gates stay
   * busy after the original agent completes and before the A2A target runs.
   */
  trackExternalSlot(
    threadId: string,
    agentId: string,
    controller: AbortController,
    userId: string = 'unknown',
    agentIds: string[] = [agentId],
  ): boolean {
    if (this.deleting.has(threadId)) return false;
    const key = this.slotKey(threadId, agentId);
    const existing = this.active.get(key);
    // A2A re-track must REPLACE a 'canceled' tombstone, not idempotently keep it. getController()
    // intentionally returns a tombstone's aborted controller (pre-invoke cancel semantics); if a
    // freshly-handed-off A2A target still has a prior-turn canceled tombstone, route-serial reads that
    // aborted signal via signalForAgent and skips the target at the top of the worklist loop — the agent
    // silently never invokes. Tombstones are purged by start-/complete-family calls; trackExternalSlot
    // is the A2A re-occupation path and must do the same. (bug: 2026-06-11 a2a-handoff-no-spawn.)
    if (existing && !this.isExpired(key, existing) && existing.state !== 'canceled') {
      // Idempotent if this slot already tracks the same batch. The passed `controller` is the
      // batch gate (route-serial's options.invocationController), stored as batchController below.
      return existing.batchController === controller || existing.controller === controller;
    }
    // F-parallel-cancel (cloud #5 2026-05-30): the passed `controller` is route-serial's BATCH GATE
    // (options.invocationController = startAll() return value). Storing it as slot.controller would
    // make cancel(threadId, agentB) abort the batch gate → the whole serial worklist stops when the
    // user only cancelled the pending A2A target. Give the A2A slot its OWN controller so a
    // single-agent cancel (getController → signalForAgent → this controller) stops only agentB; keep the
    // batch gate as batchController so cancelAll (whole-invocation stop) still cascades.
    this.active.set(key, {
      controller: new AbortController(),
      userId,
      agentId,
      agentIds,
      startedAt: Date.now(),
      batchController: controller,
      state: 'active',
    });
    return true;
  }

  /**
   * Non-preemptive thread-level start for ALL target agents.
   * Atomically checks if ANY slot is active, then registers all agents with independent controllers.
   */
  tryStartThreadAll(threadId: string, agentIds: string[], userId: string = 'unknown'): AbortController | null {
    if (this.deleting.has(threadId)) return null;
    if (this.has(threadId)) return null;
    const now = Date.now();
    // F-parallel-cancel: independent batch gate (see startAll) — single-agent cancel must not trip
    // the whole-invocation gate; per-agent signals come from getController(threadId, agentId).
    const batchController = new AbortController();
    for (const agentId of agentIds) {
      const key = this.slotKey(threadId, agentId);
      const controller = new AbortController();
      this.active.set(key, { controller, userId, agentId, agentIds, startedAt: now, batchController, state: 'active' });
    }
    return batchController;
  }

  /**
   * Complete ALL slots for the given agents.
   * Matches via controller OR batchController — safe for startAll batches
   * where each agent has an independent controller but shares batchController.
   */
  completeAll(threadId: string, agentIds: string[], controller?: AbortController): void {
    for (const agentId of agentIds) {
      const key = this.slotKey(threadId, agentId);
      const inv = this.active.get(key);
      if (!inv) continue;
      if (controller) {
        if (inv.controller !== controller && inv.batchController !== controller) continue;
      }
      // F-parallel-cancel (cloud P1): keep CANCELED tombstones (see complete()) — consistent with
      // complete/completeSlot so aggregate resolveFinalStatus() never loses cancellation state.
      // Purged on next start*/tryStart* re-occupation (+ TTL as backstop).
      if (inv.state === 'canceled') continue;
      this.active.delete(key);
    }
  }

  /** Get all active slot info for a thread (agentId + startedAt for F5 recovery). */
  getActiveSlots(threadId: string): ActiveSlotInfo[] {
    const prefix = `${threadId}:`;
    const result: ActiveSlotInfo[] = [];
    for (const [key, inv] of this.active) {
      // F-parallel-cancel: a canceled tombstone is not an active slot.
      if (key.startsWith(prefix) && inv.state !== 'canceled' && !this.isExpired(key, inv)) {
        result.push({ agentId: inv.agentId, startedAt: inv.startedAt });
      }
    }
    return result;
  }

  /** Whether a thread is currently being deleted (delete guard active). */
  isDeleting(threadId: string): boolean {
    return this.deleting.has(threadId);
  }
}
