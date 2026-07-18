'use client';

/**
 * F174 D2b-3 — Callback Auth deep-dive subtab inside HubObservabilityTab.
 *
 * Layer 3 of the "明厨亮灶" model — for after-the-fact audit, cross-period
 * trends, and batch diagnosis. NOT a primary perception surface (that's
 * D2b-1 in-context rich block + D2b-2 agent status dot).
 *
 * Renders the full /api/debug/callback-auth snapshot:
 *  - 24h totals + reason distribution + Top tools + Top affected agents
 *  - All-time totals (since process start)
 *  - Recent samples (most recent at top)
 *  - Legacy fallback hits (Phase F deadline countdown)
 */

import { useEffect } from 'react';
import {
  useCallbackAuthAvailable,
  useCallbackAuthError,
  useCallbackAuthMarkViewed,
  useCallbackAuthRawSnapshot,
} from '@/stores/callbackAuthStore';
import { CallbackAuthAgentAvatar } from './CallbackAuthAgentAvatar';

const REASON_LABEL: Record<string, string> = {
  expired: 'expired',
  invalid_token: 'invalid_token',
  unknown_invocation: 'unknown_invocation',
  stale_invocation: 'stale_invocation',
  missing_creds: 'missing_creds',
};

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-studio-surface-elevated px-4 py-3">
      <div className="text-xs text-studio-muted">{label}</div>
      <div className="mt-1 text-xl font-semibold text-studio">{value}</div>
      {sub && <div className="text-xs text-studio-secondary">{sub}</div>}
    </div>
  );
}

function ReasonDistribution({ byReason, total }: { byReason: Record<string, number>; total: number }) {
  const entries = Object.entries(byReason)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    return <div className="text-xs text-studio-muted">无失败记录</div>;
  }
  return (
    <div className="space-y-1">
      {entries.map(([reason, count]) => {
        const pct = total > 0 ? (count / total) * 100 : 0;
        return (
          <div key={reason} className="flex items-center gap-2 text-xs">
            <span className="w-32 text-studio">{REASON_LABEL[reason] ?? reason}</span>
            <div className="relative h-3 flex-1 overflow-hidden rounded bg-studio-surface-elevated">
              <div
                className="absolute inset-y-0 left-0 rounded bg-studio-status-degraded"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="w-12 text-right font-mono text-studio-secondary">{count}</span>
          </div>
        );
      })}
    </div>
  );
}

function AgentRoster({ byAgent, max = 6 }: { byAgent: Record<string, number>; max?: number }) {
  const entries = Object.entries(byAgent)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max);
  if (entries.length === 0) {
    return <div className="text-xs text-studio-muted">24h 内无失败</div>;
  }
  return (
    <div className="flex flex-wrap items-start gap-3" data-testid="callback-auth-roster">
      {entries.map(([agentId, count]) => (
        <div key={agentId} className="flex w-16 flex-col items-center gap-1">
          {/* CallbackAuthAgentAvatar reads status + popover from the global store
              so this in-panel roster matches what ThreadItem participants show. */}
          <CallbackAuthAgentAvatar agentId={agentId} size={48} />
          <div className="truncate text-micro text-studio">{agentId}</div>
          <div className="text-micro text-studio-muted">{count} fail</div>
        </div>
      ))}
    </div>
  );
}

function TopList({ title, entries, max = 5 }: { title: string; entries: Array<[string, number]>; max?: number }) {
  if (entries.length === 0) {
    return (
      <div>
        <div className="mb-2 text-xs font-medium text-studio-muted">{title}</div>
        <div className="text-xs text-studio-muted">—</div>
      </div>
    );
  }
  const top = [...entries].sort((a, b) => b[1] - a[1]).slice(0, max);
  return (
    <div>
      <div className="mb-2 text-xs font-medium text-studio-muted">{title}</div>
      <div className="space-y-0.5">
        {top.map(([key, count]) => (
          <div key={key} className="flex items-center justify-between text-xs">
            <span className="truncate font-mono text-studio">{key}</span>
            <span className="ml-2 text-studio-secondary">{count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function HubCallbackAuthPanel() {
  // Cloud Codex P2 #1403 (round 6): consume the global store instead of
  // spawning a second polling instance — eliminates the data-skew window
  // where the in-panel byAgent row used a fresh snapshot but the
  // CallbackAuthAgentAvatar dot read stale store state.
  const snapshot = useCallbackAuthRawSnapshot();
  const isAvailable = useCallbackAuthAvailable();
  const error = useCallbackAuthError();
  const markViewed = useCallbackAuthMarkViewed();

  // F174 D2b-2 rev3: opening this panel = "看过 callback auth" → POST mark-viewed
  // → ActivityBar unread badge clears. Implements GitHub bell icon / iOS app badge
  // mental model. Effect runs once on mount (markViewed is a stable zustand
  // action). Errors silently swallowed inside markViewed (badge updates on
  // next successful poll regardless).
  useEffect(() => {
    if (!isAvailable) return;
    void markViewed();
  }, [isAvailable, markViewed]);

  if (error && !isAvailable) {
    return (
      <p className="text-sm text-studio-secondary">
        无法加载 callback auth 数据：<span className="font-mono">{error}</span>
      </p>
    );
  }
  if (!snapshot) return <p className="text-sm text-studio-muted">...</p>;

  const r24 = snapshot.recent24h;
  const recentSamples = [...snapshot.recentSamples].slice(-10).reverse();
  const legacy = snapshot.legacyFallbackHits;

  return (
    <div className="space-y-4" data-testid="hub-callback-auth-panel">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard label="24h Failures" value={String(r24.totalFailures)} />
        <MetricCard label="All-time" value={String(snapshot.totalFailures)} />
        <MetricCard label="Affected Agents (24h)" value={String(Object.keys(r24.byAgent).length)} />
        <MetricCard
          label="Legacy Fallback (cumulative)"
          value={String(legacy?.total ?? 0)}
          sub="Phase F: target 0 by 2026-05-08"
        />
      </div>

      <div className="rounded-lg bg-studio-surface-elevated p-3">
        <div className="mb-2 text-xs font-medium text-studio-muted">REASON DISTRIBUTION (24h)</div>
        <ReasonDistribution byReason={r24.byReason} total={r24.totalFailures} />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg bg-studio-surface-elevated p-3">
          <TopList title="TOP TOOLS (24h)" entries={Object.entries(r24.byTool)} />
        </div>
        <div className="rounded-lg bg-studio-surface-elevated p-3">
          <div className="mb-2 text-xs font-medium text-studio-muted">AFFECTED AGENTS (24h)</div>
          <AgentRoster byAgent={r24.byAgent} />
        </div>
      </div>

      {recentSamples.length > 0 && (
        <div className="rounded-lg bg-studio-surface-elevated p-3">
          <div className="mb-2 text-xs font-medium text-studio-muted">RECENT SAMPLES</div>
          <div className="space-y-1">
            {recentSamples.map((s, i) => (
              <div key={`${s.at}-${i}`} className="flex items-center gap-2 text-xs">
                <span className="w-32 text-studio-muted">{new Date(s.at).toLocaleTimeString()}</span>
                <span className="w-32 font-mono text-studio">{s.reason}</span>
                <span className="font-mono text-studio-secondary">{s.tool}</span>
                {s.agentId && <span className="ml-auto text-studio-muted">{s.agentId}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
