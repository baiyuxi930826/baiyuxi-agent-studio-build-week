'use client';

import { useCallback, useEffect, useState } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { apiFetch } from '@/utils/api-client';

interface EvalDomainSummary {
  domainId: string;
  displayName: string;
  systemThreadId: string;
  frequency: string;
  evalAgentId: string;
  evalAgentHandle: string;
  /**
   * Sunset state. When false, domain.yaml has `enabled: false` — scheduled cron
   * skips it and `nextCronFireAt` is omitted. UI shows a "Sunset" indicator
   * instead of "下次评估" so operators don't see a misleading future fire time.
   */
  enabled: boolean;
  hasVerdict: boolean;
  latestVerdictId?: string;
  latestVerdict?: EvalHubItem['verdict'];
  /** Next cron fire time. Omitted when `enabled === false` (sunset). */
  nextCronFireAt?: string;
}

interface EvalHubSummary {
  counts: {
    total: number;
    actionable: number;
    keepObserve: number;
    stale: number;
    registeredDomains?: number;
  };
  domains?: EvalDomainSummary[];
  items: EvalHubItem[];
}

interface EvalHubItem {
  id: string;
  domainId: string;
  packetId: string;
  verdict: 'delete_sunset' | 'build' | 'fix' | 'keep_observe';
  phenomenon: string;
  ownerAsk: string;
  harnessUnderEval: {
    featureId: string;
    componentId: string;
    name: string;
  };
  reeval: {
    nextEvalAt?: string;
    status: 'observing' | 'pending_owner' | 'pending_reeval';
    summary: string;
  };
  lifecycle: {
    ownerResponseStatus: 'not_required' | 'not_started';
    closureStatus: 'observing' | 'open';
    stale: boolean;
  };
  evidence: {
    snapshotRefs: string[];
    attributionRefs: string[];
    metricRefs: string[];
    otherRefs: string[];
  };
  trend: {
    generatedAt: string;
    window: { durationHours: number };
    components: Array<{
      componentId: string;
      componentName: string;
      confidence: string;
      activationCounts: Record<string, number | null>;
      frictionCounts: Record<string, number | null>;
    }>;
  };
  systemWorkspace: {
    kind: 'eval_domain';
    id: string;
    label: string;
    threadId: string;
    stateSot: 'registry';
  };
  source: {
    verdictPath: string;
    bundleDir: string;
  };
}

