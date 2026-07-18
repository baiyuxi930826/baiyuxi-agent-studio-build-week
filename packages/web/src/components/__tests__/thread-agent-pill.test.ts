/**
 * F154 Phase B — ThreadAgentPill: shows preferred agent in header, opens AgentSelector popover.
 */
import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href, ...rest }, children),
}));

const TEST_CATS = [
  {
    id: 'opus',
    displayName: 'opus',
    nickname: '宪宪',
    variantLabel: undefined,
    roleDisplayName: 'Ethan（任务主控与实现）',
    color: { primary: '#FFAB91', secondary: '#8D6E63' },
    clientId: 'anthropic',
    defaultModel: 'claude-opus-4-6',
    isDefaultVariant: true,
  },
  {
    id: 'codex',
    displayName: 'codex',
    nickname: '砚砚',
    variantLabel: undefined,
    roleDisplayName: 'Owen（验证与审查）',
    color: { primary: '#66BB6A', secondary: '#2E7D32' },
    clientId: 'openai',
    defaultModel: 'gpt-5.3-codex',
    isDefaultVariant: true,
  },
];

const mockAgentData = {
  agents: TEST_CATS,
  isLoading: false,
  getAgentById: (id: string) => TEST_CATS.find((c) => c.id === id),
  getAgentsByRole: () => new Map(),
  refresh: vi.fn(),
};
vi.mock('@/hooks/useAgentData', () => ({
  useAgentData: () => mockAgentData,
  formatAgentName: (agent: { displayName: string; variantLabel?: string }) =>
    agent.variantLabel ? `${agent.displayName} ${agent.variantLabel}` : agent.displayName,
}));

const TEST_THREAD = {
  id: 'thread_pill_test',
  title: 'Pill Test Thread',
  projectPath: '/projects/agent-studio',
  createdBy: 'user1',
  participants: ['user1'],
  lastActiveAt: Date.now(),
  createdAt: Date.now(),
  pinned: false,
  favorited: false,
  preferredAgents: ['opus'] as string[],
};

const mockStore: Record<string, unknown> = {
  threads: [TEST_THREAD],
  updateThreadPreferredAgents: vi.fn(),
};
vi.mock('@/stores/chatStore', () => {
  const hook = Object.assign(
    (selector?: (s: typeof mockStore) => unknown) => (selector ? selector(mockStore) : mockStore),
    { getState: () => mockStore },
  );
  return { useChatStore: hook };
});

// Lazy import after mocks
const { ThreadAgentPill } = await import('@/components/ThreadAgentPill');

describe('ThreadAgentPill (F154 Phase B)', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    mockStore.threads = [{ ...TEST_THREAD, preferredAgents: ['opus'] }];
  });

  afterEach(() => {
    container.remove();
  });

  const renderPill = (threadId: string) => {
    container.innerHTML = renderToStaticMarkup(React.createElement(ThreadAgentPill, { threadId }));
    return container;
  };

  it('renders pill with agent name when preferredAgents is set', () => {
    expect(renderPill('thread_pill_test').textContent).toContain('opus');
  });

  it('renders ghost pill when preferredAgents is empty', () => {
    mockStore.threads = [{ ...TEST_THREAD, preferredAgents: [] }];
    const el = renderPill('thread_pill_test');
    expect(el.textContent).toContain('首选角色');
    expect(el.querySelector('[data-testid="pill-dot"]')).toBeNull();
  });

  it('renders ghost pill when preferredAgents is undefined', () => {
    mockStore.threads = [{ ...TEST_THREAD, preferredAgents: undefined }];
    const el = renderPill('thread_pill_test');
    expect(el.textContent).toContain('首选角色');
  });

  it('shows persona color dot matching the agent', () => {
    const dot = renderPill('thread_pill_test').querySelector('[data-testid="pill-dot"]');
    expect(dot).not.toBeNull();
    expect(dot?.getAttribute('style')).toContain('background-color:var(--color-opus-primary)');
  });

  it('renders ghost pill for unknown threadId', () => {
    const el = renderPill('thread_nonexistent');
    expect(el.textContent).toContain('首选角色');
  });

  it('shows chevron indicating expandable', () => {
    expect(renderPill('thread_pill_test').textContent).toContain('▾');
  });

  it('does not enter an effect loop when preferredAgents is undefined', async () => {
    mockStore.threads = [{ ...TEST_THREAD, preferredAgents: undefined }];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let root: Root | null = null;
    try {
      root = createRoot(container);
      flushSync(() => {
        root?.render(React.createElement(ThreadAgentPill, { threadId: 'thread_pill_test' }));
      });
      await Promise.resolve();
      expect(
        errorSpy.mock.calls.some((call) => call.some((value) => String(value).includes('Maximum update depth'))),
      ).toBe(false);
    } finally {
      if (root) {
        flushSync(() => {
          root?.unmount();
        });
      }
      errorSpy.mockRestore();
    }
  });
});
