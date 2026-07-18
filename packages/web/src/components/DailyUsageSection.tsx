'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { type AgentData, useAgentData } from '@/hooks/useAgentData';
import { apiFetch } from '@/utils/api-client';

interface AgentDailyUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  participations: number;
}

interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  invocations: number;
}

interface DailyUsageEntry {
  date: string;
  agents: Record<string, AgentDailyUsage>;
  total: UsageTotals;
}

interface DailyUsageReport {
  period: { from: string; to: string };
  daily: DailyUsageEntry[];
  grandTotal: UsageTotals;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/**
 * Issue #845: derive label from runtime agentRegistry (via useAgentData) instead of a
 * hardcoded table. Prefers "{roleDisplayName} {variantLabel}" (e.g. "Ethan（任务主控与实现） 4.6"),
 * falls back to displayName, then raw agentId. Avoids the previous drift where
 * `gpt52` was labeled "GPT-5.4" but actually ran `gpt-5.5`.
 */
export function buildAgentLabel(agentId: string, agent: AgentData | undefined): string {
  if (!agent) return agentId;
  if (agent.roleDisplayName && agent.variantLabel) {
    return `${agent.roleDisplayName} ${agent.variantLabel}`;
  }
  return agent.displayName ?? agentId;
}

export function DailyUsageSection() {
  const { agents: agentRegistry } = useAgentData();
  const [report, setReport] = useState<DailyUsageReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const agentById = useMemo(() => {
    const map = new Map<string, AgentData>();
    for (const agent of agentRegistry) map.set(agent.id, agent);
    return map;
  }, [agentRegistry]);

  const fetchUsage = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const url = refresh ? '/api/usage/daily?days=7&refresh=1' : '/api/usage/daily?days=7';
      const res = await apiFetch(url);
      if (res.ok) {
        setReport((await res.json()) as DailyUsageReport);
      } else {
        setError(`获取失败 (${res.status})`);
      }
    } catch {
      setError('无法连接到服务器');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsage();
  }, [fetchUsage]);

  const days = report?.daily ?? [];
  const grandTotal = report?.grandTotal;

  // Issue #845: clarify "次调用" vs sum of per-agent participations.
  // Multi-agent invocations count once toward day.total.invocations, but each
  // agent participation increments its own count — so per-agent counts can sum
  // to more than the day total. Show the math in a tooltip rather than hiding it.
  const invocationCountTitle =
    '次调用 = 当日 invocation 记录数；下方每个角色的次数是各自参与次数。多角色调用让各角色之和 ≥ 总次数。';

  return (
    <section className="console-list-card rounded-xl shadow-[0_8px_22px_rgba(43,33,26,0.04)] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-studio">近 7 日配额消耗</h3>
        <button
          type="button"
          onClick={() => fetchUsage(true)}
          disabled={loading}
          className="rounded-lg bg-studio-accent px-3 py-1.5 text-xs font-semibold text-[var(--studio-surface)] transition-colors hover:bg-studio-accent-hover disabled:opacity-50"
        >
          {loading ? '加载中...' : '刷新'}
        </button>
      </div>

      {error && <div className="text-xs text-conn-red-text bg-conn-red-bg rounded px-2 py-1">{error}</div>}

      {!error && days.length === 0 && !loading && <div className="text-xs text-studio-muted py-2">暂无消耗记录</div>}

      {days.map((day) => {
        const agents = Object.entries(day.agents).sort(
          (a, b) => b[1].inputTokens + b[1].outputTokens - (a[1].inputTokens + a[1].outputTokens),
        );
        return (
          <div key={day.date} className="border-t border-studio-subtle pt-2 space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-studio-secondary">{day.date}</span>
              <span className="text-studio-muted cursor-help" title={invocationCountTitle}>
                {day.total.invocations} 次调用
              </span>
            </div>
            {agents.map(([agentId, usage]) => (
              <AgentUsageRow key={agentId} agentId={agentId} usage={usage} agent={agentById.get(agentId)} />
            ))}
          </div>
        );
      })}

      {grandTotal && grandTotal.invocations > 0 && (
        <div className="border-t-2 border-studio pt-2 flex items-center justify-between text-xs text-studio-secondary">
          <span className="font-semibold text-studio-secondary cursor-help" title={invocationCountTitle}>
            7 日合计 {grandTotal.invocations} 次
          </span>
          <span className="flex gap-3">
            <span className="font-semibold text-studio-secondary">
              总 {formatTokens(grandTotal.inputTokens + grandTotal.outputTokens)}
            </span>
            <span>入 {formatTokens(grandTotal.inputTokens)}</span>
            <span>出 {formatTokens(grandTotal.outputTokens)}</span>
            {grandTotal.costUsd > 0 && (
              <span className="text-conn-amber-text font-semibold">${grandTotal.costUsd.toFixed(2)}</span>
            )}
          </span>
        </div>
      )}
    </section>
  );
}

function AgentUsageRow({
  agentId,
  usage,
  agent,
}: {
  agentId: string;
  usage: AgentDailyUsage;
  agent: AgentData | undefined;
}) {
  const label = buildAgentLabel(agentId, agent);
  // Issue #845 (砚砚 P2 fix): show the agentId's *current* defaultModel as a hint,
  // NOT as a historical attribution. The aggregated TokenUsage has no per-record
  // model field — a single agentId may have run multiple model versions over time.
  // The "当前默认" prefix + tooltip keep the semantics explicit so the user never
  // mistakes the inline label for a per-day model. A follow-up issue tracks the
  // proper (agentId, model) double-key schema.
  const model = agent?.defaultModel;
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <div className="flex items-center gap-2 min-w-0">
        <span className="font-medium text-studio-secondary truncate">{label}</span>
        {model && (
          <span
            className="text-studio-muted text-micro truncate italic"
            title={`${agentId} 当前默认模型：${model}。历史聚合按 agentId 分桶，不区分模型版本。`}
          >
            当前默认 {model}
          </span>
        )}
        <span className="text-studio-muted">{usage.participations}次</span>
      </div>
      <div className="flex items-center gap-3 text-studio-secondary shrink-0">
        <span title="输入 tokens">入 {formatTokens(usage.inputTokens)}</span>
        <span title="输出 tokens">出 {formatTokens(usage.outputTokens)}</span>
      </div>
    </div>
  );
}
