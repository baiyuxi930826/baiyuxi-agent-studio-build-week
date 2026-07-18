import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentStatusType } from '@/stores/chat-types';
import { useChatStore } from '@/stores/chatStore';
import { ThreadExecutionBar } from '../ThreadExecutionBar';

/**
 * F220 Phase 3 — force-reset 逃生口入口集成（AC-3.1 / 3.2 / 3.3）。
 * 真相源：docs/features/F220-a2a-collab-reliability.md §设计稿。
 */
const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(async () => new Response('{"ok":true,"canceledRecords":1}', { status: 200 })),
  addToast: vi.fn(),
}));

vi.mock('@/hooks/useAgentData', () => ({
  formatAgentName: (agent: { displayName?: string; id: string }) => agent.displayName ?? agent.id,
  useAgentData: () => ({ getAgentById: (id: string) => ({ id, displayName: id, color: { primary: '#9B7EBD' } }) }),
}));
vi.mock('@/utils/api-client', () => ({ apiFetch: mocks.apiFetch }));
vi.mock('@/stores/toastStore', () => ({
  useToastStore: { getState: () => ({ addToast: mocks.addToast }) },
}));

function setActive(agentId: string, status: AgentStatusType) {
  useChatStore.setState({
    currentThreadId: 'thread-a',
    activeInvocations: { 'inv-a': { agentId, mode: 'execute', startedAt: 1000 } },
    hasActiveInvocation: true,
    intentMode: 'execute',
    targetAgents: [agentId],
    agentStatuses: { [agentId]: status },
    agentInvocations: {},
    threadStates: {},
  });
}

describe('ThreadExecutionBar force-reset (F220 Phase 3)', () => {
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
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it('renders a force-reset entry when a agent is running (情境化, 非常驻)', () => {
    setActive('opus', 'streaming');
    act(() => {
      root.render(React.createElement(ThreadExecutionBar, { threadId: 'thread-a' }));
    });
    const entry = container.querySelector('[data-testid="force-reset-entry"]');
    expect(entry).not.toBeNull();
    expect(container.textContent).toContain('强制重置');
  });

  it('clicking the entry opens the confirm dialog; confirming calls the force-reset endpoint + toast', async () => {
    setActive('opus', 'streaming');
    act(() => {
      root.render(React.createElement(ThreadExecutionBar, { threadId: 'thread-a' }));
    });

    const entry = container.querySelector('[data-testid="force-reset-entry"]') as HTMLButtonElement;
    await act(async () => {
      entry.click();
    });
    // dialog 打开
    expect(container.textContent).toContain('强制重置这个对话');
    expect(container.textContent).toContain('会保留什么');

    // 点弹窗里的"强制重置"确认按钮（精确文本，区别于入口的"卡住了？强制重置"）
    const confirmBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === '强制重置',
    ) as HTMLButtonElement | undefined;
    expect(confirmBtn).not.toBeUndefined();
    await act(async () => {
      confirmBtn?.click();
    });

    expect(mocks.apiFetch).toHaveBeenCalledWith('/api/threads/thread-a/force-reset', { method: 'POST' });
    expect(mocks.addToast).toHaveBeenCalled();
  });

  it('escalates the entry (data-escalated) when a running agent is suspected_stall', () => {
    setActive('opus', 'suspected_stall');
    act(() => {
      root.render(React.createElement(ThreadExecutionBar, { threadId: 'thread-a' }));
    });
    const entry = container.querySelector('[data-testid="force-reset-entry"]');
    expect(entry?.getAttribute('data-escalated')).toBe('true');
  });

  it('does not escalate when agents are running normally', () => {
    setActive('opus', 'streaming');
    act(() => {
      root.render(React.createElement(ThreadExecutionBar, { threadId: 'thread-a' }));
    });
    const entry = container.querySelector('[data-testid="force-reset-entry"]');
    expect(entry?.getAttribute('data-escalated')).toBe('false');
  });
});
