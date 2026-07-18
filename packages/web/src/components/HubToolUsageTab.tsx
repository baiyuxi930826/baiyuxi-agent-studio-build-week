'use client';

import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/utils/api-client';
import { HubIcon } from './hub-icons';

interface ToolUsageReport {
  period: { from: string; to: string };
  summary: { totalCalls: number; byAgentegory: Record<string, number> };
  topTools: Array<{ name: string; category: string; count: number }>;
  daily: Array<{ date: string; native: number; mcp: number; skill: number }>;
  byAgent: Record<string, Record<string, number>>;
}

const AGENT_LABELS: Record<string, string> = {
  opus: 'Ethan（任务主控与实现）',
  codex: 'Owen（验证与审查）',
  gemini: 'Andy（界面与视觉）',
  kimi: 'Nora（研究与上下文）',
};

/* Dataviz tokens defined in console-tokens.css (--dataviz-*), derived from chart palette.
 * No JS override needed — CSS global tokens auto-adapt to light/dark mode. */
const DATAVIZ_TOKENS = {} as React.CSSProperties;
const CATEGORY_STYLE: Record<string, { color: string; bg: string; label: string; iconName: string }> = {
  native: { color: 'var(--dataviz-native)', bg: 'var(--dataviz-native-bg)', label: '原生工具', iconName: 'wrench' },
  mcp: { color: 'var(--dataviz-mcp)', bg: 'var(--dataviz-mcp-bg)', label: 'MCP 桥接', iconName: 'store' },
  skill: { color: 'var(--dataviz-skill)', bg: 'var(--dataviz-skill-bg)', label: '技能调用', iconName: 'sparkles' },
};

const CATEGORIES = ['native', 'mcp', 'skill'] as const;

function agentLabel(agentId: string): string {
  return AGENT_LABELS[agentId] ?? agentId;
}

export function HubToolUsageTab() {
  const [report, setReport] = useState<ToolUsageReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(7);
  const [agentFilter, setAgentFilter] = useState('');
  const [categoryFilter, setAgentegoryFilter] = useState('');

  const fetchData = useCallback(
    async (refresh = false) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ days: String(days) });
        if (agentFilter) params.set('agentId', agentFilter);
        if (categoryFilter) params.set('category', categoryFilter);
        if (refresh) params.set('refresh', '1');
        const res = await apiFetch(`/api/usage/tools?${params}`);
        if (res.ok) {
          setReport((await res.json()) as ToolUsageReport);
        } else {
          setError(`获取失败 (${res.status})`);
        }
      } catch {
        setError('无法连接到服务器');
      } finally {
        setLoading(false);
      }
    },
    [days, agentFilter, categoryFilter],
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const total = report?.summary.totalCalls ?? 0;
  const byAgent = report?.summary.byAgentegory ?? { native: 0, mcp: 0, skill: 0 };

  return (
    <div className="space-y-4" style={DATAVIZ_TOKENS}>
      {/* Header — studio menu style */}
      <div className="flex items-center justify-between rounded-xl bg-[var(--console-card-bg)] px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-studio">工具使用日志</h3>
          <p className="text-label text-studio-muted">Agent 团队的每日工具箱使用记录</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
            className="console-form-input text-xs"
          >
            <option value="">全部角色</option>
            {Object.entries(AGENT_LABELS).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          <select
            value={categoryFilter}
            onChange={(e) => setAgentegoryFilter(e.target.value)}
            className="console-form-input text-xs"
          >
            <option value="">全部类型</option>
            {CATEGORIES.map((agent) => (
              <option key={agent} value={agent}>
                {CATEGORY_STYLE[agent].label}
              </option>
            ))}
          </select>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="console-form-input text-xs">
            <option value={7}>近 7 天</option>
            <option value={14}>近 14 天</option>
            <option value={30}>近 30 天</option>
            <option value={90}>近 90 天</option>
            <option value={0}>全部</option>
          </select>
          <button
            type="button"
            onClick={() => fetchData(true)}
            disabled={loading}
            className="rounded-lg bg-[var(--console-card-bg)] px-3 py-1.5 text-xs text-studio-secondary shadow-[0_1px_3px_rgba(43,33,26,0.06)] transition-colors hover:bg-[var(--console-hover-bg)] disabled:opacity-50"
          >
            {loading ? '冲泡中...' : '刷新'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-[20px] border border-conn-red-ring bg-conn-red-bg px-3 py-2 text-xs text-conn-red-text">
          {error}
        </div>
      )}

      {!error && total === 0 && !loading && (
        <div className="rounded-xl border border-dashed border-[var(--console-border-soft)] bg-[var(--console-card-bg)] py-10 text-center">
          <HubIcon name="store" className="h-7 w-7 text-studio-muted" />
          <p className="mt-2 text-xs text-studio-muted">还没有工具使用记录</p>
          <p className="text-label text-studio-muted">Agent 开始工作后，数据会自动出现在这里</p>
        </div>
      )}

      {total > 0 && report && (
        <>
          <SummaryCards total={total} byAgentegory={byAgent} />
          <DailyTrend daily={report.daily} />
          <TopToolsTable tools={report.topTools} />
          <ByAgentSection byAgent={report.byAgent} />
        </>
      )}
    </div>
  );
}

