'use client';

import type { GovernanceHealthSummary } from '@agent-studio/shared';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/utils/api-client';

interface GovernanceHealthResponse {
  projects: GovernanceHealthSummary[];
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  healthy: { bg: 'bg-conn-green-bg', text: 'text-conn-green-text', label: '正常' },
  stale: { bg: 'bg-yellow-50', text: 'text-yellow-700', label: '过期' },
  missing: { bg: 'bg-conn-red-bg', text: 'text-red-700', label: '缺失' },
  'never-synced': { bg: 'bg-studio-surface-elevated', text: 'text-studio-secondary', label: '未同步' },
};

export function HubGovernanceTab() {
  const [projects, setProjects] = useState<GovernanceHealthSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/governance/health');
      if (!res.ok) {
        setError('加载治理状态失败');
        return;
      }
      const data = (await res.json()) as GovernanceHealthResponse;
      const known = data.projects;

      // F070 P1-3: Discover historical external projects not yet in registry
      try {
        const threadsRes = await apiFetch('/api/threads');
        if (threadsRes.ok) {
          const { threads } = (await threadsRes.json()) as { threads: { projectPath?: string }[] };
          const externalPaths = [
            ...new Set(threads.map((t) => t.projectPath).filter((p): p is string => !!p && p !== 'default')),
          ];
          if (externalPaths.length > 0) {
            const discoverRes = await apiFetch('/api/governance/discover', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ projectPaths: externalPaths }),
            });
            if (discoverRes.ok) {
              const { unsynced } = (await discoverRes.json()) as { unsynced: string[] };
              const knownPaths = new Set(known.map((p) => p.projectPath));
              for (const path of unsynced) {
                if (!knownPaths.has(path)) {
                  known.push({
                    projectPath: path,
                    status: 'never-synced',
                    packVersion: null,
                    lastSyncedAt: null,
                    findings: [],
                  });
                }
              }
            }
          }
        }
      } catch {
        // Discovery is best-effort; don't block health display
      }

      setProjects(known);
    } catch {
      setError('网络错误');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]);

  const handleConfirm = useCallback(
    async (projectPath: string) => {
      setConfirming(projectPath);
      try {
        const res = await apiFetch('/api/governance/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectPath }),
        });
        if (res.ok) {
          await fetchHealth();
        } else {
          const data = (await res.json()) as { error?: string };
          setError(data.error ?? '同步失败');
        }
      } catch {
        setError('网络错误');
      } finally {
        setConfirming(null);
      }
    },
    [fetchHealth],
  );

  if (loading) {
    return <p className="text-sm text-studio-muted">加载治理状态中...</p>;
  }

  if (error) {
    return <p className="text-sm text-conn-red-text bg-conn-red-bg rounded-lg px-3 py-2">{error}</p>;
  }

  if (projects.length === 0) {
    return (
      <div className="text-center py-8 text-studio-muted">
        <p className="text-sm">暂无外部项目治理记录</p>
        <p className="text-xs mt-1">当Agent首次被派遣到外部项目时，治理规则会自动同步</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-studio-secondary">外部项目治理状态</h3>
        <button
          type="button"
          onClick={fetchHealth}
          className="rounded-lg bg-studio-accent px-3 py-1.5 text-xs font-semibold text-[var(--studio-surface)] transition-colors hover:bg-studio-accent-hover"
        >
          刷新
        </button>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-studio-surface-elevated text-left">
            <tr>
              <th className="px-3 py-2 font-medium text-studio-secondary">项目路径</th>
              <th className="px-3 py-2 font-medium text-studio-secondary">状态</th>
              <th className="px-3 py-2 font-medium text-studio-secondary">版本</th>
              <th className="px-3 py-2 font-medium text-studio-secondary">上次同步</th>
              <th className="px-3 py-2 font-medium text-studio-secondary">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-studio-border">
            {projects.map((p) => {
              const fallback = STATUS_STYLES['never-synced'];
              const style = STATUS_STYLES[p.status] ?? fallback;
              // display-only: always use forward slash regardless of OS
              const shortPath = p.projectPath.split(/[/\\]/).slice(-2).join('/');
              const syncDate = p.lastSyncedAt ? new Date(p.lastSyncedAt).toLocaleDateString('zh-CN') : '—';

              return (
                <tr key={p.projectPath} className="hover:bg-studio-surface-elevated">
                  <td className="px-3 py-2 font-mono text-xs" title={p.projectPath}>
                    {shortPath}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${style.bg} ${style.text}`}>
                      {style.label}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-studio-secondary">{p.packVersion ?? '—'}</td>
                  <td className="px-3 py-2 text-xs text-studio-secondary">{syncDate}</td>
                  <td className="px-3 py-2">
                    {(p.status === 'stale' || p.status === 'never-synced') && (
                      <button
                        type="button"
                        onClick={() => handleConfirm(p.projectPath)}
                        disabled={confirming === p.projectPath}
                        className="text-xs px-2 py-1 rounded-lg bg-studio-accent text-[var(--studio-surface)] hover:bg-studio-accent-hover disabled:opacity-50"
                      >
                        {confirming === p.projectPath ? '同步中...' : '立即同步'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
