'use client';

import type { Achievement, CvoLevel, GameStats, SillyAgentEntry } from '@agent-studio/shared';
import { AgentAvatar } from './AgentAvatar';
import { StudioIcon } from './rich/StudioIcons';

/** Phase B: Silly agents — 翻车现场 */
export function SillyAgentsList({ entries }: { entries: SillyAgentEntry[] }) {
  if (entries.length === 0)
    return (
      <p className="text-sm" style={{ color: 'var(--studio-text-muted)' }}>
        暂无翻车记录
      </p>
    );
  return (
    <ul className="space-y-2">
      {entries.slice(0, 5).map((e) => (
        <li key={e.agentId} className="flex items-center gap-2">
          <AgentAvatar agentId={e.agentId} size={24} />
          <span className="text-compact font-semibold" style={{ color: 'var(--studio-text)' }}>
            {e.displayName}
          </span>
          <span className="text-label ml-auto font-medium" style={{ color: 'var(--studio-accent)' }}>
            ×{e.count} {e.description}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Phase B: Game arena — 游戏竞技场 */
export function GameArena({ stats }: { stats: GameStats }) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="flex flex-col gap-1">
        <span className="text-3xl font-medium" style={{ fontFamily: 'Fraunces, serif', color: 'var(--studio-accent)' }}>
          {stats.agentTeamDrill.wins}
        </span>
        <span className="text-label" style={{ color: 'var(--studio-text-muted)' }}>
          Agent 对局 胜场
        </span>
        {stats.agentTeamDrill.topAgent && (
          <span className="text-label font-semibold" style={{ color: 'var(--studio-accent)' }}>
            <span className="inline-flex items-center gap-1">
              <StudioIcon name="trophy" className="w-3 h-3" />
              MVP: {stats.agentTeamDrill.topAgent.displayName}
            </span>
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-3xl font-medium" style={{ fontFamily: 'Fraunces, serif', color: 'var(--studio-accent)' }}>
          {stats.whoSpy.shameCount}
        </span>
        <span className="text-label" style={{ color: 'var(--studio-text-muted)' }}>
          谁是卧底 社死次数
        </span>
        {stats.whoSpy.shameAgent && (
          <span className="text-label font-semibold" style={{ color: 'var(--studio-accent)' }}>
            <span className="inline-flex items-center gap-1">
              <StudioIcon name="cross" className="w-3 h-3" />
              社死王: {stats.whoSpy.shameAgent.displayName}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}

/** Phase C: Achievement wall — 成就墙 */
export function AchievementWall({ achievements }: { achievements: Achievement[] }) {
  if (achievements.length === 0)
    return (
      <p className="text-sm" style={{ color: 'var(--studio-text-muted)' }}>
        尚未解锁成就
      </p>
    );
  return (
    <div className="flex flex-wrap gap-3">
      {achievements.map((a) => (
        <div
          key={a.id}
          className="flex items-center gap-2 rounded-lg px-3 py-2"
          style={{ background: 'color-mix(in srgb, var(--studio-accent) 8%, transparent)' }}
          title={a.description}
        >
          <span className="text-conn-amber-text" aria-hidden="true">
            {a.icon ? (
              <StudioIcon name={a.icon} className="w-4 h-4" />
            ) : a.emoji ? (
              a.emoji
            ) : (
              <StudioIcon name="star" className="w-4 h-4" />
            )}
          </span>
          <span className="text-xs font-semibold" style={{ color: 'var(--studio-accent)' }}>
            {a.label}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Phase C: operator level card */
export function CvoLevelCard({ level }: { level: CvoLevel }) {
  const pct = Math.round(level.progress * 100);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-medium" style={{ fontFamily: 'Fraunces, serif', color: 'var(--studio-accent)' }}>
          Lv.{level.level}
        </span>
        <span className="text-sm font-semibold" style={{ color: 'var(--studio-text)' }}>
          {level.title}
        </span>
      </div>
      <p className="text-label" style={{ color: 'var(--studio-text-muted)' }}>
        {level.description}
      </p>
      <div
        className="h-2 rounded-full overflow-hidden"
        style={{ background: 'color-mix(in srgb, var(--studio-accent) 10%, transparent)' }}
      >
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--studio-accent)' }} />
      </div>
      {level.nextTitle && (
        <span className="text-label" style={{ color: 'var(--studio-text-muted)' }}>
          距离「{level.nextTitle}」还需 {level.needed} 个 operator 成就
        </span>
      )}
    </div>
  );
}