/* ── Summary: 3 category cards + total ── */
function SummaryCards({ total, byAgentegory }: { total: number; byAgentegory: Record<string, number> }) {
  return (
    <div className="grid grid-cols-4 gap-3">
      <div className="console-list-card rounded-xl shadow-[0_8px_22px_rgba(43,33,26,0.04)] p-3 text-center">
        <div className="text-2xl font-bold text-studio">{total.toLocaleString()}</div>
        <div className="text-label text-studio-muted">总调用</div>
      </div>
      {CATEGORIES.map((agent) => {
        const style = CATEGORY_STYLE[agent];
        const count = byAgentegory[agent] ?? 0;
        return (
          <div
            key={agent}
            className="rounded-xl p-3 text-center shadow-[0_8px_22px_rgba(43,33,26,0.04)]"
            style={{ backgroundColor: style.bg }}
          >
            <HubIcon name={style.iconName} className="h-5 w-5" />
            <div className="text-xl font-bold" style={{ color: style.color }}>
              {count.toLocaleString()}
            </div>
            <div className="text-label" style={{ color: style.color }}>
              {style.label}
              {total > 0 && <span className="ml-1 opacity-60">({Math.round((count / total) * 100)}%)</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Daily trend: horizontal rows with stacked bar + numbers ── */
function DailyTrend({ daily }: { daily: ToolUsageReport['daily'] }) {
  if (daily.length === 0) return null;
  const maxDay = Math.max(...daily.map((d) => d.native + d.mcp + d.skill), 1);
  // API returns dates descending; reverse to show oldest→newest top→bottom
  const sorted = [...daily].reverse();

  return (
    <section className="space-y-3 console-list-card rounded-xl shadow-[0_8px_22px_rgba(43,33,26,0.04)] p-4">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-studio">每日使用趋势</h4>
        <div className="flex gap-4 text-micro">
          {CATEGORIES.map((agent) => {
            const s = CATEGORY_STYLE[agent];
            return (
              <span key={agent} className="flex items-center gap-1" style={{ color: s.color }}>
                <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: s.color }} />
                {s.label}
              </span>
            );
          })}
        </div>
      </div>
      <div className="space-y-2">
        {sorted.map((day) => {
          const dayTotal = day.native + day.mcp + day.skill;
          const pct = (dayTotal / maxDay) * 100;
          return (
            <div key={day.date} className="flex items-center gap-3 text-xs">
              <span className="w-12 shrink-0 text-right tabular-nums text-label text-studio-muted">
                {day.date.slice(5)}
              </span>
              <div className="flex h-6 flex-1 items-center">
                <div className="flex h-full overflow-hidden rounded-md" style={{ width: `${Math.max(pct, 3)}%` }}>
                  {CATEGORIES.map((agent) => {
                    const val = day[agent];
                    if (val === 0) return null;
                    return (
                      <div
                        key={agent}
                        className="h-full"
                        style={{
                          width: `${(val / dayTotal) * 100}%`,
                          backgroundColor: CATEGORY_STYLE[agent].color,
                          minWidth: 3,
                        }}
                      />
                    );
                  })}
                </div>
              </div>
              <span className="w-20 shrink-0 tabular-nums text-label text-studio">
                <span className="font-medium">{dayTotal}</span>
                <span className="ml-1 text-micro text-studio-muted">
                  ({day.native}/{day.mcp}/{day.skill})
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ── Top tools leaderboard — one mini-list per category ── */
function TopToolsTable({ tools }: { tools: ToolUsageReport['topTools'] }) {
  if (tools.length === 0) return null;
  const grouped = CATEGORIES.map((agent) => ({
    agent,
    style: CATEGORY_STYLE[agent],
    items: tools.filter((t) => t.category === agent),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${grouped.length}, minmax(0, 1fr))` }}>
      {grouped.map(({ agent, style, items }) => {
        const maxCount = items[0]?.count ?? 1;
        return (
          <section
            key={agent}
            className="space-y-2 console-list-card rounded-xl shadow-[0_8px_22px_rgba(43,33,26,0.04)] p-3"
          >
            <h4 className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: style.color }}>
              <HubIcon name={style.iconName} className="h-3.5 w-3.5" />
              {style.label}
            </h4>
            <div className="space-y-1">
              {items.map((tool, i) => (
                <div key={`${agent}:${tool.name}`} className="flex items-center gap-1.5 text-xs">
                  <span className="w-4 text-right text-micro text-studio-muted">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-studio" title={tool.name}>
                    {tool.name}
                  </span>
                  <div className="flex w-16 items-center">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--console-card-soft-bg)]">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${(tool.count / maxCount) * 100}%`,
                          backgroundColor: style.color,
                          opacity: 0.7,
                        }}
                      />
                    </div>
                  </div>
                  <span className="w-10 text-right tabular-nums text-label text-studio">{tool.count}</span>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/* ── Per-agent distribution ── */
function ByAgentSection({ byAgent }: { byAgent: Record<string, Record<string, number>> }) {
  const entries = Object.entries(byAgent).sort(
    (a, b) => Object.values(b[1]).reduce((s, v) => s + v, 0) - Object.values(a[1]).reduce((s, v) => s + v, 0),
  );
  if (entries.length === 0) return null;

  return (
    <section className="space-y-3 console-list-card rounded-xl shadow-[0_8px_22px_rgba(43,33,26,0.04)] p-4">
      <h4 className="text-xs font-semibold text-studio">Agent 工具使用分布</h4>
      <div className="space-y-2">
        {entries.map(([agentId, agents]) => {
          const agentTotal = Object.values(agents).reduce((s, v) => s + v, 0);
          return (
            <div key={agentId} className="flex items-center gap-3 text-xs">
              <span className="w-28 truncate font-medium text-studio">{agentLabel(agentId)}</span>
              <div className="flex h-5 flex-1 overflow-hidden rounded-full bg-[var(--console-pill-bg)]">
                {CATEGORIES.map((category) => {
                  const val = agents[category] ?? 0;
                  if (val === 0) return null;
                  return (
                    <div
                      key={category}
                      className="h-full transition-all"
                      style={{
                        width: `${(val / agentTotal) * 100}%`,
                        backgroundColor: CATEGORY_STYLE[category].color,
                        opacity: 0.75,
                      }}
                      title={`${CATEGORY_STYLE[category].label}: ${val}`}
                    />
                  );
                })}
              </div>
              <span className="w-10 text-right tabular-nums text-studio-muted">{agentTotal}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
