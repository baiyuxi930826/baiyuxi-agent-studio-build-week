/**
 * F194: Invocation Liveness Canonical Read Model
 *
 * Read-only helper that answers "which invocations are live for (threadId, userId)?"
 * by reconciling three independent stores with non-equivalent semantics:
 *
 * - InvocationTracker  → per-process control plane (AbortController) — NOT a lifecycle SoT
 * - InvocationRecord   → cross-process lifecycle SoT (status='running'/'done'/...) — may be zombie
 * - DraftStore         → 300s TTL content cache; draft.updatedAt is the freshness proxy
 *
 * Decision table (KD-3, KD-6 + R1 P1-1/P1-2 from 砚砚 review 2026-05-07):
 *
 * | record  | tracker          | draft fresh? | result                                                  |
 * |---------|------------------|--------------|---------------------------------------------------------|
 * | running | active+assoc     | —            | active source='record+tracker' degraded=false           |
 * | running | active no assoc  | yes          | active source='record+draft' degraded=true              |
 * |         |                  |              | reason='record_running_with_fresh_draft'                |
 * | running | missing          | yes          | active source='record+draft' degraded=true              |
 * | running | —                | no, age<=th  | active source='record-only' degraded=true               |
 * |         |                  |              | reason='liveness_pending' (grace window)                |
 * | running | —                | no, age>th   | zombie (not exposed in active[])                        |
 * | absent  | active+draft-assoc | yes        | active source='tracker+draft' degraded=true             |
 * |         |                  |              | reason='tracker_active_missing_record' (recovery path)  |
 * | absent  | other            | —            | drop (orphan filter)                                    |
 * | other   | —                | —            | drop                                                    |
 *
 * **Tracker association rules** (R1 P1-2 + R2 P1 + R3 P1 fix): a tracker slot is single-injectively
 * mapped to at most one invocation per agent — the slot's owner. Strong & weak paths are bound by
 * ownership, not just timing:
 *  - **slot owner** = the agent's earliest-anchored draft (slot was running before/when that draft
 *    was first created → it's the slot that produced this draft). Pre-computed in
 *    `slotClaimedByDraft` (Map<agentId, draft>).
 *  - **STRONG (R3 P1)**: only the slot's owner candidate (record+own-draft OR draft-only owner)
 *    may use record+tracker / tracker+draft. Other candidates whose drafts merely overlap the
 *    slot in time get rejected from these tracker-backed sources.
 *  - **WEAK**: same-agent has exactly one running record AND record.createdAt <= slot.startedAt
 *           AND no other draft strongly claims this slot — fallback for records without their own
 *           draft (single-record-per-agent is unambiguous).
 *  R3 P1 closes the loophole where two candidates' drafts both individually anchored the slot in
 *  time but only one was the true owner: timing-only `slotAssocWithDraft` was reverse-claiming.
 *
 * **Enumeration** (R1 P1-1 fix): candidate set = running records ∪ drafts (by invocationId).
 *  Drafts without a record can still surface as live via the 'tracker+draft' fall-back path,
 *  preserving messages.ts:1400-1406 hotfix3 behavior (AC-B5).
 *
 * `record.updatedAt` is NOT a heartbeat — it changes on status transitions only,
 * so we use `draft.updatedAt` as the freshness signal (DraftStore.touch() refreshes
 * on every stream chunk). Zombie threshold defaults to 2× DraftStore TTL = 600s
 * and ONLY applies when no fresh draft exists, so long-running streams are never
 * mistakenly killed.
 */

import type { AgentId } from '@agent-studio/shared';
import type { DraftRecord } from '../../stores/ports/DraftStore.js';
import type { InvocationRecord } from '../../stores/ports/InvocationRecordStore.js';
import type { ActiveSlotInfo } from './InvocationTracker.js';

export const DEFAULT_FRESH_DRAFT_WINDOW_MS = 300_000;
export const DEFAULT_ZOMBIE_GRACE_MS = 600_000;

export type LivenessSource =
  | 'record+tracker'
  | 'record+draft'
  | 'record-only'
  | 'tracker+draft'
  // F194 Phase Z (KD-21): namespace-aware sources — parent recordStore invocation + child registry turn
  | 'parent+child+tracker'
  | 'parent+child-draft';

export type LivenessReason =
  | 'tracker_present'
  | 'record_running_with_fresh_draft'
  | 'liveness_pending'
  | 'tracker_active_missing_record'
  // F194 Phase Z (KD-21/KD-22): parent record + linked child fresh draft = same execution chain
  | 'namespace_chain_active'
  | 'namespace_chain_degraded';

export interface LiveInvocation {
  /** First targetAgent or draft agentId; null only when record has no targetAgents and no draft */
  agentId: AgentId | null;
  invocationId: string;
  /** Best-effort start time: tracker slot startedAt > draft.createdAt > record.updatedAt */
  startedAt: number;
  source: LivenessSource;
  degraded: boolean;
  reason: LivenessReason;
}

export type ZombieReason =
  | 'no_tracker_no_fresh_draft_age_exceeded'
  // F194 Phase Z (KD-22): agent slot reused by another parent invocation, this parent has no own child draft
  | 'agent_slot_reused_no_self_draft';

export interface ZombieRecord {
  invocationId: string;
  agentId: AgentId | null;
  recordStatus: 'running';
  recordUpdatedAt: number;
  reason: ZombieReason;
}

export interface LivenessReadResult {
  active: LiveInvocation[];
  /** Detected zombie records — NOT exposed via read endpoints; consumed by cleanup pathway (Phase C) */
  zombies: ZombieRecord[];
}

/** F194 Phase B (Bundle) AC-B11: structured diagnostic events emitted by the helper. */
export type LivenessEventKind = 'liveness_degraded' | 'liveness_pending' | 'record_zombie_detected';

export interface LivenessEvent {
  kind: LivenessEventKind;
  threadId: string;
  userId: string;
  invocationId: string;
  agentId: string | null;
  /** Source classification (live entries) or null for zombies. */
  source: LivenessSource | null;
  reason: LivenessReason | ZombieReason;
  /** Diagnostic context (record/draft/tracker state at decision time). */
  recordStatus: 'running' | 'absent';
  recordUpdatedAt: number | null;
  trackerSlotPresent: boolean;
  draftFresh: boolean | null;
  draftAge: number | null;
}

