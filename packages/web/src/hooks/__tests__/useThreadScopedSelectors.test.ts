/**
 * F173 Phase C Task 1 — Thread-scoped selectors.
 *
 * Establishes the API surface that all read-side components will migrate to
 * (AC-C1). Tests focus on the pure selector functions, since the React hook
 * is a thin wrapper around `useChatStore(selector)`.
 *
 * Phase C goal: read-side components no longer touch flat `chatStore.messages`
 * / `hasActiveInvocation` directly. They go through these selectors so that
 * (1) flat-vs-thread-scoped becomes a writer/mirror concern, not a reader
 * concern; (2) Phase C hydration rewrite can swap the source without touching
 * every consumer.
 */
import { describe, expect, it } from 'vitest';
import type { ChatState } from '@/stores/chatStore';
import { selectThreadLiveness, selectThreadMessages } from '../useThreadScopedSelectors';

function makeState(overrides: Partial<ChatState> = {}): ChatState {
  return {
    messages: [],
    isLoading: false,
    isLoadingHistory: false,
    hasMore: true,
    hasActiveInvocation: false,
    hasDraft: false,
    intentMode: null,
    targetAgents: [],
    agentStatuses: {},
    agentInvocations: {},
    currentGame: null,
    threadStates: {},
    viewMode: 'single',
    splitPaneThreadIds: [],
    splitPaneTargetId: null,
    currentThreadId: 'thread-current',
    currentProjectPath: 'default',
    threads: [],
    isLoadingThreads: false,
    activeInvocations: {},
    ...overrides,
  } as ChatState;
}

describe('F173 Phase C — selectThreadMessages', () => {
  it('returns flat messages when threadId === currentThreadId', () => {
    const state = makeState({
      currentThreadId: 'thread-a',
      messages: [
        { id: 'm1', type: 'user', content: 'hi', timestamp: 1 },
        { id: 'm2', type: 'assistant', agentId: 'opus', content: 'hello', timestamp: 2 },
      ],
    });

    const result = selectThreadMessages(state, 'thread-a');

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('m1');
    expect(result[1].id).toBe('m2');
    // Same reference as flat (zustand reference equality matters for re-render)
    expect(result).toBe(state.messages);
  });

  it('returns threadStates messages when threadId !== currentThreadId', () => {
    const otherMessages = [{ id: 'b1', type: 'user' as const, content: 'b', timestamp: 3 }];
    const state = makeState({
      currentThreadId: 'thread-a',
      messages: [{ id: 'a1', type: 'user', content: 'a', timestamp: 1 }],
      threadStates: {
        'thread-b': {
          messages: otherMessages,
          isLoading: false,
          isLoadingHistory: false,
          hasMore: true,
          hasActiveInvocation: false,
          activeInvocations: {},
          intentMode: null,
          targetAgents: [],
          agentStatuses: {},
          agentStatusDetails: {},
          agentInvocations: {},
          currentGame: null,
          unreadCount: 0,
          hasUserMention: false,
          lastActivity: 0,
          queue: [],
          queuePaused: false,
          queueFull: false,
          workspaceWorktreeId: null,
          workspaceOpenTabs: [],
          workspaceOpenFilePath: null,
          workspaceOpenFileLine: null,
        },
      },
    });

    const result = selectThreadMessages(state, 'thread-b');

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('b1');
    expect(result).toBe(otherMessages);
  });

  it('returns empty array when threadId has no entry', () => {
    const state = makeState({ currentThreadId: 'thread-a', threadStates: {} });
    const result = selectThreadMessages(state, 'thread-unknown');
    expect(result).toEqual([]);
  });

  it('returns empty array when threadId is null', () => {
    const state = makeState();
    const result = selectThreadMessages(state, null);
    expect(result).toEqual([]);
  });
});

