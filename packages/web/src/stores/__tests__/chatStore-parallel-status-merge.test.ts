/**
 * Tests for #117: ParallelStatusBar only showing single agent.
 *
 * Root cause: setTargetAgents uses replace semantics — when multi-mention
 * dispatches emit per-agent intent_mode events, each one overwrites the
 * previous, leaving only the last agent visible.
 *
 * Expected: merge semantics — subsequent setTargetAgents calls should union
 * with existing targetAgents and preserve already-set agentStatuses.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useChatStore } from '../chatStore';

describe('chatStore setTargetAgents merge semantics (#117)', () => {
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
      threadStates: {},
      viewMode: 'single',
      splitPaneThreadIds: [],
      splitPaneTargetId: null,
      currentThreadId: 'thread-a',
      currentProjectPath: 'default',
      threads: [],
      isLoadingThreads: false,
    });
  });

  it('initial setTargetAgents with 3 agents sets all to pending', () => {
    useChatStore.getState().setTargetAgents(['opus', 'codex', 'opencode']);
    const state = useChatStore.getState();
    expect(state.targetAgents).toEqual(['opus', 'codex', 'opencode']);
    expect(state.agentStatuses).toEqual({
      opus: 'pending',
      codex: 'pending',
      opencode: 'pending',
    });
  });

  it('subsequent setTargetAgents with single agent merges, not replaces', () => {
    // Simulate initial 3-agent intent_mode from messages.ts
    useChatStore.getState().setTargetAgents(['opus', 'codex', 'opencode']);

    // Simulate per-agent intent_mode from callback-multi-mention-routes.ts
    // This should MERGE, not replace
    useChatStore.getState().setTargetAgents(['codex']);

    const state = useChatStore.getState();
    // All 3 agents should still be present
    expect(state.targetAgents).toContain('opus');
    expect(state.targetAgents).toContain('codex');
    expect(state.targetAgents).toContain('opencode');
    expect(state.targetAgents.length).toBe(3);
  });

  it('preserves existing agentStatuses when merging new agents', () => {
    // Set initial 3 agents
    useChatStore.getState().setTargetAgents(['opus', 'codex', 'opencode']);
    // Simulate opus starting to respond
    useChatStore.getState().setAgentStatus('opus', 'streaming');

    // Per-agent intent_mode for codex arrives
    useChatStore.getState().setTargetAgents(['codex']);

    const state = useChatStore.getState();
    // opus status should be preserved as 'streaming', not reset to 'pending'
    expect(state.agentStatuses.opus).toBe('streaming');
    // codex should remain 'pending' (or be refreshed to 'pending')
    expect(state.agentStatuses.codex).toBe('pending');
    // opencode should still exist
    expect(state.agentStatuses.opencode).toBe('pending');
  });

  it('adds genuinely new agents not in existing targetAgents', () => {
    useChatStore.getState().setTargetAgents(['opus', 'codex']);

    // A new agent appears (e.g. user sends another mention while parallel is running)
    useChatStore.getState().setTargetAgents(['opencode']);

    const state = useChatStore.getState();
    expect(state.targetAgents).toContain('opus');
    expect(state.targetAgents).toContain('codex');
    expect(state.targetAgents).toContain('opencode');
  });
});

describe('chatStore setThreadTargetAgents merge semantics (#117)', () => {
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
      threadStates: {},
      viewMode: 'single',
      splitPaneThreadIds: [],
      splitPaneTargetId: null,
      currentThreadId: 'thread-a',
      currentProjectPath: 'default',
      threads: [],
      isLoadingThreads: false,
    });
  });

  it('merges targetAgents for active thread (matches currentThreadId)', () => {
    // Initial 3-agent set via active thread path
    useChatStore.getState().setThreadTargetAgents('thread-a', ['opus', 'codex', 'opencode']);
    // Per-agent emission
    useChatStore.getState().setThreadTargetAgents('thread-a', ['codex']);

    const state = useChatStore.getState();
    expect(state.targetAgents).toContain('opus');
    expect(state.targetAgents).toContain('codex');
    expect(state.targetAgents).toContain('opencode');
  });

  it('merges targetAgents for background thread (threadStates)', () => {
    // Background thread scenario
    useChatStore.getState().setThreadTargetAgents('thread-b', ['opus', 'codex', 'opencode']);
    // Per-agent emission
    useChatStore.getState().setThreadTargetAgents('thread-b', ['codex']);

    const threadState = useChatStore.getState().threadStates['thread-b'];
    expect(threadState?.targetAgents).toContain('opus');
    expect(threadState?.targetAgents).toContain('codex');
    expect(threadState?.targetAgents).toContain('opencode');
  });

  it('preserves agentStatuses for background thread when merging', () => {
    useChatStore.getState().setThreadTargetAgents('thread-b', ['opus', 'codex']);
    useChatStore.getState().updateThreadAgentStatus('thread-b', 'opus', 'streaming');

    // Per-agent emission for codex
    useChatStore.getState().setThreadTargetAgents('thread-b', ['codex']);

    const threadState = useChatStore.getState().threadStates['thread-b'];
    expect(threadState?.agentStatuses?.opus).toBe('streaming');
    expect(threadState?.agentStatuses?.codex).toBe('pending');
  });
});

describe('setTargetAgents empty-array clear semantics (#117 P1 regression)', () => {
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
      threadStates: {},
      viewMode: 'single',
      splitPaneThreadIds: [],
      splitPaneTargetId: null,
      currentThreadId: 'thread-a',
      currentProjectPath: 'default',
      threads: [],
      isLoadingThreads: false,
    });
  });

  it('setTargetAgents([]) clears all agents and statuses', () => {
    useChatStore.getState().setTargetAgents(['opus', 'codex', 'opencode']);
    expect(useChatStore.getState().targetAgents.length).toBe(3);

    useChatStore.getState().setTargetAgents([]);
    const state = useChatStore.getState();
    expect(state.targetAgents).toEqual([]);
    expect(state.agentStatuses).toEqual({});
  });

  it('setThreadTargetAgents(activeThread, []) clears flat state', () => {
    useChatStore.getState().setThreadTargetAgents('thread-a', ['opus']);
    expect(useChatStore.getState().targetAgents).toContain('opus');

    useChatStore.getState().setThreadTargetAgents('thread-a', []);
    const state = useChatStore.getState();
    expect(state.targetAgents).toEqual([]);
    expect(state.agentStatuses).toEqual({});
  });

  it('setThreadTargetAgents(bgThread, []) clears background thread state', () => {
    useChatStore.getState().setThreadTargetAgents('thread-b', ['opus', 'codex']);

    useChatStore.getState().setThreadTargetAgents('thread-b', []);
    const threadState = useChatStore.getState().threadStates['thread-b'];
    expect(threadState?.targetAgents).toEqual([]);
    expect(threadState?.agentStatuses).toEqual({});
  });
});

describe('replaceThreadTargetAgents replace semantics (#117 P1 queue hydration)', () => {
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
      threadStates: {},
      viewMode: 'single',
      splitPaneThreadIds: [],
      splitPaneTargetId: null,
      currentThreadId: 'thread-a',
      currentProjectPath: 'default',
      threads: [],
      isLoadingThreads: false,
    });
  });

  it('stale superset + authoritative subset → converges to subset (active thread)', () => {
    // Stale local state has ['opus', 'codex'] from earlier merge
    useChatStore.getState().setTargetAgents(['opus', 'codex']);
    useChatStore.getState().setAgentStatus('opus', 'streaming');

    // Server says only ['codex'] is active — must REPLACE, not merge
    useChatStore.getState().replaceThreadTargetAgents('thread-a', ['codex']);

    const state = useChatStore.getState();
    expect(state.targetAgents).toEqual(['codex']);
    // opus must be gone — no ghost agent
    expect(state.agentStatuses).not.toHaveProperty('opus');
    expect(state.agentStatuses.codex).toBe('pending');
  });

  it('stale superset + authoritative subset → converges to subset (background thread)', () => {
    // Stale local state for background thread
    useChatStore.getState().setThreadTargetAgents('thread-b', ['opus', 'codex', 'opencode']);
    useChatStore.getState().updateThreadAgentStatus('thread-b', 'opus', 'streaming');

    // Server says only ['codex'] is active — must REPLACE
    useChatStore.getState().replaceThreadTargetAgents('thread-b', ['codex']);

    const threadState = useChatStore.getState().threadStates['thread-b'];
    expect(threadState?.targetAgents).toEqual(['codex']);
    expect(threadState?.agentStatuses).not.toHaveProperty('opus');
    expect(threadState?.agentStatuses).not.toHaveProperty('opencode');
    expect(threadState?.agentStatuses?.codex).toBe('pending');
  });

  it('replaceThreadTargetAgents([]) clears all agents (same as setThreadTargetAgents([]))', () => {
    useChatStore.getState().setThreadTargetAgents('thread-a', ['opus', 'codex']);

    useChatStore.getState().replaceThreadTargetAgents('thread-a', []);

    const state = useChatStore.getState();
    expect(state.targetAgents).toEqual([]);
    expect(state.agentStatuses).toEqual({});
  });

  it('replace does not merge — fresh set each time', () => {
    // First replace sets ['opus']
    useChatStore.getState().replaceThreadTargetAgents('thread-a', ['opus']);
    expect(useChatStore.getState().targetAgents).toEqual(['opus']);

    // Second replace sets ['codex'] — opus must be gone
    useChatStore.getState().replaceThreadTargetAgents('thread-a', ['codex']);
    const state = useChatStore.getState();
    expect(state.targetAgents).toEqual(['codex']);
    expect(state.agentStatuses).not.toHaveProperty('opus');
  });
});
