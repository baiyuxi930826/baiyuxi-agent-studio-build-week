/**
 * F32-b Phase 3: Regression test for useAgentData in-session retry mechanism.
 *
 * Verifies: first fetch fails → 10s timer → retry succeeds →
 *           agents updated from empty to API data → no further retries.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────

const mockApiFetch = vi.fn();
vi.mock('@/utils/api-client', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

vi.mock('@/lib/mention-highlight', () => ({ refreshMentionData: vi.fn() }));
vi.mock('@/utils/transcription-corrector', () => ({ refreshSpeechAliases: vi.fn() }));

import type { AgentData } from '@/hooks/useAgentData';
import { _resetAgentDataCache, useAgentData } from '@/hooks/useAgentData';

// ── API response agents (distinguishable from fallback via roleId) ──

const API_CATS = [
  {
    id: 'opus',
    displayName: 'Ethan（任务主控与实现）',
    nickname: '宪宪',
    color: { primary: '#9B7EBD', secondary: '#E8D5F5' },
    mentionPatterns: ['@Ethan', '@Ethan（任务主控与实现）', '@opus'],
    roleId: 'lead-architect',
    clientId: 'anthropic',
    defaultModel: 'claude-opus-4',
    avatar: '/avatars/default.svg',
    roleDescription: '主架构师',
    personality: '温柔有主见',
    source: 'seed',
    roster: {
      family: 'lead-architect',
      roles: ['architect', 'peer-reviewer'],
      lead: true,
      available: true,
      evaluation: 'seed lead',
    },
  },
  {
    id: 'codex',
    displayName: 'Owen（验证与审查）',
    nickname: '砚砚',
    color: { primary: '#5B8C5A', secondary: '#D5E8D4' },
    mentionPatterns: ['@Owen', '@Owen（验证与审查）', '@codex'],
    roleId: 'code-reviewer',
    clientId: 'openai',
    defaultModel: 'codex-mini',
    avatar: '/avatars/default.svg',
    roleDescription: '代码审查',
    personality: '严格',
    source: 'runtime',
    roster: null,
  },
];

// ── Test harness ───────────────────────────────────────────

let container: HTMLDivElement;
let root: Root;
let hookResult: ReturnType<typeof useAgentData>;
let hookResultA: ReturnType<typeof useAgentData>;
let hookResultB: ReturnType<typeof useAgentData>;

function TestComponent() {
  hookResult = useAgentData();
  return null;
}

function MultiHookComponent() {
  hookResultA = useAgentData();
  hookResultB = useAgentData();
  return null;
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
});

beforeEach(() => {
  vi.useFakeTimers();
  _resetAgentDataCache();
  mockApiFetch.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

// ── Tests ──────────────────────────────────────────────────

describe('useAgentData retry mechanism', () => {
  it('retries after 10s on failure and stops after success', async () => {
    // F166: /api/config/agent-order always returns empty order; /api/agents follows
    // the retry sequence (fail → success).
    const catsResponses = [{ ok: false }, { ok: true, json: () => Promise.resolve({ agents: API_CATS }) }];
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/api/config/agent-order') return Promise.resolve({ ok: false });
      return Promise.resolve(catsResponses.shift() ?? { ok: false });
    });

    // Render — triggers first fetchAgents()
    await act(async () => {
      root.render(React.createElement(TestComponent));
    });

    const catsCallCount = () => mockApiFetch.mock.calls.filter((call) => call[0] === '/api/agents').length;

    // First fetch resolved (failure) → empty runtime catalog, no fallback members
    expect(hookResult.isLoading).toBe(false);
    expect(hookResult.agents).toEqual([]);
    expect(catsCallCount()).toBe(1);

    // Advance 10s → retry timer fires → retryCount increments → re-fetch
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    // Second fetch resolved (success) → API agents with roleId
    expect(hookResult.agents).toHaveLength(2);
    expect(hookResult.agents[0].roleId).toBe('lead-architect');
    expect(hookResult.agents[1].id).toBe('codex');
    expect((hookResult.agents[0] as AgentData & { source?: string }).source).toBe('seed');
    expect((hookResult.agents[0] as AgentData & { roster?: { lead?: boolean } | null }).roster?.lead).toBe(true);
    expect((hookResult.agents[1] as AgentData & { source?: string }).source).toBe('runtime');
    expect((hookResult.agents[1] as AgentData & { roster?: unknown }).roster ?? null).toBeNull();
    expect(catsCallCount()).toBe(2);

    // Advance another 30s → no further retries (success stops the cycle)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(catsCallCount()).toBe(2);
  });

  it('stops retrying after MAX_RETRIES (3) failures', async () => {
    // All calls fail (both /api/agents and /api/config/agent-order)
    mockApiFetch.mockResolvedValue({ ok: false });

    await act(async () => {
      root.render(React.createElement(TestComponent));
    });

    const catsCallCount = () => mockApiFetch.mock.calls.filter((call) => call[0] === '/api/agents').length;

    // Initial fetch = call #1
    expect(catsCallCount()).toBe(1);

    // Retry 1 (10s), Retry 2 (20s), Retry 3 (30s)
    for (let i = 1; i <= 3; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(catsCallCount()).toBe(1 + i);
    }

    // No retry #4 — MAX_RETRIES reached
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(catsCallCount()).toBe(4); // 1 initial + 3 retries
  });

  it('refresh updates all mounted hook consumers, not only the caller', async () => {
    const initialAgents = [
      {
        id: 'opus',
        displayName: 'Ethan（任务主控与实现）',
        mentionPatterns: ['@opus'],
        clientId: 'anthropic',
        defaultModel: 'claude-opus-4',
        avatar: '/a.png',
        roleDescription: 'dev',
        personality: 'kind',
        color: { primary: '#9B7EBD', secondary: '#E8D5F5' },
        source: 'seed',
      },
    ];
    const refreshedAgents = [
      ...initialAgents,
      {
        id: 'codex',
        displayName: 'Owen（验证与审查）',
        mentionPatterns: ['@codex'],
        clientId: 'openai',
        defaultModel: 'gpt-5.4',
        avatar: '/b.png',
        roleDescription: 'review',
        personality: 'rigorous',
        color: { primary: '#4A90E2', secondary: '#E6F2FF' },
        source: 'runtime',
      },
    ];
    const catsResponses = [
      { ok: true, json: () => Promise.resolve({ agents: initialAgents }) },
      { ok: true, json: () => Promise.resolve({ agents: refreshedAgents }) },
    ];
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/api/config/agent-order') return Promise.resolve({ ok: false } as Response);
      return Promise.resolve((catsResponses.shift() ?? { ok: false }) as Response);
    });

    await act(async () => {
      root.render(React.createElement(MultiHookComponent));
    });
    await flushPromises();
    expect(hookResultA.agents).toHaveLength(1);
    expect(hookResultB.agents).toHaveLength(1);

    await act(async () => {
      await hookResultA.refresh();
    });

    expect(hookResultA.agents).toHaveLength(2);
    expect(hookResultB.agents).toHaveLength(2);
  });
});

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
  });
}
