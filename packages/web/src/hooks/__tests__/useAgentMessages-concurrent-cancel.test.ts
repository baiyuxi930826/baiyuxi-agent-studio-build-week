/**
 * F108 P1: Cancelling one agent during concurrent execution must NOT clear other agents' state.
 *
 * Root cause: done(isFinal) handler unconditionally calls setIntentMode(null),
 * clearAgentStatuses(), setLoading(false) — even when other agents are still active.
 *
 * Fix: only clear global state when the LAST active invocation ends.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAgentMessages } from '@/hooks/useAgentMessages';

const mockAddMessage = vi.fn();
const mockAppendToMessage = vi.fn();
const mockAppendToolEvent = vi.fn();
const mockSetStreaming = vi.fn();
const mockSetLoading = vi.fn();
const mockSetHasActiveInvocation = vi.fn();
const mockClearAllActiveInvocations = vi.fn();
const mockSetIntentMode = vi.fn();
const mockSetAgentStatus = vi.fn();
const mockClearAgentStatuses = vi.fn();
const mockSetAgentInvocation = vi.fn();
const mockSetMessageUsage = vi.fn();
const mockRequestStreamCatchUp = vi.fn();
const mockRemoveActiveInvocation = vi.fn();

const mockAddMessageToThread = vi.fn();
const mockClearThreadActiveInvocation = vi.fn();
const mockResetThreadInvocationState = vi.fn();
const mockSetThreadMessageStreaming = vi.fn();
const mockGetThreadState = vi.fn(() => ({
  messages: [] as Array<{
    id: string;
    type: string;
    agentId?: string;
    content: string;
    isStreaming?: boolean;
    timestamp: number;
  }>,
}));

const storeState: Record<string, unknown> = {
  messages: [] as Array<{
    id: string;
    type: string;
    agentId?: string;
    content: string;
    isStreaming?: boolean;
    timestamp: number;
  }>,
  addMessage: mockAddMessage,
  appendToMessage: mockAppendToMessage,
  appendToolEvent: mockAppendToolEvent,
  setStreaming: mockSetStreaming,
  setLoading: mockSetLoading,
  setHasActiveInvocation: mockSetHasActiveInvocation,
  clearAllActiveInvocations: mockClearAllActiveInvocations,
  setIntentMode: mockSetIntentMode,
  setAgentStatus: mockSetAgentStatus,
  clearAgentStatuses: mockClearAgentStatuses,
  setAgentInvocation: mockSetAgentInvocation,
  setMessageUsage: mockSetMessageUsage,
  requestStreamCatchUp: mockRequestStreamCatchUp,
  removeActiveInvocation: mockRemoveActiveInvocation,
  // F183 Phase B1.5 — active error wire-up routes through reducer's replaceMessages.
  // mutation impl 让 storeState.messages 始终反映 reducer 写入，便于 end-state 断言。
  replaceMessages: vi.fn((msgs: unknown[]) => {
    storeState.messages = msgs as typeof storeState.messages;
  }),
  hasMore: true,

  addMessageToThread: mockAddMessageToThread,
  clearThreadActiveInvocation: mockClearThreadActiveInvocation,
  resetThreadInvocationState: mockResetThreadInvocationState,
  setThreadMessageStreaming: mockSetThreadMessageStreaming,
  getThreadState: mockGetThreadState,
  currentThreadId: 'thread-1',

  // F108: Two agents actively running
  activeInvocations: {
    'inv-opus': { agentId: 'opus', mode: 'execute', startedAt: Date.now() },
    'inv-codex': { agentId: 'codex', mode: 'execute', startedAt: Date.now() },
  },
  agentInvocations: {},
};

let captured: ReturnType<typeof useAgentMessages> | undefined;

vi.mock('@/stores/chatStore', () => {
  const useChatStoreMock = Object.assign(() => storeState, { getState: () => storeState });
  return { useChatStore: useChatStoreMock };
});

function Harness() {
  captured = useAgentMessages();
  return null;
}

describe('F108 P1: concurrent cancel isolation', () => {
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
    captured = undefined;

    // Reset two-agent concurrent state
    storeState.activeInvocations = {
      'inv-opus': { agentId: 'opus', mode: 'execute', startedAt: Date.now() },
      'inv-codex': { agentId: 'codex', mode: 'execute', startedAt: Date.now() },
    };
    storeState.agentInvocations = {};
    storeState.messages = [];
    storeState.currentThreadId = 'thread-1';

    // Make removeActiveInvocation actually remove from the record
    mockRemoveActiveInvocation.mockImplementation((invId: string) => {
      const inv = storeState.activeInvocations as Record<string, unknown>;
      delete inv[invId];
    });

    for (const fn of [
      mockAddMessage,
      mockAppendToMessage,
      mockAppendToolEvent,
      mockSetStreaming,
      mockSetLoading,
      mockSetHasActiveInvocation,
      mockClearAllActiveInvocations,
      mockSetIntentMode,
      mockSetAgentStatus,
      mockClearAgentStatuses,
      mockSetAgentInvocation,
      mockSetMessageUsage,
      mockRemoveActiveInvocation,
      mockRequestStreamCatchUp,
      mockAddMessageToThread,
      mockClearThreadActiveInvocation,
      mockResetThreadInvocationState,
      mockSetThreadMessageStreaming,
      mockGetThreadState,
    ]) {
      fn.mockClear();
    }
    mockGetThreadState.mockImplementation(() => ({ messages: [] }));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('done(isFinal) for one agent does NOT clear global state when another agent is still active', () => {
    act(() => root.render(React.createElement(Harness)));

    // Cancel codex — opus is still running
    act(() => {
      captured?.handleAgentMessage({
        type: 'done',
        agentId: 'codex',
        isFinal: true,
      });
    });

    // Global state should NOT be cleared — opus is still active
    expect(mockSetIntentMode).not.toHaveBeenCalledWith(null);
    expect(mockClearAgentStatuses).not.toHaveBeenCalled();
    // setLoading(false) should not be called while another agent runs
    expect(mockSetLoading).not.toHaveBeenCalledWith(false);
  });

  it('done(isFinal) for the LAST agent DOES clear global state', () => {
    // Only one agent active
    storeState.activeInvocations = {
      'inv-codex': { agentId: 'codex', mode: 'execute', startedAt: Date.now() },
    };

    act(() => root.render(React.createElement(Harness)));

    act(() => {
      captured?.handleAgentMessage({
        type: 'done',
        agentId: 'codex',
        isFinal: true,
      });
    });

    // Now global state SHOULD be cleared — no more active agents
    expect(mockSetIntentMode).toHaveBeenCalledWith(null);
    expect(mockClearAgentStatuses).toHaveBeenCalled();
    expect(mockSetLoading).toHaveBeenCalledWith(false);
  });

  it('error(isFinal) for one agent does NOT clear global state when another agent is still active', () => {
    act(() => root.render(React.createElement(Harness)));

    act(() => {
      captured?.handleAgentMessage({
        type: 'error',
        agentId: 'codex',
        error: 'something broke',
        isFinal: true,
      });
    });

    // Global state should NOT be cleared — opus is still active
    expect(mockSetIntentMode).not.toHaveBeenCalledWith(null);
    expect(mockClearAgentStatuses).not.toHaveBeenCalled();
  });

  it('error(isFinal) for the LAST agent DOES clear global state (including clearAgentStatuses)', () => {
    // Only one agent active
    storeState.activeInvocations = {
      'inv-codex': { agentId: 'codex', mode: 'execute', startedAt: Date.now() },
    };

    act(() => root.render(React.createElement(Harness)));

    act(() => {
      captured?.handleAgentMessage({
        type: 'error',
        agentId: 'codex',
        error: 'something broke',
        isFinal: true,
      });
    });

    // Now global state SHOULD be cleared — no more active agents
    expect(mockSetIntentMode).toHaveBeenCalledWith(null);
    expect(mockClearAgentStatuses).toHaveBeenCalled();
    expect(mockSetLoading).toHaveBeenCalledWith(false);
  });

  it('recoverable non-final error keeps the invocation cancelable while showing the error', () => {
    storeState.activeInvocations = {
      'inv-antig': { agentId: 'antig-opus', mode: 'execute', startedAt: Date.now() },
    };

    act(() => root.render(React.createElement(Harness)));

    act(() => {
      captured?.handleAgentMessage({
        type: 'error',
        agentId: 'antig-opus',
        invocationId: 'inv-antig',
        error: 'The model produced an invalid tool call.',
        errorCode: 'upstream_error',
        isFinal: false,
      });
    });

    // F183 Phase B1.5: active error 通过 reducer 落到 storeState.messages（不再
    // 直接调 mockAddMessage）。end-state 等价：error system bubble 必须存在。
    const msgs = storeState.messages as Array<{ type: string; variant?: string; content: string }>;
    const errorBubble = msgs.find((m) => m.type === 'system' && m.variant === 'error');
    expect(errorBubble).toMatchObject({
      type: 'system',
      variant: 'error',
      content: 'Error: The model produced an invalid tool call.',
    });
    expect(mockSetAgentStatus).not.toHaveBeenCalledWith('antig-opus', 'error');
    expect(mockSetStreaming).not.toHaveBeenCalledWith(expect.any(String), false);
    expect(mockRemoveActiveInvocation).not.toHaveBeenCalled();
    expect(storeState.activeInvocations).toEqual({
      'inv-antig': { agentId: 'antig-opus', mode: 'execute', startedAt: expect.any(Number) },
    });
  });
});

/**
 * clearDoneTimeout safety net bug:
 *
 * clearDoneTimeout() is called unconditionally on the FIRST agent's done/error(isFinal),
 * killing the 5-minute safety timer. If a subsequent agent's done(isFinal) is lost
 * (WebSocket issue, server not yielding it), stale invocation slots persist forever,
 * causing ThreadExecutionBar to show "执行中" until F5.
 *
 * Fix: move clearDoneTimeout() inside the `remainingInvocations === 0` block so
 * the timer stays alive while ANY agent is still running.
 */
