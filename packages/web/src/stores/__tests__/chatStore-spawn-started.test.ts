import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_THREAD_STATE } from '../chat-types';
import { useChatStore } from '../chatStore';

/**
 * F118 D2: spawn_started socket event handling.
 *
 * Tests the store-level state mutations that useSocket.ts performs
 * when receiving a spawn_started event. Covers:
 * - Active thread: setAgentStatus('spawning') for each target agent
 * - Background thread: setThreadLoading + setThreadTargetAgents
 * - Idempotency: duplicate spawn_started doesn't cause jitter
 */
describe('spawn_started state mutations', () => {
  beforeEach(() => {
    useChatStore.setState({
      messages: [],
      isLoading: false,
      isLoadingHistory: false,
      hasMore: true,
      hasActiveInvocation: false,
      intentMode: null,
      targetAgents: [],
      agentStatuses: {},
      agentInvocations: {},
      currentGame: null,
      threadStates: {
        'bg-thread': { ...DEFAULT_THREAD_STATE, lastActivity: Date.now() },
      },
      viewMode: 'single',
      splitPaneThreadIds: [],
      splitPaneTargetId: null,
      currentThreadId: 'thread-1',
      activeInvocations: {},
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('active thread: setAgentStatus sets spawning for each target agent', () => {
    const { setAgentStatus } = useChatStore.getState();

    // Simulate what useSocket spawn_started handler does for active thread
    for (const agentId of ['opus', 'codex']) {
      setAgentStatus(agentId, 'spawning');
    }

    const { agentStatuses } = useChatStore.getState();
    expect(agentStatuses.opus).toBe('spawning');
    expect(agentStatuses.codex).toBe('spawning');
  });

  it('background thread: setThreadLoading + setThreadTargetAgents', () => {
    const store = useChatStore.getState();

    // Simulate what useSocket spawn_started handler does for background thread
    store.setThreadLoading('bg-thread', true);
    store.setThreadHasActiveInvocation('bg-thread', true);
    store.setThreadTargetAgents('bg-thread', ['opus', 'codex']);

    const ts = useChatStore.getState().threadStates['bg-thread'];
    expect(ts?.isLoading).toBe(true);
    expect(ts?.hasActiveInvocation).toBe(true);
    expect(ts?.targetAgents).toEqual(['opus', 'codex']);
  });

  it('idempotent: duplicate setAgentStatus spawning does not trigger listener', () => {
    const { setAgentStatus } = useChatStore.getState();

    setAgentStatus('opus', 'spawning');

    const listener = vi.fn();
    const unsub = useChatStore.subscribe(listener);

    // Duplicate calls — should not trigger
    setAgentStatus('opus', 'spawning');
    setAgentStatus('opus', 'spawning');

    expect(listener).not.toHaveBeenCalled();
    unsub();
  });

  it('spawning → streaming transition works correctly', () => {
    const { setAgentStatus } = useChatStore.getState();

    setAgentStatus('opus', 'spawning');
    expect(useChatStore.getState().agentStatuses.opus).toBe('spawning');

    // intent_mode arrives → agent_message arrives → streaming
    setAgentStatus('opus', 'streaming');
    expect(useChatStore.getState().agentStatuses.opus).toBe('streaming');
  });
});
