'use client';

import type { RankedAgent, StreakAgent } from '@agent-studio/shared';
import { type ReactNode } from 'react';
import { useAgentData } from '@/hooks/useAgentData';
import typographyTokens from '@/styles/typography-tokens.json';
import { AgentAvatar } from './AgentAvatar';

const MEDAL = ['🥇', '🥈', '🥉'];

function AgentTag({ agentId }: { agentId: string }) {
  const { getAgentById } = useAgentData();
  const agent = getAgentById(agentId);
  const family = agent?.roleDisplayName ?? agent?.displayName;
  const detail = agent?.variantLabel ?? agent?.nickname ?? agent?.id;
  const label = family && detail && family !== detail ? `${family} · ${detail}` : (family ?? detail ?? agentId);

  return (
    <span
      className="text-label font-medium"
      style={{ color: 'var(--studio-text-muted)', fontFamily: 'Plus Jakarta Sans, sans-serif' }}
    >
      {label}
    </span>
  );
}

export function AgentHeroCard({ agent, unit }: { agent: RankedAgent; unit: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl p-5" style={{ background: 'var(--console-pill-bg)' }}>
      <span style={{ fontSize: typographyTokens.fontSizePx.leaderboardMedal }}>
        {MEDAL[agent.rank - 1] ?? `#${agent.rank}`}
      </span>
      <AgentAvatar agentId={agent.agentId} size={72} />
      <span className="text-lg font-medium" style={{ fontFamily: 'Fraunces, serif', color: 'var(--studio-text)' }}>
        {agent.displayName}
      </span>
      <AgentTag agentId={agent.agentId} />
      <span
        className="text-4xl font-medium tracking-tight"
        style={{ fontFamily: 'Fraunces, serif', color: 'var(--studio-accent)' }}
      >
        {agent.count}
      </span>
      <span className="text-label font-medium" style={{ color: 'var(--studio-text-muted)' }}>
        {unit}
      </span>
    </div>
  );
}

export function WorkMetric({ agent, label }: { agent: RankedAgent | undefined; label: string }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl p-5" style={{ background: 'var(--console-pill-bg)' }}>
      <span
        className="text-4xl font-medium tracking-tight"
        style={{ fontFamily: 'Fraunces, serif', color: 'var(--studio-text)' }}
      >
        {agent?.count ?? 0}
      </span>
      <span
        className="text-xs font-medium"
        style={{ color: 'var(--studio-text-muted)', fontFamily: 'Plus Jakarta Sans, sans-serif' }}
      >
        {label}
      </span>
      {agent && (
        <span
          className="inline-flex self-start rounded-md px-2.5 py-1 text-label font-semibold"
          style={{
            background: 'color-mix(in srgb, var(--studio-accent) 8%, transparent)',
            color: 'var(--studio-accent)',
            fontFamily: 'Plus Jakarta Sans, sans-serif',
          }}
        >
          🏅 {agent.displayName}
        </span>
      )}
    </div>
  );
}

export function MiniRanked({ items, unit }: { items: RankedAgent[]; unit: string }) {
  if (items.length === 0)
    return (
      <p className="text-sm" style={{ color: 'var(--studio-text-muted)' }}>
        暂无数据
      </p>
    );
  return (
    <ul className="space-y-2">
      {items.slice(0, 5).map((agent) => (
        <li key={agent.agentId} className="flex items-center gap-2">
          <span className="text-sm">{MEDAL[agent.rank - 1] ?? `#${agent.rank}`}</span>
          <AgentAvatar agentId={agent.agentId} size={24} />
          <span className="text-compact font-semibold" style={{ color: 'var(--studio-text)' }}>
            {agent.displayName}
          </span>
          <span className="text-label ml-auto" style={{ color: 'var(--studio-text-muted)' }}>
            {agent.count} {unit}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function StreakRanked({ items }: { items: StreakAgent[] }) {
  if (items.length === 0)
    return (
      <p className="text-sm" style={{ color: 'var(--studio-text-muted)' }}>
        暂无数据
      </p>
    );
  return (
    <ul className="space-y-2">
      {items.slice(0, 5).map((agent) => (
        <li key={agent.agentId} className="flex items-center gap-2">
          <span className="text-sm">{MEDAL[agent.rank - 1] ?? `#${agent.rank}`}</span>
          <span className="text-compact font-semibold" style={{ color: 'var(--studio-text)' }}>
            {agent.displayName}
          </span>
          <span className="text-label ml-auto" style={{ color: 'var(--studio-text-muted)' }}>
            连续 {agent.currentStreak} 天 (最长 {agent.maxStreak})
          </span>
        </li>
      ))}
    </ul>
  );
}

export function SectionCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl p-6 flex flex-col gap-4" style={{ background: 'var(--console-card-bg)' }}>
      <h3 className="text-xl font-medium" style={{ fontFamily: 'Fraunces, serif', color: 'var(--studio-text)' }}>
        {title}
      </h3>
      {children}
    </div>
  );
}