export interface LivenessReadDeps {
  /** Enumerate running InvocationRecords for (threadId, userId). Required so zombies are visible
   *  even when their drafts have already been TTL-reaped (DraftStore TTL < zombie threshold). */
  listRunningRecords: (threadId: string, userId: string) => Promise<InvocationRecord[]> | InvocationRecord[];
  /** InvocationTracker.getActiveSlots(threadId) */
  getActiveSlots: (threadId: string) => ActiveSlotInfo[];
  /** InvocationTracker.getUserId(threadId, agentId) — guards against cross-user tracker collisions */
  getTrackerUserId: (threadId: string, agentId: string) => string | null;
  /** DraftStore.getByThread(userId, threadId) */
  getDrafts: (userId: string, threadId: string) => Promise<DraftRecord[]> | DraftRecord[];
  /** F194 AC-B12: optional structured event sink. Helper emits liveness_degraded /
   *  liveness_pending / record_zombie_detected at the matching decision points so the
   *  callsite (messages.ts/queue.ts) can route them into a logger. Sink failure must NOT
   *  interrupt the read — exceptions are swallowed. */
  onLog?: (event: LivenessEvent) => void;
  /** F194 Phase Z (KD-21/KD-22, 砚砚 R1 P1-1): namespace bridge — given a child registry
   *  invocationId (used by drafts / per-agent-turn), return its parent recordStore invocationId
   *  + child agentId/createdAt. Wraps `InvocationRegistry.getRecord(invocationId)` (which already
   *  has `parentInvocationId` field). When undefined → helper falls back to legacy single-namespace
   *  classification (Phase A/B behavior preserved for callers that haven't wired registry). */
  getTurnInvocation?: (
    invocationId: string,
  ) => Promise<TurnInvocationInfo | null> | TurnInvocationInfo | null | undefined;
  /** F194 Phase Z (KD-22): wraps `InvocationRegistry.getLatestId(threadId, agentId)`. Used to
   *  detect agent-slot reuse — when the latest turn for (thread, agent) belongs to a parent OTHER
   *  than this candidate's record, this candidate's chain is dead → instant zombie candidate
   *  (AC-Z2 case γ). When undefined → agent-slot-reuse detection skipped (degrade gracefully). */
  getLatestTurnInvocationId?: (
    threadId: string,
    agentId: string,
  ) => Promise<string | null | undefined> | string | null | undefined;
}

/** F194 Phase Z (KD-22): structured turn invocation info returned by getTurnInvocation dep.
 *  parentInvocationId may be absent when invocation is top-level (e.g., scheduled job, no parent chain).
 *  R2 P1-B: userId required so namespace bridge can guard against cross-user agent-slot collisions
 *  (default/system thread is public; getLatestId(threadId, agentId) has no user dimension). */
export interface TurnInvocationInfo {
  parentInvocationId: string | undefined;
  threadId: string;
  userId: string;
  agentId: string;
  createdAt: number;
}

export interface LivenessReadOptions {
  /** Override Date.now() (tests / deterministic replay) */
  now?: number;
  /** Window where a draft.updatedAt counts as fresh proof of life (default 300_000 ms = DraftStore TTL) */
  freshDraftWindowMs?: number;
  /** Grace window past which a record-only running record (no tracker, no fresh draft) is judged zombie
   *  (default 600_000 ms = 2× DraftStore TTL). Applies ONLY to no-fresh-draft case. */
  zombieGraceMs?: number;
}

type Classification =
  | { kind: 'live'; live: LiveInvocation }
  | { kind: 'zombie'; zombie: ZombieRecord }
  | { kind: 'drop' };

interface ClassifyContext {
  invocationId: string;
  record: InvocationRecord | undefined;
  draft: DraftRecord | undefined;
  slot: ActiveSlotInfo | undefined;
  trackerOwnerMatches: boolean;
  /** R3 P1: agent slot's earliest-anchored draft is THIS candidate's draft (it is the slot's owner).
   *  Required for both strong record+tracker AND tracker+draft fall-back. Implies slot exists,
   *  draft exists, and timing anchored. */
  slotClaimedByThisDraft: boolean;
  /** R2 P1: agent slot is strongly claimed by a draft *other than* this candidate's draft.
   *  Disables weak record-tracker (single-record-per-agent fallback). */
  slotClaimedByOtherDraft: boolean;
  /** Weak record-tracker eligibility: single running record per agent, no draft contention. */
  slotAssocWithRecordSingle: boolean;
  agentId: AgentId | null;
  now: number;
  freshDraftWindowMs: number;
  zombieGraceMs: number;
}

function tryRecordTracker(ctx: ClassifyContext): LiveInvocation | null {
  // R3 P1: strong path requires THIS candidate to own the slot (earliest-anchored draft).
  // Weak path allows single-record-per-agent fallback when no draft contests the slot.
  const trackerAssoc = ctx.slotClaimedByThisDraft || ctx.slotAssocWithRecordSingle;
  if (!ctx.record || !ctx.slot || !ctx.trackerOwnerMatches || !ctx.agentId || !trackerAssoc) return null;
  return {
    agentId: ctx.agentId,
    invocationId: ctx.invocationId,
    startedAt: ctx.slot.startedAt,
    source: 'record+tracker',
    degraded: false,
    reason: 'tracker_present',
  };
}

function tryTrackerDraft(ctx: ClassifyContext): LiveInvocation | null {
  // R3 P1: only the slot's owner draft (earliest-anchored) may surface as tracker+draft.
  if (ctx.record || !ctx.draft || !ctx.slot || !ctx.trackerOwnerMatches || !ctx.agentId) return null;
  if (!ctx.slotClaimedByThisDraft) return null;
  return {
    agentId: ctx.agentId,
    invocationId: ctx.invocationId,
    startedAt: ctx.slot.startedAt,
    source: 'tracker+draft',
    degraded: true,
    reason: 'tracker_active_missing_record',
  };
}

