import type { RuntimeSessionMetadata } from '../../../domains/agents/services/runtime-session/RuntimeSessionMetadata.js';
import type { IRuntimeSessionStore } from '../../../domains/agents/services/runtime-session/RuntimeSessionStore.js';
import type { CapabilityWakeupSessionRef, SessionWindowEnumerator } from './capability-wakeup-trial-provider-impl.js';

const DEFAULT_PAGE_SIZE = 200;

export interface CapabilityWakeupRuntimeSessionEnumeratorDeps {
  runtimeSessionStore: Pick<IRuntimeSessionStore, 'listRecent'>;
  getFamilyForAgent?: (agentId: string) => string | undefined;
  pageSize?: number;
}

export function createCapabilityWakeupRuntimeSessionEnumerator(
  deps: CapabilityWakeupRuntimeSessionEnumeratorDeps,
): SessionWindowEnumerator {
  const pageSize = normalizePageSize(deps.pageSize);
  return {
    async listWindow({ windowStartMs, windowEndMs, ownerUserId }) {
      const refs: CapabilityWakeupSessionRef[] = [];
      let offset = 0;

      while (true) {
        const sessions = await deps.runtimeSessionStore.listRecent({ limit: pageSize, offset });
        if (sessions.length === 0) break;

        const page = collectWindowRefs(sessions, { windowStartMs, windowEndMs, ownerUserId }, deps.getFamilyForAgent);
        refs.push(...page.refs);

        if (page.reachedBeforeWindow || sessions.length < pageSize) break;
        offset += pageSize;
      }

      return refs;
    },
  };
}

function collectWindowRefs(
  sessions: RuntimeSessionMetadata[],
  window: { windowStartMs: number; windowEndMs: number; ownerUserId: string },
  getFamilyForAgent: ((agentId: string) => string | undefined) | undefined,
): { refs: CapabilityWakeupSessionRef[]; reachedBeforeWindow: boolean } {
  const refs: CapabilityWakeupSessionRef[] = [];
  for (const session of sessions) {
    if (session.lifecycle.lastObservedAt < window.windowStartMs) return { refs, reachedBeforeWindow: true };
    const ref = toWindowRef(session, window, getFamilyForAgent);
    if (ref) refs.push(ref);
  }
  return { refs, reachedBeforeWindow: false };
}

function toWindowRef(
  session: RuntimeSessionMetadata,
  window: { windowStartMs: number; windowEndMs: number; ownerUserId: string },
  getFamilyForAgent: ((agentId: string) => string | undefined) | undefined,
): CapabilityWakeupSessionRef | null {
  if (session.lifecycle.startedAt >= window.windowEndMs) return null;
  if (session.userId !== window.ownerUserId) return null;
  if (!session.threadId) return null;

  const family = getFamilyForAgent?.(session.agentId);
  return {
    sessionId: session.sessionId,
    threadId: session.threadId,
    agentId: session.agentId,
    userId: session.userId,
    ...(family ? { family } : {}),
  };
}

function normalizePageSize(pageSize: number | undefined): number {
  if (pageSize === undefined) return DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(pageSize) || pageSize < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(pageSize, DEFAULT_PAGE_SIZE);
}
