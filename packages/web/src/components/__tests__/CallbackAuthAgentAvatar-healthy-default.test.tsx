/**
 * F174 D2b-2 — cloud Codex P1 #1403 regression: CallbackAuthAgentAvatar must
 * render a status dot for agents with NO failure record, because the backend
 * snapshot's recent24h.byAgent ONLY contains agents that had failures (it's
 * populated in recordCallbackAuthFailure). Without this fix, every healthy
 * agent looked unmonitored — the "always-visible per-agent state" promise of
 * D2b-2 was broken in the common case.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useAgentData', () => ({
  useAgentData: () => ({
    getAgentById: () => ({
      id: 'opus',
      displayName: 'Opus',
      avatar: '/avatars/default.svg',
      color: { primary: '#9CA3AF' },
    }),
    agents: [],
    refresh: () => {},
  }),
}));

let mockByAgent: Record<string, { status: 'healthy' | 'degraded' | 'broken'; failures24h: number }> = {};
let mockAvailable = false;

vi.mock('@/stores/callbackAuthStore', () => ({
  useCallbackAuthByAgent: (agentId: string) => mockByAgent[agentId],
  useCallbackAuthAggregate: () => ({
    byReason: {},
    byTool: {},
    totalFailures24h: 0,
    topReasons: [],
    topTools: [],
  }),
  useCallbackAuthAvailable: () => mockAvailable,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
}));

import { CallbackAuthAgentAvatar } from '../CallbackAuthAgentAvatar';

Object.assign(globalThis as Record<string, unknown>, { React });

describe('CallbackAuthAgentAvatar healthy-default (F174 D2b-2 cloud P1 #1403)', () => {
  it('renders no dot when snapshot is unavailable (non-owner / fetch failed)', () => {
    mockAvailable = false;
    mockByAgent = {};
    const html = renderToStaticMarkup(<CallbackAuthAgentAvatar agentId="opus" size={48} />);
    expect(html).not.toContain('data-testid="callback-auth-dot"');
  });

  it('renders UNKNOWN dot when snapshot is available but agent has no failure record (cloud P1 #1403 round 7)', async () => {
    // Cloud Codex correction to the previous round's "default to healthy" fix:
    // backend's recent24h.byAgent ONLY records failure events — absent ≠ known
    // healthy. Could be no calls at all in 24h, or successful calls without
    // failures. Conflating with healthy gives a false-green signal. We show
    // `unknown` (gray) instead so users see the difference.
    mockAvailable = true;
    mockByAgent = {}; // opus is not in byAgent — backend had no failure event for it
    const html = renderToStaticMarkup(<CallbackAuthAgentAvatar agentId="opus" size={48} />);
    expect(html).toContain('data-testid="callback-auth-dot"');
    expect(html).toContain('data-callback-auth-status="unknown"');
    // Label clarifies: "no failure record" rather than asserting healthy.
    expect(html).toContain('opus: 24h 内无失败记录');
  });

  it('renders DEGRADED dot for a agent with mid failures', () => {
    mockAvailable = true;
    mockByAgent = { opus: { status: 'degraded', failures24h: 3 } };
    const html = renderToStaticMarkup(<CallbackAuthAgentAvatar agentId="opus" size={48} />);
    expect(html).toContain('data-callback-auth-status="degraded"');
    expect(html).toContain('opus: degraded · 3 fails (24h)');
  });

  it('renders BROKEN dot for a agent above threshold', () => {
    mockAvailable = true;
    mockByAgent = { opus: { status: 'broken', failures24h: 12 } };
    const html = renderToStaticMarkup(<CallbackAuthAgentAvatar agentId="opus" size={48} />);
    expect(html).toContain('data-callback-auth-status="broken"');
    expect(html).toContain('opus: broken · 12 fails (24h)');
  });
});