function tryRecordFreshDraft(ctx: ClassifyContext): LiveInvocation | null {
  if (!ctx.record || !ctx.draft) return null;
  if (ctx.now - ctx.draft.updatedAt > ctx.freshDraftWindowMs) return null;
  return {
    agentId: ctx.agentId,
    invocationId: ctx.invocationId,
    startedAt: ctx.draft.createdAt ?? ctx.draft.updatedAt,
    source: 'record+draft',
    degraded: true,
    reason: 'record_running_with_fresh_draft',
  };
}

function tryRecordGraceOrZombie(ctx: ClassifyContext): Classification | null {
  if (!ctx.record) return null;
  const recordAge = ctx.now - ctx.record.updatedAt;
  if (recordAge <= ctx.zombieGraceMs) {
    return {
      kind: 'live',
      live: {
        agentId: ctx.agentId,
        invocationId: ctx.invocationId,
        startedAt: ctx.record.updatedAt,
        source: 'record-only',
        degraded: true,
        reason: 'liveness_pending',
      },
    };
  }
  return {
    kind: 'zombie',
    zombie: {
      invocationId: ctx.invocationId,
      agentId: ctx.agentId,
      recordStatus: 'running',
      recordUpdatedAt: ctx.record.updatedAt,
      reason: 'no_tracker_no_fresh_draft_age_exceeded',
    },
  };
}

function classifyCandidate(ctx: ClassifyContext): Classification {
  const recordTracker = tryRecordTracker(ctx);
  if (recordTracker) return { kind: 'live', live: recordTracker };

  const trackerDraft = tryTrackerDraft(ctx);
  if (trackerDraft) return { kind: 'live', live: trackerDraft };

  const recordDraft = tryRecordFreshDraft(ctx);
  if (recordDraft) return { kind: 'live', live: recordDraft };

  const recordGrace = tryRecordGraceOrZombie(ctx);
  if (recordGrace) return recordGrace;

  return { kind: 'drop' };
}

function buildDegradedEvent(
  threadId: string,
  userId: string,
  ctx: ClassifyContext,
  live: LiveInvocation,
): LivenessEvent {
  const isPending = live.reason === 'liveness_pending';
  return {
    kind: isPending ? 'liveness_pending' : 'liveness_degraded',
    threadId,
    userId,
    invocationId: ctx.invocationId,
    agentId: live.agentId,
    source: live.source,
    reason: live.reason,
    recordStatus: ctx.record ? 'running' : 'absent',
    recordUpdatedAt: ctx.record?.updatedAt ?? null,
    trackerSlotPresent: !!ctx.slot,
    draftFresh: ctx.draft ? ctx.now - ctx.draft.updatedAt <= ctx.freshDraftWindowMs : null,
    draftAge: ctx.draft ? ctx.now - ctx.draft.updatedAt : null,
  };
}

function buildZombieEvent(threadId: string, userId: string, ctx: ClassifyContext, zombie: ZombieRecord): LivenessEvent {
  return {
    kind: 'record_zombie_detected',
    threadId,
    userId,
    invocationId: ctx.invocationId,
    agentId: zombie.agentId,
    source: null,
    reason: zombie.reason,
    recordStatus: 'running',
    recordUpdatedAt: zombie.recordUpdatedAt,
    trackerSlotPresent: !!ctx.slot,
    draftFresh: false,
    draftAge: ctx.draft ? ctx.now - ctx.draft.updatedAt : null,
  };
}

/** AC-B11/B12: emit a structured event for `degraded` live + zombie outcomes.
 *  Sink failure is swallowed — diagnostic should never break the read path. */
function emitLivenessEvent(
  onLog: ((event: LivenessEvent) => void) | undefined,
  threadId: string,
  userId: string,
  ctx: ClassifyContext,
  result: Classification,
): void {
  if (!onLog) return;
  let event: LivenessEvent | null = null;
  if (result.kind === 'live' && result.live.degraded) {
    event = buildDegradedEvent(threadId, userId, ctx, result.live);
  } else if (result.kind === 'zombie') {
    event = buildZombieEvent(threadId, userId, ctx, result.zombie);
  }
  if (!event) return;
  try {
    onLog(event);
  } catch {
    // swallow — sink errors must not interrupt read path
  }
}

interface IndexBundle {
  recordById: Map<string, InvocationRecord>;
  draftById: Map<string, DraftRecord>;
  slotByAgentId: Map<string, ActiveSlotInfo>;
  runningRecordsByAgent: Map<string, InvocationRecord[]>;
  /** R2 P1 fix: per-agent, the earliest-anchored draft that strongly claims that agent's tracker slot.
   *  A weak record-tracker association must NOT fire if the slot is already claimed by another
   *  invocation's draft (agent slot reuse / coexistence with record-missing recovery). */
  slotClaimedByDraft: Map<string, DraftRecord>;
}

function buildRunningRecordsByAgent(
  records: InvocationRecord[],
  threadId: string,
  userId: string,
): Map<string, InvocationRecord[]> {
  const out = new Map<string, InvocationRecord[]>();
  for (const r of records) {
    if (r.status !== 'running' || r.threadId !== threadId || r.userId !== userId) continue;
    const agent = r.targetAgents[0] as string | undefined;
    if (!agent) continue;
    let bucket = out.get(agent);
    if (!bucket) {
      bucket = [];
      out.set(agent, bucket);
    }
    bucket.push(r);
  }
  return out;
}

/** R2 P1 + cloud R5 P1: per-agent earliest-anchored draft that strongly claims that agent's tracker slot.
 *  Stale drafts (updatedAt past freshDraftWindowMs) are excluded — they shouldn't grant ownership
 *  that disables a still-live record's weak path. */
function buildSlotClaimedByDraft(
  drafts: DraftRecord[],
  slotByAgentId: Map<string, ActiveSlotInfo>,
  threadId: string,
  userId: string,
  now: number,
  freshDraftWindowMs: number,
): Map<string, DraftRecord> {
  // Pre-filter: only fresh in-scope drafts can claim slot ownership (cloud R5 P1).
  const eligible = drafts.filter(
    (d) => d.threadId === threadId && d.userId === userId && now - d.updatedAt <= freshDraftWindowMs,
  );
  const out = new Map<string, DraftRecord>();
  for (const draft of eligible) {
    const slot = slotByAgentId.get(draft.agentId);
    if (!slot) continue;
    const anchorTs = draft.createdAt ?? draft.updatedAt;
    if (slot.startedAt > anchorTs) continue;
    const incumbent = out.get(draft.agentId);
    const incumbentAnchor = incumbent ? (incumbent.createdAt ?? incumbent.updatedAt) : Number.POSITIVE_INFINITY;
    if (anchorTs < incumbentAnchor) out.set(draft.agentId, draft);
  }
  return out;
}

