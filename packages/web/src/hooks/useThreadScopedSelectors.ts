/**
 * F173 Phase C — Thread-scoped selectors.
 *
 * Read-side components migrate from direct flat-state reads
 * (`useChatStore((s) => s.messages)` / `s.hasActiveInvocation`) to these
 * selectors so that:
 *
 *   1. Flat-vs-thread-scoped becomes a writer/mirror concern, not a reader
 *      concern. Phase A's mirror invariant guarantees consistency at write
 *      time; consumers never need to know whether they're reading flat or
 *      threadStates[tid].
 *   2. Phase C's hydration rewrite can swap the source (e.g. unify on
 *      `threadStates` and demote flat to a derived signal) without touching
 *      every consumer.
 *
 * Pure selector functions are exported for unit testing; React hooks wrap
 * them with `useChatStore` + `useShallow` to control re-renders.
 */
import { useShallow } from 'zustand/react/shallow';
import type { AgentInvocationInfo, AgentStatusType, ChatMessage } from '@/stores/chat-types';
import { type ChatState, useChatStore } from '@/stores/chatStore';

/** Inert defaults returned when threadId is null or has no entry. Frozen so
 *  callers can't accidentally mutate a shared singleton. */
const EMPTY_MESSAGES: readonly ChatMessage[] = Object.freeze([]);
const EMPTY_AGENT_STATUSES: Readonly<Record<string, AgentStatusType>> = Object.freeze({});
const EMPTY_ACTIVE_INVOCATIONS: Readonly<Record<string, { agentId: string; mode: string; startedAt?: number }>> =
  Object.freeze({});
const EMPTY_TARGET_AGENTS: readonly string[] = Object.freeze([]);
const EMPTY_AGENT_INVOCATIONS: Readonly<Record<string, AgentInvocationInfo>> = Object.freeze({});

export interface ThreadLiveness {
  hasActive: boolean;
  agentStatuses: Record<string, AgentStatusType>;
  /** F210 H3: per-agent agy 进度文案（折叠单行 "AGY working · N steps · latest"），ThinkingIndicator 显示。 */
  agentStatusDetails: Record<string, string>;
  activeInvocations: Record<string, { agentId: string; mode: string; startedAt?: number }>;
  agentInvocations: Record<string, AgentInvocationInfo>;
  intentMode: 'execute' | 'ideate' | null;
  targetAgents: string[];
}

const DEFAULT_LIVENESS: ThreadLiveness = {
  hasActive: false,
  agentStatuses: EMPTY_AGENT_STATUSES as Record<string, AgentStatusType>,
  agentStatusDetails: EMPTY_AGENT_STATUSES as unknown as Record<string, string>,
  activeInvocations: EMPTY_ACTIVE_INVOCATIONS as Record<string, { agentId: string; mode: string; startedAt?: number }>,
  agentInvocations: EMPTY_AGENT_INVOCATIONS as Record<string, AgentInvocationInfo>,
  intentMode: null,
  targetAgents: EMPTY_TARGET_AGENTS as string[],
};

/** Pure selector — returns the messages array for a thread, preferring the
 *  flat slice when threadId is current (to keep reference equality with the
 *  source-of-truth and avoid cross-thread dup). */
export function selectThreadMessages(state: ChatState, threadId: string | null): ChatMessage[] {
  if (!threadId) return EMPTY_MESSAGES as ChatMessage[];
  if (threadId === state.currentThreadId || !state.currentThreadId) {
    return state.messages ?? (EMPTY_MESSAGES as ChatMessage[]);
  }
  return state.threadStates?.[threadId]?.messages ?? (EMPTY_MESSAGES as ChatMessage[]);
}

/** Pure selector — returns liveness fields for a thread. Defensively
 *  falls back to inert defaults for any field the (test) state may have
 *  omitted. Production state from `useChatStore` always has all fields,
 *  but unit-test mocks routinely partial-init it; selector must not throw.
 *
 *  When the current-thread branch matches (or `currentThreadId` is missing
 *  in a partial test mock), reads the flat slice — this preserves the Phase
 *  A mirror invariant: flat is always a valid mirror of the current thread,
 *  so reading it for "the current thread" is identical to reading from
 *  threadStates. */
export function selectThreadLiveness(state: ChatState, threadId: string | null): ThreadLiveness {
  if (!threadId) return DEFAULT_LIVENESS;
  // Current-thread path. Also taken when `currentThreadId` is absent
  // (incomplete test mocks) — flat is the only authoritative source then.
  if (threadId === state.currentThreadId || !state.currentThreadId) {
    return {
      hasActive: state.hasActiveInvocation ?? false,
      agentStatuses: state.agentStatuses ?? DEFAULT_LIVENESS.agentStatuses,
      agentStatusDetails: state.agentStatusDetails ?? DEFAULT_LIVENESS.agentStatusDetails,
      activeInvocations: state.activeInvocations ?? DEFAULT_LIVENESS.activeInvocations,
      agentInvocations: state.agentInvocations ?? DEFAULT_LIVENESS.agentInvocations,
      intentMode: state.intentMode ?? null,
      targetAgents: state.targetAgents ?? DEFAULT_LIVENESS.targetAgents,
    };
  }
  const ts = state.threadStates?.[threadId];
  if (!ts) return DEFAULT_LIVENESS;
  return {
    hasActive: ts.hasActiveInvocation ?? false,
    agentStatuses: ts.agentStatuses ?? DEFAULT_LIVENESS.agentStatuses,
    agentStatusDetails: ts.agentStatusDetails ?? DEFAULT_LIVENESS.agentStatusDetails,
    activeInvocations: ts.activeInvocations ?? DEFAULT_LIVENESS.activeInvocations,
    agentInvocations: ts.agentInvocations ?? DEFAULT_LIVENESS.agentInvocations,
    intentMode: ts.intentMode ?? null,
    targetAgents: ts.targetAgents ?? DEFAULT_LIVENESS.targetAgents,
  };
}

/** React hook — thread-scoped messages. Drop-in for `useChatStore((s) => s.messages)`
 *  but routes through threadStates for non-current threads. */
export function useThreadMessages(threadId: string | null): ChatMessage[] {
  return useChatStore((s) => selectThreadMessages(s, threadId));
}

/** React hook — thread-scoped liveness. Wrapped with `useShallow` because
 *  the selector returns a synthesized object on every call; without shallow
 *  every store mutation would rerender consumers even when liveness is
 *  unchanged. */
export function useThreadLiveness(threadId: string | null): ThreadLiveness {
  return useChatStore(useShallow((s) => selectThreadLiveness(s, threadId)));
}
