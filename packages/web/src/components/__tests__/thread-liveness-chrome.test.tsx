import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_THREAD_STATE, useChatStore } from '@/stores/chatStore';
import { ThinkingIndicator } from '../ThinkingIndicator';
import { ThreadExecutionBar } from '../ThreadExecutionBar';

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(async () => new Response('{}', { status: 200 })),
}));

vi.mock('@/hooks/useAgentData', () => ({
  formatAgentName: (agent: { displayName?: string; id: string }) => agent.displayName ?? agent.id,
  useAgentData: () => ({
    getAgentById: (id: string) => ({
      id,
      displayName: id === 'opus' ? 'Ethan（任务主控与实现）（Opus 4.7）' : id,
      color: { primary: '#9B7EBD' },
    }),
  }),
}));

vi.mock('@/utils/api-client', () => ({
  apiFetch: mocks.apiFetch,
}));

function resetStore() {
  useChatStore.setState({
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
    activeInvocations: {},
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
}

describe('thread-scoped liveness chrome', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    (globalThis as { React?: typeof React }).React = React;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    delete (globalThis as { React?: typeof React }).React;
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  beforeEach(() => {
    resetStore();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.clearAllMocks();
  });

  it('ThreadExecutionBar reads the requested thread liveness, not the flat current-thread mirror', () => {
    useChatStore.setState({
      currentThreadId: 'thread-a',
      activeInvocations: {},
      threadStates: {
        'thread-b': {
          ...DEFAULT_THREAD_STATE,
          hasActiveInvocation: true,
          activeInvocations: { 'inv-b': { agentId: 'opus', mode: 'execute', startedAt: 1000 } },
          targetAgents: ['opus'],
          agentStatuses: { opus: 'streaming' },
        },
      },
    });

    act(() => {
      root.render(React.createElement(ThreadExecutionBar, { threadId: 'thread-b' }));
    });

    expect(container.textContent).toContain('执行中');
    expect(container.textContent).toContain('Ethan（任务主控与实现）（Opus 4.7）');
  });

  it('ThreadExecutionBar cancel uses the requested thread id', async () => {
    useChatStore.setState({
      currentThreadId: 'thread-a',
      activeInvocations: {},
      threadStates: {
        'thread-b': {
          ...DEFAULT_THREAD_STATE,
          hasActiveInvocation: true,
          activeInvocations: { 'inv-b': { agentId: 'opus', mode: 'execute', startedAt: 1000 } },
          targetAgents: ['opus'],
          agentStatuses: { opus: 'streaming' },
        },
      },
    });

    act(() => {
      root.render(React.createElement(ThreadExecutionBar, { threadId: 'thread-b' }));
    });

    const stopButton = container.querySelector('button[aria-label="Stop opus"]') as HTMLButtonElement | null;
    expect(stopButton).not.toBeNull();

    await act(async () => {
      stopButton?.click();
    });

    expect(mocks.apiFetch).toHaveBeenCalledWith('/api/threads/thread-b/cancel/opus', { method: 'POST' });
  });

  it('ThinkingIndicator shows the requested thread spawning agent during A2A handoff windows', () => {
    useChatStore.setState({
      currentThreadId: 'thread-a',
      targetAgents: [],
      agentStatuses: {},
      threadStates: {
        'thread-b': {
          ...DEFAULT_THREAD_STATE,
          hasActiveInvocation: true,
          targetAgents: ['opus'],
          agentStatuses: { opus: 'spawning' },
        },
      },
    });

    act(() => {
      root.render(React.createElement(ThinkingIndicator, { threadId: 'thread-b' }));
    });

    expect(container.textContent).toContain('Ethan（任务主控与实现）（Opus 4.7） 启动中');
  });
});