function buildIndexes(
  records: InvocationRecord[],
  drafts: DraftRecord[],
  slots: ActiveSlotInfo[],
  threadId: string,
  userId: string,
  now: number,
  freshDraftWindowMs: number,
): IndexBundle {
  const recordById = new Map<string, InvocationRecord>();
  for (const r of records) recordById.set(r.id, r);
  const draftById = new Map<string, DraftRecord>();
  for (const d of drafts) draftById.set(d.invocationId, d);
  const slotByAgentId = new Map<string, ActiveSlotInfo>();
  for (const s of slots) slotByAgentId.set(s.agentId, s);
  const runningRecordsByAgent = buildRunningRecordsByAgent(records, threadId, userId);
  const slotClaimedByDraft = buildSlotClaimedByDraft(drafts, slotByAgentId, threadId, userId, now, freshDraftWindowMs);
  return { recordById, draftById, slotByAgentId, runningRecordsByAgent, slotClaimedByDraft };
}

interface BuildContextDeps {
  threadId: string;
  userId: string;
  invocationId: string;
  index: IndexBundle;
  getTrackerUserId: (threadId: string, agentId: string) => string | null;
  now: number;
  freshDraftWindowMs: number;
  zombieGraceMs: number;
}

function lookupCandidate(
  deps: BuildContextDeps,
): { record: InvocationRecord | undefined; draft: DraftRecord | undefined } | null {
  const record = deps.index.recordById.get(deps.invocationId);
  // In-scope but not running → drop (treated as not live)
  if (record && (record.status !== 'running' || record.threadId !== deps.threadId || record.userId !== deps.userId)) {
    return null;
  }
  const draft = deps.index.draftById.get(deps.invocationId);
  // Defensive: drafts come scoped from getDrafts(userId, threadId), but guard against caller misuse.
  if (draft && (draft.threadId !== deps.threadId || draft.userId !== deps.userId)) return null;
  return { record, draft };
}

function resolveAgentId(record: InvocationRecord | undefined, draft: DraftRecord | undefined): AgentId | null {
  const recordAgentId = (record?.targetAgents[0] as AgentId | undefined) ?? null;
  const draftAgentId = (draft?.agentId as AgentId | undefined) ?? null;
  return recordAgentId ?? draftAgentId;
}

function computeAssociations(args: {
  slot: ActiveSlotInfo | undefined;
  record: InvocationRecord | undefined;
  sameAgentRecordCount: number;
  /** R2 P1: true iff agent slot is strongly claimed by a draft other than this candidate's.
   *  Disables weak record association so a fresh slot can't reverse-prove an unrelated record. */
  slotClaimedByOtherDraft: boolean;
}): { slotAssocWithRecordSingle: boolean } {
  const { slot, record, sameAgentRecordCount, slotClaimedByOtherDraft } = args;
  const slotAssocWithRecordSingle = !!(
    slot &&
    record &&
    sameAgentRecordCount === 1 &&
    record.createdAt <= slot.startedAt &&
    !slotClaimedByOtherDraft
  );
  return { slotAssocWithRecordSingle };
}

function buildClassifyContext(deps: BuildContextDeps): ClassifyContext | null {
  const lookup = lookupCandidate(deps);
  if (!lookup) return null;
  const { record, draft } = lookup;
  const agentId = resolveAgentId(record, draft);
  const slot = agentId ? deps.index.slotByAgentId.get(agentId) : undefined;
  const trackerOwnerMatches = !!(slot && agentId && deps.getTrackerUserId(deps.threadId, agentId) === deps.userId);
  const sameAgentRecordCount = agentId ? (deps.index.runningRecordsByAgent.get(agentId)?.length ?? 0) : 0;
  const slotClaimingDraft = agentId ? deps.index.slotClaimedByDraft.get(agentId) : undefined;
  const slotClaimedByThisDraft = !!(slotClaimingDraft && slotClaimingDraft.invocationId === deps.invocationId);
  const slotClaimedByOtherDraft = !!(slotClaimingDraft && slotClaimingDraft.invocationId !== deps.invocationId);
  const { slotAssocWithRecordSingle } = computeAssociations({
    slot,
    record,
    sameAgentRecordCount,
    slotClaimedByOtherDraft,
  });

  return {
    invocationId: deps.invocationId,
    record,
    draft,
    slot,
    trackerOwnerMatches,
    slotClaimedByThisDraft,
    slotClaimedByOtherDraft,
    slotAssocWithRecordSingle,
    agentId,
    now: deps.now,
    freshDraftWindowMs: deps.freshDraftWindowMs,
    zombieGraceMs: deps.zombieGraceMs,
  };
}

/**
 * F194 Phase Z (KD-22): namespace bridge — for each fresh draft, ask getTurnInvocation what
 * its parent record id is. Returns:
 *   parentToFreshChildren: parent recordStore invocationId → list of fresh-child entries
 *   childIdToParentId: child registry invocationId → parent record id (for skip in legacy loop)
 * When getTurnInvocation dep is absent, returns empty maps → legacy classification path runs as before.
 */
interface NamespaceLinkContext {
  threadId: string;
  userId: string;
  now: number;
  freshDraftWindowMs: number;
  getTurnInvocation: NonNullable<LivenessReadDeps['getTurnInvocation']>;
}