describe('F173 Phase C — selectThreadLiveness', () => {
  it('returns flat liveness when threadId === currentThreadId', () => {
    const state = makeState({
      currentThreadId: 'thread-a',
      hasActiveInvocation: true,
      agentStatuses: { opus: 'streaming' },
      activeInvocations: { 'inv-1': { agentId: 'opus', mode: 'execute' } },
      intentMode: 'execute',
      targetAgents: ['opus'],
    });

    const result = selectThreadLiveness(state, 'thread-a');

    expect(result.hasActive).toBe(true);
    expect(result.agentStatuses).toEqual({ opus: 'streaming' });
    expect(result.activeInvocations).toEqual({ 'inv-1': { agentId: 'opus', mode: 'execute' } });
    expect(result.intentMode).toBe('execute');
    expect(result.targetAgents).toEqual(['opus']);
  });

  it('returns threadStates liveness when threadId !== currentThreadId', () => {
    const state = makeState({
      currentThreadId: 'thread-a',
      hasActiveInvocation: false,
      threadStates: {
        'thread-b': {
          messages: [],
          isLoading: false,
          isLoadingHistory: false,
          hasMore: true,
          hasActiveInvocation: true,
          activeInvocations: { 'inv-b': { agentId: 'codex', mode: 'execute' } },
          intentMode: 'ideate',
          targetAgents: ['codex'],
          agentStatuses: { codex: 'pending' },
          agentStatusDetails: {},
          agentInvocations: {},
          currentGame: null,
          unreadCount: 0,
          hasUserMention: false,
          lastActivity: 0,
          queue: [],
          queuePaused: false,
          queueFull: false,
          workspaceWorktreeId: null,
          workspaceOpenTabs: [],
          workspaceOpenFilePath: null,
          workspaceOpenFileLine: null,
        },
      },
    });

    const result = selectThreadLiveness(state, 'thread-b');

    expect(result.hasActive).toBe(true);
    expect(result.agentStatuses).toEqual({ codex: 'pending' });
    expect(result.intentMode).toBe('ideate');
    expect(result.targetAgents).toEqual(['codex']);
  });

  it('returns inert defaults when threadId has no entry', () => {
    const state = makeState({ currentThreadId: 'thread-a', threadStates: {} });
    const result = selectThreadLiveness(state, 'thread-unknown');
    expect(result.hasActive).toBe(false);
    expect(result.agentStatuses).toEqual({});
    expect(result.activeInvocations).toEqual({});
    expect(result.intentMode).toBeNull();
    expect(result.targetAgents).toEqual([]);
  });

  it('returns inert defaults when threadId is null', () => {
    const state = makeState();
    const result = selectThreadLiveness(state, null);
    expect(result.hasActive).toBe(false);
  });

  it('returns agentInvocations from threadStates path (Task 3)', () => {
    const state = makeState({
      currentThreadId: 'thread-a',
      agentInvocations: { opus: { invocationId: 'inv-flat-a', startedAt: 1 } },
      threadStates: {
        'thread-b': {
          messages: [],
          isLoading: false,
          isLoadingHistory: false,
          hasMore: true,
          hasActiveInvocation: true,
          activeInvocations: {},
          intentMode: null,
          targetAgents: [],
          agentStatuses: {},
          agentStatusDetails: {},
          agentInvocations: { codex: { invocationId: 'inv-b-codex', startedAt: 2 } },
          currentGame: null,
          unreadCount: 0,
          hasUserMention: false,
          lastActivity: 0,
          queue: [],
          queuePaused: false,
          queueFull: false,
          workspaceWorktreeId: null,
          workspaceOpenTabs: [],
          workspaceOpenFilePath: null,
          workspaceOpenFileLine: null,
        },
      },
    });

    // Current thread → flat agentInvocations
    expect(selectThreadLiveness(state, 'thread-a').agentInvocations).toEqual({
      opus: { invocationId: 'inv-flat-a', startedAt: 1 },
    });

    // Other thread → threadStates agentInvocations
    expect(selectThreadLiveness(state, 'thread-b').agentInvocations).toEqual({
      codex: { invocationId: 'inv-b-codex', startedAt: 2 },
    });
  });
});