describe('clearDoneTimeout safety net during concurrent execution', () => {
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
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    captured = undefined;

    // Two agents actively running
    storeState.activeInvocations = {
      'inv-opus': { agentId: 'opus', mode: 'execute', startedAt: Date.now() },
      'inv-codex': { agentId: 'codex', mode: 'execute', startedAt: Date.now() },
    };
    storeState.agentInvocations = {};
    storeState.messages = [];
    storeState.currentThreadId = 'thread-1';

    mockRemoveActiveInvocation.mockImplementation((invId: string) => {
      const inv = storeState.activeInvocations as Record<string, unknown>;
      delete inv[invId];
    });

    for (const fn of [
      mockAddMessage,
      mockAppendToMessage,
      mockAppendToolEvent,
      mockSetStreaming,
      mockSetLoading,
      mockSetHasActiveInvocation,
      mockClearAllActiveInvocations,
      mockSetIntentMode,
      mockSetAgentStatus,
      mockClearAgentStatuses,
      mockSetAgentInvocation,
      mockSetMessageUsage,
      mockRemoveActiveInvocation,
      mockRequestStreamCatchUp,
      mockAddMessageToThread,
      mockClearThreadActiveInvocation,
      mockResetThreadInvocationState,
      mockSetThreadMessageStreaming,
      mockGetThreadState,
    ]) {
      fn.mockClear();
    }
    mockGetThreadState.mockImplementation(() => ({ messages: [] }));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('done(isFinal) for first agent preserves safety timeout for remaining agents', () => {
    act(() => root.render(React.createElement(Harness)));

    // Codex finishes — opus is still running
    act(() => {
      captured?.handleAgentMessage({
        type: 'done',
        agentId: 'codex',
        isFinal: true,
      });
    });

    // Advance past the 5-minute safety timeout
    act(() => {
      vi.advanceTimersByTime(5 * 60 * 1000 + 100);
    });

    // Safety timeout should have fired — cleaning up stale opus state
    expect(mockClearAllActiveInvocations).toHaveBeenCalled();
  });

  it('error(isFinal) for first agent preserves safety timeout for remaining agents', () => {
    act(() => root.render(React.createElement(Harness)));

    // Codex errors — opus is still running
    act(() => {
      captured?.handleAgentMessage({
        type: 'error',
        agentId: 'codex',
        error: 'something broke',
        isFinal: true,
      });
    });

    // Advance past the 5-minute safety timeout
    act(() => {
      vi.advanceTimersByTime(5 * 60 * 1000 + 100);
    });

    // Safety timeout should have fired — cleaning up stale opus state
    expect(mockClearAllActiveInvocations).toHaveBeenCalled();
  });

  it('done(isFinal) for the LAST agent clears safety timeout (no false alarm)', () => {
    // Only one agent active
    storeState.activeInvocations = {
      'inv-codex': { agentId: 'codex', mode: 'execute', startedAt: Date.now() },
    };

    act(() => root.render(React.createElement(Harness)));

    act(() => {
      captured?.handleAgentMessage({
        type: 'done',
        agentId: 'codex',
        isFinal: true,
      });
    });

    // Clear mock call counts from done handling itself
    mockClearAllActiveInvocations.mockClear();
    mockAddMessage.mockClear();

    // Advance past the 5-minute safety timeout
    act(() => {
      vi.advanceTimersByTime(5 * 60 * 1000 + 100);
    });

    // Safety timeout should NOT fire — properly cleared when last agent finished
    expect(mockClearAllActiveInvocations).not.toHaveBeenCalled();
  });
});