/** Returns null when draft should be skipped (out-of-scope, stale, missing turn info, or cross-user/thread/agent). */
async function resolveDraftToTurn(
  draft: DraftRecord,
  ctx: NamespaceLinkContext,
): Promise<{ parentInvocationId: string; turnCreatedAt: number } | null> {
  if (draft.threadId !== ctx.threadId || draft.userId !== ctx.userId) return null;
  if (ctx.now - draft.updatedAt > ctx.freshDraftWindowMs) return null;
  let info: TurnInvocationInfo | null | undefined;
  try {
    info = await Promise.resolve(ctx.getTurnInvocation(draft.invocationId));
  } catch {
    return null;
  }
  if (!info || !info.parentInvocationId) return null;
  // R2 P1-B: cross-user/thread/agent isolation guard — prevent default/system thread spillover
  if (info.threadId !== ctx.threadId || info.userId !== ctx.userId || info.agentId !== draft.agentId) return null;
  return { parentInvocationId: info.parentInvocationId, turnCreatedAt: info.createdAt };
}

async function buildNamespaceLink(
  drafts: DraftRecord[],
  threadId: string,
  userId: string,
  now: number,
  freshDraftWindowMs: number,
  getTurnInvocation: LivenessReadDeps['getTurnInvocation'],
): Promise<{
  parentToFreshChildren: Map<string, Array<{ childTurnId: string; draft: DraftRecord; turnCreatedAt: number }>>;
  childIdToParentId: Map<string, string>;
}> {
  const parentToFreshChildren = new Map<
    string,
    Array<{ childTurnId: string; draft: DraftRecord; turnCreatedAt: number }>
  >();
  const childIdToParentId = new Map<string, string>();
  if (!getTurnInvocation) return { parentToFreshChildren, childIdToParentId };

  const ctx: NamespaceLinkContext = { threadId, userId, now, freshDraftWindowMs, getTurnInvocation };
  for (const draft of drafts) {
    const link = await resolveDraftToTurn(draft, ctx);
    if (!link) continue;
    childIdToParentId.set(draft.invocationId, link.parentInvocationId);
    let bucket = parentToFreshChildren.get(link.parentInvocationId);
    if (!bucket) {
      bucket = [];
      parentToFreshChildren.set(link.parentInvocationId, bucket);
    }
    bucket.push({ childTurnId: draft.invocationId, draft, turnCreatedAt: link.turnCreatedAt });
  }
  return { parentToFreshChildren, childIdToParentId };
}

type NamespaceAgentChild = { agentId: string; childTurnId: string; turnCreatedAt: number };

/** Pick the canonical child per agent: registry latest pointer wins; tiebreak fallback = newest createdAt
 *  (NOT earliest — would re-surface stale child after cleanup edge cases — 砚砚 R2 P1-C). */
function selectChildPerAgent(
  children: Array<{ childTurnId: string; draft: DraftRecord; turnCreatedAt: number }>,
  latestTurnByAgent: Map<string, string>,
): Map<string, NamespaceAgentChild> {
  const byAgentId = new Map<string, NamespaceAgentChild>();
  for (const child of children) {
    const agent = child.draft.agentId;
    if (!agent) continue;
    const candidate: NamespaceAgentChild = {
      agentId: agent,
      childTurnId: child.childTurnId,
      turnCreatedAt: child.turnCreatedAt,
    };
    const existing = byAgentId.get(agent);
    if (!existing) {
      byAgentId.set(agent, candidate);
      continue;
    }
    const latestId = latestTurnByAgent.get(agent);
    const candidateIsLatest = latestId === child.childTurnId;
    const existingIsLatest = latestId === existing.childTurnId;
    if (candidateIsLatest && !existingIsLatest) byAgentId.set(agent, candidate);
    else if (!candidateIsLatest && !existingIsLatest && child.turnCreatedAt > existing.turnCreatedAt)
      byAgentId.set(agent, candidate);
  }
  return byAgentId;
}

interface NamespaceLiveContext {
  threadId: string;
  userId: string;
  slotByAgentId: Map<string, ActiveSlotInfo>;
  getTrackerUserId: LivenessReadDeps['getTrackerUserId'];
}

/** R3 P2-1: tracker presence must be user-scoped. Mirror legacy classifier guard so cross-user slot
 *  on default/system thread doesn't get classified as healthy `parent+child+tracker` for our user. */
function isTrackerSlotOwnedByUser(agentId: string, ctx: NamespaceLiveContext): boolean {
  const slot = ctx.slotByAgentId.get(agentId);
  if (!slot) return false;
  return ctx.getTrackerUserId(ctx.threadId, agentId) === ctx.userId;
}

function materializeNamespaceLive(
  byAgentId: Map<string, NamespaceAgentChild>,
  ctx: NamespaceLiveContext,
): LiveInvocation[] {
  const result: LiveInvocation[] = [];
  for (const [agentId, entry] of byAgentId) {
    const trackerOwned = isTrackerSlotOwnedByUser(agentId, ctx);
    result.push({
      agentId: agentId as AgentId,
      // KD-22: invocationId = child registry id (matches DraftStore key + formal-message stamping
      // for current agent turn). Parent record id is the liveness anchor for cleanup, but the
      // identity surfaced to consumers (orphan-draft filter / queue activeInvocations dedup) is
      // the child turn — that's what drafts and downstream consumers actually reference.
      invocationId: entry.childTurnId,
      startedAt: entry.turnCreatedAt,
      source: trackerOwned ? 'parent+child+tracker' : 'parent+child-draft',
      degraded: !trackerOwned,
      reason: trackerOwned ? 'namespace_chain_active' : 'namespace_chain_degraded',
    });
  }
  return result;
}

function buildNamespaceLive(
  _parent: InvocationRecord,
  children: Array<{ childTurnId: string; draft: DraftRecord; turnCreatedAt: number }>,
  ctx: NamespaceLiveContext,
  latestTurnByAgent: Map<string, string>,
): LiveInvocation[] {
  // One active per agent (parallel chain may have multiple agents under same parent).
  // R2 P1-C dedup → R3 P2-1 user-scoped tracker check.
  const byAgentId = selectChildPerAgent(children, latestTurnByAgent);
  return materializeNamespaceLive(byAgentId, ctx);
}

/** Cloud R2 P1: agent slot is "actively reused" iff some OTHER parent currently has a fresh draft for
 *  this agent. Historical latest pointer alone is unreliable — it can persist across legitimate gaps
 *  (between serial multi-agent turns, before current chain produces first draft). Requiring a current
 *  fresh-draft signal from another parent eliminates the false-positive that prematurely flips
 *  in-flight invocations to failed. */
