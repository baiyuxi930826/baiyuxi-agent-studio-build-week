'use client';

/**
 * F174 D2b-2 — drop-in replacement for `<AgentAvatar>` that consumes the
 * global callback-auth store (zustand) to surface the per-agent status dot
 * + AC-D7 hover popover (reason×N + Top tools + 详情 link).
 *
 * Use this wherever a daily-visible roster of agent avatars lives — thread
 * sidebar participants, hub roster, leaderboard. Plain `<AgentAvatar>`
 * remains for non-roster callsites (single-message author, task owner,
 * etc.) so the pattern stays opt-in.
 */

import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { useCallbackAuthAggregate, useCallbackAuthAvailable, useCallbackAuthByAgent } from '@/stores/callbackAuthStore';
import { AgentAvatar } from './AgentAvatar';

interface CallbackAuthAgentAvatarProps {
  agentId: string;
  size?: number;
  /** Forward to underlying AgentAvatar — runtime agent status (streaming etc). */
  status?: React.ComponentProps<typeof AgentAvatar>['status'];
}

export function CallbackAuthAgentAvatar({ agentId, size = 32, status }: CallbackAuthAgentAvatarProps) {
  const cba = useCallbackAuthByAgent(agentId);
  const aggregate = useCallbackAuthAggregate();
  const isAvailable = useCallbackAuthAvailable();
  const router = useRouter();

  const handleOpenDetails = useCallback(() => {
    router.push('/settings?s=ops&ops=observability&obs=callback-auth');
  }, [router]);

  // Cloud Codex #1403 (round 2 + 7): backend snapshot's recent24h.byAgent ONLY
  // accumulates FAILURE events — an absent entry means "no failure record",
  // which is NOT the same as "known healthy". The agent may have had zero
  // callback calls in 24h (no data), or many successful calls. Conflating
  // both into green would give a false health signal on the primary status
  // surface. We surface `unknown` (gray) for absent entries so users can see
  // the difference.
  //   isAvailable=false (snapshot missing / non-owner) → no dot, plain avatar
  //   isAvailable=true + cba undefined → unknown (gray, "no data")
  //   isAvailable=true + cba present   → cba.status (degraded / broken)
  // (healthy/green never fires today — backend lacks per-agent call totals.
  //  When that surface lands, derive healthy = `calls>0 && failures=0`.)
  if (!isAvailable) {
    return <AgentAvatar agentId={agentId} size={size} status={status} />;
  }

  const cbaStatus = cba?.status ?? 'unknown';
  const cbaFailures = cba?.failures24h ?? 0;
  const label = cba ? `${agentId}: ${cbaStatus} · ${cbaFailures} fails (24h)` : `${agentId}: 24h 内无失败记录`;
  const popover = (
    <div className="space-y-2 text-studio">
      <div className="font-semibold">{label}</div>
      {aggregate.topReasons.length > 0 && (
        <div>
          <div className="mb-0.5 text-micro uppercase tracking-wide text-studio-muted">Reasons (24h, all agents)</div>
          {aggregate.topReasons.slice(0, 3).map((r) => (
            <div key={r.name} className="flex items-center justify-between text-xs">
              <span className="font-mono">{r.name}</span>
              <span className="text-studio-secondary">{r.count}</span>
            </div>
          ))}
        </div>
      )}
      {aggregate.topTools.length > 0 && (
        <div>
          <div className="mb-0.5 text-micro uppercase tracking-wide text-studio-muted">Top Tools (24h, all agents)</div>
          {aggregate.topTools.slice(0, 3).map((t) => (
            <div key={t.name} className="flex items-center justify-between text-xs">
              <span className="font-mono">{t.name}</span>
              <span className="text-studio-secondary">{t.count}</span>
            </div>
          ))}
        </div>
      )}
      <div className="pt-1 text-micro text-studio-muted">点击跳 D2b-3 详情</div>
    </div>
  );

  return (
    <AgentAvatar
      agentId={agentId}
      size={size}
      status={status}
      callbackAuthStatus={cbaStatus}
      callbackAuthLabel={label}
      callbackAuthPopover={popover}
      onCallbackAuthClick={handleOpenDetails}
    />
  );
}
