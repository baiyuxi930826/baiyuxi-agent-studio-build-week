/**
 * QueuePanel A2A queue visibility (2026-06-02): the queue header explains WHY entries wait
 * (behind the active turn) so the user can tell "waiting for the current turn" from "stuck".
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueueEntry } from '@/stores/chat-types';
import { useChatStore } from '@/stores/chatStore';
import { computeQueueWaitInfo, formatElapsed, QueuePanel } from '../QueuePanel';

vi.mock('@/utils/api-client', () => ({
  apiFetch: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
}));

const NOW = Date.now();

const QUEUED_ENTRY: QueueEntry = {
  id: 'q1',
  threadId: 'thread-1',
  userId: 'u1',
  content: 'queued message',
  messageId: 'm1',
  mergedMessageIds: [],
  source: 'user',
  targetAgents: ['opus'],
  intent: 'execute',
  status: 'queued',
  createdAt: NOW,
};

describe('formatElapsed', () => {
  it('renders seconds under a minute', () => {
    expect(formatElapsed(45_000)).toBe('45s');
  });
  it('renders minutes under an hour', () => {
    expect(formatElapsed(12 * 60_000)).toBe('12m');
  });
  it('renders hours with zero-padded minutes', () => {
    expect(formatElapsed(63 * 60_000)).toBe('1h03m');
  });
  it('clamps negative to 0s', () => {
    expect(formatElapsed(-5000)).toBe('0s');
  });
});

describe('computeQueueWaitInfo', () => {
  it('returns null when nothing is active', () => {
    expect(computeQueueWaitInfo({}, ['opus'], NOW)).toBeNull();
    expect(computeQueueWaitInfo(undefined, ['opus'], NOW)).toBeNull();
  });

  it('reports the targeted active agent + elapsed', () => {
    const info = computeQueueWaitInfo({ inv1: { agentId: 'opus', startedAt: NOW - 65_000 } }, ['opus'], NOW);
    expect(info?.agentId).toBe('opus');
    expect(info?.elapsedLabel).toBe('1m');
  });

  // 砚砚 P1 regression: a longer-running NON-target active agent (codex) must NOT be shown as the
  // blocker when the visible queued entry actually targets a different agent (opus). Per-agent slot.
  it('attributes the TARGET agent, not the oldest unrelated active agent (砚砚 P1)', () => {
    const info = computeQueueWaitInfo(
      {
        invCodex: { agentId: 'codex', startedAt: NOW - 600_000 }, // older, but NOT the queued target
        invOpus: { agentId: 'opus', startedAt: NOW - 30_000 }, // the queued entry's target
      },
      ['opus'],
      NOW,
    );
    expect(info?.agentId).toBe('opus');
    expect(info?.elapsedLabel).toBe('30s');
  });

  it('picks the OLDEST among multiple TARGET active agents', () => {
    const info = computeQueueWaitInfo(
      {
        invA: { agentId: 'opus', startedAt: NOW - 120_000 },
        invB: { agentId: 'sonnet', startedAt: NOW - 5_000 },
      },
      ['opus', 'sonnet'],
      NOW,
    );
    expect(info?.agentId).toBe('opus');
    expect(info?.elapsedLabel).toBe('2m');
  });

  it('falls back to oldest active (thread-level) when NO target agent is active', () => {
    // entry targets opus, but only codex is active → thread-level block; codex is a correct
    // attribution (no target agent is active, so this branch cannot misattribute a target blocker).
    const info = computeQueueWaitInfo({ invCodex: { agentId: 'codex', startedAt: NOW - 90_000 } }, ['opus'], NOW);
    expect(info?.agentId).toBe('codex');
    expect(info?.elapsedLabel).toBe('1m');
  });

  it('null elapsedLabel when startedAt is missing', () => {
    const info = computeQueueWaitInfo({ inv1: { agentId: 'opus' } }, ['opus'], NOW);
    expect(info?.agentId).toBe('opus');
    expect(info?.elapsedLabel).toBeNull();
  });
});

describe('QueuePanel wait-reason render', () => {
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
    useChatStore.setState({
      messages: [],
      queue: [],
      queuePaused: false,
      currentThreadId: 'thread-1',
      activeInvocations: {},
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it('shows "等待 {agent} 当前回合（已运行 …）" when an invocation is active and entries are queued', () => {
    useChatStore.setState({
      queue: [QUEUED_ENTRY],
      activeInvocations: { inv1: { agentId: 'opus', mode: 'execute', startedAt: NOW - 90_000 } },
    });
    act(() => {
      root.render(React.createElement(QueuePanel, { threadId: 'thread-1' }));
    });
    const html = container.innerHTML;
    expect(html).toContain('等待');
    expect(html).toContain('opus');
    expect(html).toContain('当前回合');
    expect(html).toContain('已运行');
  });

  it('does NOT show a wait reason when nothing is active (queue draining, not blocked)', () => {
    useChatStore.setState({ queue: [QUEUED_ENTRY], activeInvocations: {} });
    act(() => {
      root.render(React.createElement(QueuePanel, { threadId: 'thread-1' }));
    });
    expect(container.innerHTML).not.toContain('当前回合');
  });

  // 砚砚 P1 end-to-end: queued entry targets opus; codex is active LONGER but is not the target.
  // The panel must attribute the wait to opus (the target), not codex.
  it('shows the TARGET agent (opus), not an older unrelated active agent (codex)', () => {
    useChatStore.setState({
      queue: [QUEUED_ENTRY], // targetAgents: ['opus']
      activeInvocations: {
        invCodex: { agentId: 'codex', mode: 'execute', startedAt: NOW - 600_000 },
        invOpus: { agentId: 'opus', mode: 'execute', startedAt: NOW - 30_000 },
      },
    });
    act(() => {
      root.render(React.createElement(QueuePanel, { threadId: 'thread-1' }));
    });
    const html = container.innerHTML;
    expect(html).toContain('当前回合');
    expect(html).toContain('opus');
    expect(html).not.toContain('codex');
  });
});