function isAgentActivelyClaimedByOtherParent(
  parent: InvocationRecord,
  agent: string,
  parentToFreshChildren: Map<string, Array<{ childTurnId: string; draft: DraftRecord; turnCreatedAt: number }>>,
): boolean {
  for (const [otherParentId, children] of parentToFreshChildren) {
    if (otherParentId === parent.id) continue;
    for (const c of children) {
      if (c.draft.agentId === agent) return true;
    }
  }
  return false;
}

/**
 * F194 Phase Z (KD-22): agent-slot-reuse detection.
 * For a parent record with NO own fresh children, iterate ALL parent.targetAgents — if any agent slot
 * is actively claimed by another parent (via fresh draft), this parent's chain is dead → zombie
 * candidate with reason 'agent_slot_reused_no_self_draft'.
 *
 * Cloud R1 P1 (PR #1614): probe ALL targetAgents, not just [0] — multi-agent parents whose non-first
 * agent slot was reused were missed.
 *
 * Cloud R2 P1 (PR #1614 commit 02c25a177): require fresh-draft proof, not historical latest pointer.
 * latest pointer persists across legitimate gaps and would prematurely flip in-flight invocations.
 *
 * Read-side does NOT terminalize (砚砚 R1 P1-3); reconcile pathway decides failed vs succeeded.
 * If no current reuse detected here, parent falls through to legacy pass which has age-based grace.
 */
function detectAgentSlotReuseZombie(
  parent: InvocationRecord,
  parentToFreshChildren: Map<string, Array<{ childTurnId: string; draft: DraftRecord; turnCreatedAt: number }>>,
): ZombieRecord | null {
  for (const targetAgent of parent.targetAgents as readonly string[]) {
    if (!targetAgent) continue;
    if (isAgentActivelyClaimedByOtherParent(parent, targetAgent, parentToFreshChildren)) {
      return {
        invocationId: parent.id,
        agentId: targetAgent as AgentId,
        recordStatus: 'running',
        recordUpdatedAt: parent.updatedAt,
        reason: 'agent_slot_reused_no_self_draft',
      };
    }
  }
  return null;
}

/** F194 Phase Z (KD-22, 砚砚 R2 P2): emit diagnostic event for namespace-classified live entries.
 *  parent+child-draft (degraded) and parent+child+tracker (info-level) both useful for runtime
 *  monitoring. Sink throws are swallowed (mirrors emitLivenessEvent semantics).
 *
 *  Cloud R5 P2 (PR #1614 commit e2b967d2a): trackerSlotPresent must reflect actual physical
 *  presence, not the trackerOwned classification. degraded path also fires when tracker slot
 *  exists but is owned by another user (R3 P2-1 cross-user guard) — emitting `false` would let
 *  monitoring/alerting misclassify ownership-collision as tracker-loss. */
function emitNamespaceLiveEvent(
  onLog: ((event: LivenessEvent) => void) | undefined,
  threadId: string,
  userId: string,
  parentRecord: InvocationRecord,
  live: LiveInvocation,
  draft: DraftRecord | undefined,
  now: number,
  freshDraftWindowMs: number,
  trackerSlotPresent: boolean,
): void {
  if (!onLog) return;
  // Only emit for degraded entries (parent+child-draft) — parent+child+tracker is healthy + noisy
  if (!live.degraded) return;
  try {
    onLog({
      kind: 'liveness_degraded',
      threadId,
      userId,
      invocationId: live.invocationId,
      agentId: live.agentId,
      source: live.source,
      reason: live.reason,
      recordStatus: 'running',
      recordUpdatedAt: parentRecord.updatedAt,
      trackerSlotPresent,
      draftFresh: draft ? now - draft.updatedAt <= freshDraftWindowMs : null,
      draftAge: draft ? now - draft.updatedAt : null,
    });
  } catch {
    // swallow sink errors
  }
}

/** Cloud R4 P2 (PR #1614 commit 747e6c770): trackerSlotPresent must reflect actual tracker state.
 *  detectAgentSlotReuseZombie used to rely on tracker, but now classifies via fresh drafts only —
 *  hardcoded `true` would skew F194 monitoring/alerting that uses this field to distinguish tracker
 *  loss from real slot occupancy. Caller passes the actual presence from slotByAgentId.has(agentId). */
function emitNamespaceZombieEvent(
  onLog: ((event: LivenessEvent) => void) | undefined,
  threadId: string,
  userId: string,
  zombie: ZombieRecord,
  trackerSlotPresent: boolean,
): void {
  if (!onLog) return;
  try {
    onLog({
      kind: 'record_zombie_detected',
      threadId,
      userId,
      invocationId: zombie.invocationId,
      agentId: zombie.agentId,
      source: null,
      reason: zombie.reason,
      recordStatus: 'running',
      recordUpdatedAt: zombie.recordUpdatedAt,
      trackerSlotPresent,
      draftFresh: false,
      draftAge: null,
    });
  } catch {
    // swallow sink errors
  }
}

async function resolveLatestTurnByAgent(
  parentToFreshChildren: Map<string, Array<{ childTurnId: string; draft: DraftRecord; turnCreatedAt: number }>>,
  threadId: string,
  getLatestTurnInvocationId: LivenessReadDeps['getLatestTurnInvocationId'],
): Promise<Map<string, string>> {
  const latestTurnByAgent = new Map<string, string>();
  if (!getLatestTurnInvocationId) return latestTurnByAgent;
  const agentsToResolve = new Set<string>();
  for (const children of parentToFreshChildren.values()) {
    for (const child of children) {
      const agent = child.draft.agentId;
      if (agent) agentsToResolve.add(agent);
    }
  }
  for (const agent of agentsToResolve) {
    try {
      const latestId = await Promise.resolve(getLatestTurnInvocationId(threadId, agent));
      if (latestId) latestTurnByAgent.set(agent, latestId);
    } catch {
      // dep failure must not break read; leave map entry absent → falls back to newest createdAt
    }
  }
  return latestTurnByAgent;
}

