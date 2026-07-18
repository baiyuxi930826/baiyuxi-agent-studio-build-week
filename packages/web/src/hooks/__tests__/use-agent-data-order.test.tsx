/**
 * F166: useAgentData should apply /api/config/agent-order to the returned agents.
 * Uses project's createRoot + mocked apiFetch convention (no @testing-library/react).
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/api-client', () => ({
  apiFetch: vi.fn(),
}));
vi.mock('@/lib/mention-highlight', () => ({ refreshMentionData: vi.fn() }));
vi.mock('@/utils/transcription-corrector', () => ({ refreshSpeechAliases: vi.fn() }));

const { apiFetch } = await import('@/utils/api-client');
const { _resetAgentDataCache, useAgentData, saveAgentOrder, getCachedAgents } = await import('../useAgentData');

function makeResponse(payload: unknown): Response {
  return { ok: true, json: () => Promise.resolve(payload) } as unknown as Response;
}

function wireApiFetch(responses: Record<string, unknown>) {
  (apiFetch as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
    const payload = responses[path];
    if (payload == null) return Promise.resolve({ ok: false } as Response);
    return Promise.resolve(makeResponse(payload));
  });
}

let captured: ReturnType<typeof useAgentData> | null = null;

function HookHost() {
  captured = useAgentData();
  return null;
}

let container: HTMLDivElement;
let root: Root;

describe('useAgentData applies agentOrder', () => {
  beforeEach(() => {
    _resetAgentDataCache();
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container.remove();
    captured = null;
  });

  it('reorders agents according to /api/config/agent-order', async () => {
    wireApiFetch({
      '/api/agents': { agents: [{ id: 'opus' }, { id: 'opus-47' }, { id: 'gpt52' }] },
      '/api/config/agent-order': { agentOrder: ['opus-47', 'gpt52'] },
    });

    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(HookHost));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(captured?.agents.map((c) => c.id)).toEqual(['opus-47', 'gpt52', 'opus']);
  });

  it('leaves agents in original order when agent-order returns empty', async () => {
    wireApiFetch({
      '/api/agents': { agents: [{ id: 'opus' }, { id: 'opus-47' }, { id: 'gpt52' }] },
      '/api/config/agent-order': { agentOrder: [] },
    });

    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(HookHost));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(captured?.agents.map((c) => c.id)).toEqual(['opus', 'opus-47', 'gpt52']);
  });

  it('stale saveAgentOrder success does not overwrite newer save in cache', async () => {
    wireApiFetch({
      '/api/agents': { agents: [{ id: 'opus' }, { id: 'opus-47' }, { id: 'gpt52' }] },
      '/api/config/agent-order': { agentOrder: [] },
    });

    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(HookHost));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Two concurrent saves — first slow, second fast
    let resolveFirst!: () => void;
    const firstBlocks = new Promise<void>((r) => {
      resolveFirst = r;
    });
    let callCount = 0;
    (apiFetch as ReturnType<typeof vi.fn>).mockImplementation((_path: string, opts?: RequestInit) => {
      if (opts?.method === 'PUT') {
        callCount++;
        if (callCount === 1) {
          // First save: blocks until we manually resolve
          return firstBlocks.then(() => makeResponse({ agentOrder: ['gpt52', 'opus', 'opus-47'] }));
        }
        // Second save: resolves immediately
        return Promise.resolve(makeResponse({ agentOrder: ['opus-47', 'gpt52', 'opus'] }));
      }
      return Promise.resolve({ ok: false } as Response);
    });

    const first = saveAgentOrder(['gpt52', 'opus', 'opus-47']);
    const second = saveAgentOrder(['opus-47', 'gpt52', 'opus']);
    await second;
    // Now the cache should have the second save's order
    expect(getCachedAgents().map((c) => c.id)).toEqual(['opus-47', 'gpt52', 'opus']);

    // Let the first (stale) save complete
    resolveFirst();
    await first;
    // Cache must still reflect the SECOND (newer) save, not the first (stale) one
    expect(getCachedAgents().map((c) => c.id)).toEqual(['opus-47', 'gpt52', 'opus']);
  });

  it('older success after newer failure still updates cache', async () => {
    wireApiFetch({
      '/api/agents': { agents: [{ id: 'opus' }, { id: 'opus-47' }, { id: 'gpt52' }] },
      '/api/config/agent-order': { agentOrder: [] },
    });

    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(HookHost));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    let resolveFirst!: () => void;
    const firstBlocks = new Promise<void>((r) => {
      resolveFirst = r;
    });
    let callCount = 0;
    (apiFetch as ReturnType<typeof vi.fn>).mockImplementation((_path: string, opts?: RequestInit) => {
      if (opts?.method === 'PUT') {
        callCount++;
        if (callCount === 1) {
          return firstBlocks.then(() => makeResponse({ agentOrder: ['gpt52', 'opus', 'opus-47'] }));
        }
        // Second save: immediate 500
        return Promise.resolve({ ok: false, status: 500 } as Response);
      }
      return Promise.resolve({ ok: false } as Response);
    });

    const first = saveAgentOrder(['gpt52', 'opus', 'opus-47']);
    const second = saveAgentOrder(['opus-47', 'gpt52', 'opus']).catch(() => {});
    await second;

    // Let the first (older but only successful) save complete
    resolveFirst();
    await first;
    // Cache should reflect order1 — the only successful backend write
    expect(getCachedAgents().map((c) => c.id)).toEqual(['gpt52', 'opus', 'opus-47']);
  });
});