export function HubEvalTab() {
  const [summary, setSummary] = useState<EvalHubSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSummary = useCallback(async () => {
    try {
      setError(null);
      const response = await apiFetch('/api/eval-hub/summary');
      if (!response.ok) {
        throw new Error(`Eval Hub summary failed (${response.status})`);
      }
      setSummary((await response.json()) as EvalHubSummary);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSummary();
  }, [fetchSummary]);

  if (loading) return <p className="text-sm text-studio-muted">...</p>;
  if (error) {
    return (
      <div className="rounded-lg bg-studio-surface-elevated p-4 text-sm text-conn-red-text" role="alert">
        Eval Hub 暂时不可用：{error}
      </div>
    );
  }
  if (!summary || (summary.items.length === 0 && (!summary.domains || summary.domains.length === 0))) {
    return (
      <div className="rounded-lg bg-studio-surface-elevated p-4 text-sm text-studio-secondary">
        还没有 live verdict。Eval Hub 只展示已经提交证据包的真实 eval 结论。
      </div>
    );
  }

  return (
    <div className="space-y-4" data-guide-id="observability.eval-panel">
      <p className="text-xs text-studio-muted">
        Harness Eval 控制面板：Agent定期评估自身协作机制的健康度，下方是最新评估结论。
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCell label="评估结论" sublabel="总数" value={summary.counts.total} />
        <StatCell label="需处理" sublabel="build/fix/delete" value={summary.counts.actionable} />
        <StatCell label="持续观察" sublabel="暂无异常" value={summary.counts.keepObserve} />
        <StatCell label="过期" sublabel="需重新评估" value={summary.counts.stale} />
      </div>

      {summary.domains && summary.domains.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-studio">评估域总览</h2>
          {summary.domains.map((domain) => (
            <DomainCard key={domain.domainId} domain={domain} onAgentUpdated={fetchSummary} />
          ))}
        </div>
      )}

      {summary.items.length > 0 && (
        <div className="space-y-3">
          {summary.items.map((item) => (
            <EvalVerdictCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function StatCell({ label, sublabel, value }: { label: string; sublabel?: string; value: number }) {
  return (
    <div className="rounded-lg bg-studio-surface-elevated px-4 py-3">
      <div className="text-xs text-studio-muted">{label}</div>
      {sublabel && <div className="text-micro text-studio-muted/60">{sublabel}</div>}
      <div className="mt-1 text-xl font-semibold text-studio">{value}</div>
    </div>
  );
}

function EvalVerdictCard({ item }: { item: EvalHubItem }) {
  const setWorkspaceOpenFile = useChatStore((state) => state.setWorkspaceOpenFile);
  const openWorkspaceFile = useCallback(
    (path: string) => {
      setWorkspaceOpenFile(path, null, null);
    },
    [setWorkspaceOpenFile],
  );

  return (
    <section className="rounded-lg bg-studio-surface-elevated p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wide text-studio-muted">{item.domainId}</div>
          <h3 className="mt-1 break-words text-base font-semibold text-studio">{item.id}</h3>
          <p className="mt-2 text-sm text-studio-secondary">{item.phenomenon}</p>
        </div>
        <StatusBadge verdict={item.verdict} stale={item.lifecycle.stale} />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <InfoBlock label="评估目标" value={`${item.harnessUnderEval.featureId}/${item.harnessUnderEval.componentId}`} />
        <InfoBlock label="组件名称" value={item.harnessUnderEval.name} />
        <InfoBlock label="需要的动作" value={item.ownerAsk} />
        <InfoBlock label="下次评估" value={formatReeval(item)} />
        <InfoBlock label="工作域" value={item.systemWorkspace.label} />
        <InfoBlock
          label="趋势窗口"
          value={`${item.trend.window.durationHours.toFixed(2)} 小时 · ${item.trend.components.length} 个组件`}
        />
      </div>

      <div className="mt-4 space-y-2">
        <div className="text-xs font-medium text-studio-muted">证据引用</div>
        <EvidenceList
          refs={[...item.evidence.snapshotRefs, ...item.evidence.attributionRefs, ...item.evidence.metricRefs]}
        />
      </div>

      <div className="mt-4 space-y-2">
        <div className="text-xs font-medium text-studio-muted">快捷导航</div>
        <div className="flex flex-wrap gap-2">
          <JumpButton onClick={() => openWorkspaceFile(item.source.verdictPath)}>结论文件</JumpButton>
          <JumpButton onClick={() => openWorkspaceFile(`${item.source.bundleDir}/snapshot.json`)}>快照包</JumpButton>
          <JumpButton onClick={() => openWorkspaceFile(`${item.source.bundleDir}/attribution.json`)}>归因包</JumpButton>
          <a
            href={`/thread/${encodeURIComponent(item.systemWorkspace.threadId)}`}
            className="rounded-md border border-studio px-3 py-1.5 text-xs font-medium text-studio-secondary hover:text-studio"
          >
            {item.systemWorkspace.label} 工作线程
          </a>
          <a
            href="/settings?ops=observability&obs=traces"
            className="rounded-md border border-studio px-3 py-1.5 text-xs font-medium text-studio-secondary hover:text-studio"
          >
            相关 Traces
          </a>
          {item.domainId === 'eval:memory' && (
            <a
              href="/memory/health"
              className="rounded-md border border-studio px-3 py-1.5 text-xs font-medium text-studio-secondary hover:text-studio"
            >
              记忆健康
            </a>
          )}
        </div>
      </div>
    </section>
  );
}

function DomainCard({ domain, onAgentUpdated }: { domain: EvalDomainSummary; onAgentUpdated?: () => void }) {
  const [editing, setEditing] = useState(false);
  const [agentId, setAgentId] = useState(domain.evalAgentId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [availableAgents, setAvailableAgents] = useState<Array<{ agentId: string; handle: string; family: string }>>(
    [],
  );

  const startEditing = useCallback(async () => {
    setEditing(true);
    try {
      const res = await apiFetch('/api/eval-hub/available-agents');
      if (res.ok) {
        const data = (await res.json()) as { agents: Array<{ agentId: string; handle: string; family: string }> };
        setAvailableAgents(data.agents);
      }
    } catch {
      /* best-effort roster load */
    }
  }, []);

  const handleSave = useCallback(async () => {
    if (!agentId.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/eval-domains/${encodeURIComponent(domain.domainId)}/eval-agent`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: agentId.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? `Save failed (${res.status})`);
      }
      setEditing(false);
      onAgentUpdated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [agentId, domain.domainId, onAgentUpdated]);

  return (
    <section className="rounded-lg bg-studio-surface-elevated p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wide text-studio-muted">{domain.domainId}</div>
          <h3 className="mt-1 text-base font-semibold text-studio">{domain.displayName}</h3>
          <p className="mt-1 text-xs text-studio-muted">
            评估频率: {domain.frequency} · 评估角色:{' '}
            {editing ? (
              <span className="inline-flex items-center gap-1">
                {availableAgents.length > 0 ? (
                  <select
                    value={agentId}
                    onChange={(e) => setAgentId(e.target.value)}
                    className="w-36 rounded border border-studio bg-studio-surface px-1.5 py-0.5 text-xs text-studio"
                  >
                    {availableAgents.map((agent) => (
                      <option key={agent.agentId} value={agent.agentId}>
                        {agent.handle} ({agent.family})
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={agentId}
                    onChange={(e) => setAgentId(e.target.value)}
                    className="w-28 rounded border border-studio bg-studio-surface px-1.5 py-0.5 text-xs text-studio"
                    placeholder="agentId"
                  />
                )}
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="rounded bg-[var(--console-button-emphasis)] px-2 py-0.5 text-xs text-white hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? '...' : '保存'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setAgentId(domain.evalAgentId);
                    setError(null);
                  }}
                  className="text-xs text-studio-muted hover:text-studio"
                >
                  取消
                </button>
              </span>
            ) : (
              <span>
                {domain.evalAgentHandle}{' '}
                <button
                  type="button"
                  onClick={startEditing}
                  className="text-xs text-studio-muted hover:text-studio"
                  title="编辑评估角色"
                >
                  ✏️
                </button>
              </span>
            )}
          </p>
          {error && <p className="mt-1 text-xs text-conn-red-text">{error}</p>}
          {(() => {
            const line = deriveDomainScheduleLine(domain);
            if (line.kind === 'sunset') {
              return (
                <p className="mt-0.5 text-xs text-studio-muted" title="Sunset — domain.yaml has enabled: false">
                  {line.text}
                </p>
              );
            }
            if (line.kind === 'next-eval') {
              return <p className="mt-0.5 text-xs text-studio-muted">{line.text}</p>;
            }
            return null;
          })()}
        </div>
        <span className="inline-flex shrink-0 rounded-md bg-studio-surface px-2.5 py-1 text-xs font-semibold text-[var(--console-button-emphasis)]">
          {deriveDomainStatusBadge(domain)}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <a
          href={`/thread/${encodeURIComponent(domain.systemThreadId)}`}
          className="rounded-md border border-studio px-3 py-1.5 text-xs font-medium text-studio-secondary hover:text-studio"
        >
          {domain.displayName} 工作线程
        </a>
        {domain.domainId === 'eval:memory' && (
          <a
            href="/memory/health"
            className="rounded-md border border-studio px-3 py-1.5 text-xs font-medium text-studio-secondary hover:text-studio"
          >
            记忆健康
          </a>
        )}
      </div>
    </section>
  );
}

export const VERDICT_LABELS: Record<EvalHubItem['verdict'] | 'stale', string> = {
  keep_observe: '持续观察',
  fix: '需修复',
  build: '需新建',
  delete_sunset: '可下线',
  stale: '已过期',
};

// ---- Sunset-rendering helpers (extracted for vitest unit coverage) ----
// Pattern follows evidence-search.test.ts: pull pure logic out of JSX so we
// can vitest it without bringing in @testing-library/react / jsdom. Closes
// gpt52 R2 residual test gap on sunset rendering branches.

export type DomainScheduleLine =
  | { kind: 'sunset'; text: string }
  | { kind: 'next-eval'; text: string }
  | { kind: 'none' };

/**
 * Decide the secondary line under the agent row in a domain card.
 * - Sunset (enabled=false): "🌙 Sunset · 自动调度已停" — never lie about a
 *   future cron fire (would mirror silent-fire on the operator surface).
 * - Active + has nextCronFireAt: "下次评估: <locale string>".
 * - Active + no nextCronFireAt: nothing (kind=none).
 */
export function deriveDomainScheduleLine(domain: { enabled: boolean; nextCronFireAt?: string }): DomainScheduleLine {
  if (domain.enabled === false) {
    return { kind: 'sunset', text: '🌙 Sunset · 自动调度已停 (yaml: enabled: false)' };
  }
  if (domain.nextCronFireAt) {
    return {
      kind: 'next-eval',
      text: `下次评估: ${new Date(domain.nextCronFireAt).toLocaleString()}`,
    };
  }
  return { kind: 'none' };
}

/**
 * Decide the verdict-status badge text in a domain card.
 * Sunset wins over verdict label / "待首次评估" — operators must see the
 * domain is paused, not a stale verdict status.
 */
export function deriveDomainStatusBadge(domain: {
  enabled: boolean;
  hasVerdict: boolean;
  latestVerdict?: EvalHubItem['verdict'];
}): string {
  if (domain.enabled === false) return 'Sunset';
  if (domain.hasVerdict && domain.latestVerdict) {
    return VERDICT_LABELS[domain.latestVerdict];
  }
  return '待首次评估';
}

function StatusBadge({ verdict, stale }: { verdict: EvalHubItem['verdict']; stale: boolean }) {
  const key = stale ? 'stale' : verdict;
  return (
    <span className="inline-flex shrink-0 rounded-md bg-studio-surface px-2.5 py-1 text-xs font-semibold text-[var(--console-button-emphasis)]">
      {VERDICT_LABELS[key]}
    </span>
  );
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-studio-muted">{label}</div>
      <div className="mt-0.5 break-words text-sm text-studio">{value}</div>
    </div>
  );
}

function EvidenceList({ refs }: { refs: string[] }) {
  return (
    <ul className="space-y-1">
      {refs.map((ref) => (
        <li
          key={ref}
          className="break-all rounded-md bg-studio-surface px-2 py-1 font-mono text-xs text-studio-secondary"
        >
          {ref}
        </li>
      ))}
    </ul>
  );
}

function JumpButton({ children, onClick }: { children: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-studio px-3 py-1.5 text-xs font-medium text-studio-secondary hover:text-studio"
    >
      {children}
    </button>
  );
}

function formatReeval(item: EvalHubItem): string {
  if (item.reeval.nextEvalAt) {
    return `${item.reeval.status} · ${new Date(item.reeval.nextEvalAt).toLocaleString()}`;
  }
  return `${item.reeval.status} · ${item.reeval.summary}`;
}