interface NamespacePassDeps {
  threadId: string;
  userId: string;
  now: number;
  freshDraftWindowMs: number;
  getLatestTurnInvocationId: LivenessReadDeps['getLatestTurnInvocationId'];
  getTurnInvocation: LivenessReadDeps['getTurnInvocation'];
  onLog?: LivenessReadDeps['onLog'];
  parentToFreshChildren: Map<string, Array<{ childTurnId: string; draft: DraftRecord; turnCreatedAt: number }>>;
  latestTurnByAgent: Map<string, string>;
  namespaceLiveCtx: NamespaceLiveContext;
}

async function processRecordInNamespacePass(
  record: InvocationRecord,
  passDeps: NamespacePassDeps,
): Promise<{
  candidates: Array<{ live: LiveInvocation; draft: DraftRecord | undefined; parent: InvocationRecord }>;
  zombie: ZombieRecord | null;
  handled: boolean;
}> {
  const children = passDeps.parentToFreshChildren.get(record.id);
  if (children && children.length > 0) {
    const liveEntries = buildNamespaceLive(record, children, passDeps.namespaceLiveCtx, passDeps.latestTurnByAgent);
    if (liveEntries.length > 0) {
      const candidates = liveEntries.map((live) => ({
        live,
        draft: children.find((c) => c.childTurnId === live.invocationId)?.draft,
        parent: record,
      }));
      // Diagnostic emit happens AFTER cross-parent dedup so we don't log losers as live.
      return { candidates, zombie: null, handled: true };
    }
    // children exist but selectChildPerAgent suppressed all (within-parent edge case) — fall through to
    // zombie detection so we don't leave the parent dangling.
  }
  const zombie = detectAgentSlotReuseZombie(record, passDeps.parentToFreshChildren);
  if (zombie) {
    const trackerSlotPresent = passDeps.namespaceLiveCtx.slotByAgentId.has(zombie.agentId as string);
    emitNamespaceZombieEvent(passDeps.onLog, passDeps.threadId, passDeps.userId, zombie, trackerSlotPresent);
    return { candidates: [], zombie, handled: true };
  }
  return { candidates: [], zombie: null, handled: false };
}

type NamespaceCandidate = { live: LiveInvocation; draft: DraftRecord | undefined; parent: InvocationRecord };

function groupCandidatesByAgent(candidates: NamespaceCandidate[]): Map<string, NamespaceCandidate[]> {
  const byAgent = new Map<string, NamespaceCandidate[]>();
  for (const entry of candidates) {
    const agent = entry.live.agentId as string;
    let bucket = byAgent.get(agent);
    if (!bucket) {
      bucket = [];
      byAgent.set(agent, bucket);
    }
    bucket.push(entry);
  }
  return byAgent;
}

function pickWinnerIdx(list: NamespaceCandidate[], latestId: string | undefined): number {
  if (latestId) {
    const idx = list.findIndex((e) => e.live.invocationId === latestId);
    if (idx >= 0) return idx;
  }
  // Fallback: newest startedAt wins (mirrors selectChildPerAgent in-parent fallback).
  let best = 0;
  for (let i = 1; i < list.length; i++) {
    if (list[i].live.startedAt > list[best].live.startedAt) best = i;
  }
  return best;
}

function emitWinnerAsLive(winner: NamespaceCandidate, passDeps: NamespacePassDeps): void {
  // Cloud R5 P2: actual tracker physical presence (not the trackerOwned classification)
  const trackerSlotPresent = passDeps.namespaceLiveCtx.slotByAgentId.has(winner.live.agentId as string);
  emitNamespaceLiveEvent(
    passDeps.onLog,
    passDeps.threadId,
    passDeps.userId,
    winner.parent,
    winner.live,
    winner.draft,
    passDeps.now,
    passDeps.freshDraftWindowMs,
    trackerSlotPresent,
  );
}

function buildLoserZombie(loser: NamespaceCandidate, agent: string): ZombieRecord {
  return {
    invocationId: loser.parent.id,
    agentId: agent as AgentId,
    recordStatus: 'running',
    recordUpdatedAt: loser.parent.updatedAt,
    reason: 'agent_slot_reused_no_self_draft',
  };
}

function selectWinnersAndLosers(
  byAgent: Map<string, NamespaceCandidate[]>,
  latestTurnByAgent: Map<string, string>,
): { winners: NamespaceCandidate[]; losers: NamespaceCandidate[] } {
  const winners: NamespaceCandidate[] = [];
  const losers: NamespaceCandidate[] = [];
  for (const [agent, list] of byAgent) {
    const winnerIdx = list.length === 1 ? 0 : pickWinnerIdx(list, latestTurnByAgent.get(agent));
    winners.push(list[winnerIdx]);
    for (let i = 0; i < list.length; i++) {
      if (i !== winnerIdx) losers.push(list[i]);
    }
  }
  return { winners, losers };
}

function aggregateParentZombies(
  losers: NamespaceCandidate[],
  winningParentIds: Set<string>,
  passDeps: NamespacePassDeps,
): ZombieRecord[] {
  const zombies: ZombieRecord[] = [];
  const seenParentIds = new Set<string>();
  for (const loser of losers) {
    // R5 P1: skip if parent still has another winning child agent — slot reuse is partial, parent still live.
    if (winningParentIds.has(loser.parent.id)) continue;
    // R5 P1: dedup zombie per-parent — multi-agent parent that loses all agents only emits 1 zombie.
    if (seenParentIds.has(loser.parent.id)) continue;
    seenParentIds.add(loser.parent.id);
    const zombie = buildLoserZombie(loser, loser.live.agentId as string);
    zombies.push(zombie);
    const trackerSlotPresent = passDeps.namespaceLiveCtx.slotByAgentId.has(zombie.agentId as string);
    emitNamespaceZombieEvent(passDeps.onLog, passDeps.threadId, passDeps.userId, zombie, trackerSlotPresent);
  }
  return zombies;
}

/** R4 P1 (砚砚 spec line 207): cross-parent same-agent dedup using registry latest pointer.
 *  Each parent's namespace pass produces independent live candidates per agent. When two parents
 *  both have a fresh child for the same agent, latest pointer (registry-authoritative) wins.
 *
 *  R5 P1 (砚砚): the loser is a agent slot suppression, not a parent death. Only when a parent has
 *  NO winning child across all its agents does it become a true agent_slot_reused_no_self_draft zombie.
 *  Multi-agent parent losing only one agent (other agents still winning) stays live; its losing agent slot
 *  silently moves to the new parent (the losing draft will TTL-expire). Parent zombie also
 *  deduplicates per-parent — losing N agents emits 1 zombie, not N. */
function dedupCrossParentByAgentLatest(
  candidates: NamespaceCandidate[],
  latestTurnByAgent: Map<string, string>,
  passDeps: NamespacePassDeps,
): { active: LiveInvocation[]; suppressedZombies: ZombieRecord[] } {
  const byAgent = groupCandidatesByAgent(candidates);
  const { winners, losers } = selectWinnersAndLosers(byAgent, latestTurnByAgent);
  const active: LiveInvocation[] = [];
  const winningParentIds = new Set<string>();
  for (const winner of winners) {
    active.push(winner.live);
    winningParentIds.add(winner.parent.id);
    emitWinnerAsLive(winner, passDeps);
  }
  const suppressedZombies = aggregateParentZombies(losers, winningParentIds, passDeps);
  return { active, suppressedZombies };
}

interface LegacyPassDeps {
  threadId: string;
  userId: string;
  now: number;
  freshDraftWindowMs: number;
  zombieGraceMs: number;
  index: IndexBundle;
  getTrackerUserId: LivenessReadDeps['getTrackerUserId'];
  onLog?: LivenessReadDeps['onLog'];
}

function runLegacyPass(
  candidateIds: Set<string>,
  deps: LegacyPassDeps,
): { active: LiveInvocation[]; zombies: ZombieRecord[] } {
  const active: LiveInvocation[] = [];
  const zombies: ZombieRecord[] = [];
  for (const invocationId of candidateIds) {
    const ctx = buildClassifyContext({
      threadId: deps.threadId,
      userId: deps.userId,
      invocationId,
      index: deps.index,
      getTrackerUserId: deps.getTrackerUserId,
      now: deps.now,
      freshDraftWindowMs: deps.freshDraftWindowMs,
      zombieGraceMs: deps.zombieGraceMs,
    });
    if (!ctx) continue;
    const result = classifyCandidate(ctx);
    emitLivenessEvent(deps.onLog, deps.threadId, deps.userId, ctx, result);
    if (result.kind === 'live') active.push(result.live);
    else if (result.kind === 'zombie') zombies.push(result.zombie);
  }
  return { active, zombies };
}

function collectLegacyCandidates(
  records: InvocationRecord[],
  drafts: DraftRecord[],
  handledRecordIds: Set<string>,
  childIdToParentId: Map<string, string>,
): Set<string> {
  const candidateIds = new Set<string>();
  for (const r of records) if (!handledRecordIds.has(r.id)) candidateIds.add(r.id);
  for (const d of drafts) {
    const parentId = childIdToParentId.get(d.invocationId);
    if (parentId && handledRecordIds.has(parentId)) continue;
    candidateIds.add(d.invocationId);
  }
  return candidateIds;
}

export async function getThreadLiveInvocations(
  threadId: string,
  userId: string,
  deps: LivenessReadDeps,
  opts: LivenessReadOptions = {},
): Promise<LivenessReadResult> {
  const now = opts.now ?? Date.now();
  const freshDraftWindowMs = opts.freshDraftWindowMs ?? DEFAULT_FRESH_DRAFT_WINDOW_MS;
  const zombieGraceMs = opts.zombieGraceMs ?? DEFAULT_ZOMBIE_GRACE_MS;

  const [records, drafts] = await Promise.all([
    Promise.resolve(deps.listRunningRecords(threadId, userId)),
    Promise.resolve(deps.getDrafts(userId, threadId)),
  ]);
  const slots = deps.getActiveSlots(threadId);
  const index = buildIndexes(records, drafts, slots, threadId, userId, now, freshDraftWindowMs);

  const { parentToFreshChildren, childIdToParentId } = await buildNamespaceLink(
    drafts,
    threadId,
    userId,
    now,
    freshDraftWindowMs,
    deps.getTurnInvocation,
  );
  const latestTurnByAgent = await resolveLatestTurnByAgent(
    parentToFreshChildren,
    threadId,
    deps.getLatestTurnInvocationId,
  );

  const passDeps: NamespacePassDeps = {
    threadId,
    userId,
    now,
    freshDraftWindowMs,
    getLatestTurnInvocationId: deps.getLatestTurnInvocationId,
    getTurnInvocation: deps.getTurnInvocation,
    onLog: deps.onLog,
    parentToFreshChildren,
    latestTurnByAgent,
    namespaceLiveCtx: {
      threadId,
      userId,
      slotByAgentId: index.slotByAgentId,
      getTrackerUserId: deps.getTrackerUserId,
    },
  };

  const active: LiveInvocation[] = [];
  const zombies: ZombieRecord[] = [];
  const handledRecordIds = new Set<string>();
  const namespaceCandidates: NamespaceCandidate[] = [];

  for (const record of records) {
    if (record.status !== 'running' || record.threadId !== threadId || record.userId !== userId) continue;
    const outcome = await processRecordInNamespacePass(record, passDeps);
    if (!outcome.handled) continue;
    namespaceCandidates.push(...outcome.candidates);
    if (outcome.zombie) zombies.push(outcome.zombie);
    handledRecordIds.add(record.id);
  }

  // R4 P1 (砚砚): cross-parent same-agent dedup. Until now each parent's namespace pass produced
  // candidates independently; here registry latest pointer wins across parents (loser → zombie).
  // Diagnostic emit happens here, not in processRecordInNamespacePass, so losers are never logged as live.
  const deduped = dedupCrossParentByAgentLatest(namespaceCandidates, latestTurnByAgent, passDeps);
  active.push(...deduped.active);
  zombies.push(...deduped.suppressedZombies);

  const legacyCandidates = collectLegacyCandidates(records, drafts, handledRecordIds, childIdToParentId);
  const legacyResult = runLegacyPass(legacyCandidates, {
    threadId,
    userId,
    now,
    freshDraftWindowMs,
    zombieGraceMs,
    index,
    getTrackerUserId: deps.getTrackerUserId,
    onLog: deps.onLog,
  });
  active.push(...legacyResult.active);
  zombies.push(...legacyResult.zombies);

  return { active, zombies };
}
