'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatAgentName, useAgentData } from '@/hooks/useAgentData';
import { agentColorVar } from '@/lib/agent-slug';
import type { AgentInvocationInfo } from '@/stores/chatStore';
import { useChatStore } from '@/stores/chatStore';
import { apiFetch } from '@/utils/api-client';
import { AgentTokenUsage } from './AgentTokenUsage';
import { AuditExplorerPanel } from './audit/AuditExplorerPanel';
import { PlanBoardPanel } from './PlanBoardPanel';
import { SessionChainPanel } from './SessionChainPanel';
import { settingsResourceCardClass } from './SettingsResourceCard';
import {
  type AgentStatus,
  collectSnapshotActiveAgents,
  deriveActiveAgents,
  type IntentMode,
  modeLabel,
  statusLabel,
  statusTone,
} from './status-helpers';
import { AgentInvocationTime, CollapsibleIds } from './status-panel-parts';

export interface RightStatusPanelProps {
  intentMode: IntentMode;
  targetAgents: string[];
  agentStatuses: Record<string, AgentStatus>;
  agentInvocations: Record<string, AgentInvocationInfo>;
  activeInvocations?: Record<string, { agentId: string; mode: string; startedAt?: number }>;
  hasActiveInvocation?: boolean;
  threadId: string;
  messageSummary: {
    total: number;
    assistant: number;
    system: number;
    evidence: number;
    followup: number;
  };
  /** Panel width in px (baiyuxi-agent-studio#28: drag-to-resize). Falls back to 304. */
  width?: number;
  /** Allow tests to render history section expanded (SSR default: collapsed). */
  initialHistoryOpen?: boolean;
}

/* ── Agent invocation card (shared between active/history) ──── */
function AgentInvocationCard({
  agentId,
  inv,
  onCopy,
  isActive,
}: {
  agentId: string;
  inv: AgentInvocationInfo;
  onCopy: (v: string) => void;
  isActive: boolean;
}) {
  const { getAgentById } = useAgentData();
  const agent = getAgentById(agentId);
  const dotColor = agentColorVar(agent?.id, 'primary');
  return (
    <div className="text-xs">
      <div className="flex items-center gap-1.5 mb-1 min-w-0">
        <span
          className={`shrink-0 inline-block h-2.5 w-2.5 rounded-full ${isActive ? 'animate-pulse' : ''}`}
          style={{ backgroundColor: dotColor }}
        />
        <span className="truncate min-w-0 font-medium text-studio-secondary">
          {agent ? formatAgentName(agent) : agentId}
        </span>
        {inv.sessionSeq !== undefined && (
          <span
            className={`shrink-0 text-micro px-1 py-0.5 rounded ${
              inv.sessionSealed
                ? 'bg-conn-amber-bg text-conn-amber-text'
                : 'bg-studio-surface-elevated text-studio-secondary'
            }`}
            title={inv.sessionSealed ? `会话 #${inv.sessionSeq} 已封存` : `会话 #${inv.sessionSeq}`}
          >
            S#{inv.sessionSeq}
            {inv.sessionSealed ? ' sealed' : ''}
          </span>
        )}
        <AgentInvocationTime invocation={inv} />
      </div>
      {inv.usage && (
        <div className="ml-3.5">
          <AgentTokenUsage agentId={agentId} usage={inv.usage} contextHealth={inv.contextHealth} />
        </div>
      )}
      {(inv.sessionId || inv.invocationId) && (
        <CollapsibleIds sessionId={inv.sessionId} invocationId={inv.invocationId} onCopy={onCopy} />
      )}
    </div>
  );
}

/** Toggle between play/debug thinking visibility mode for the thread */
function ThinkingModeToggle({ threadId }: { threadId: string }) {
  const thread = useChatStore((s) => s.threads.find((t) => t.id === threadId));
  const updateLocal = useChatStore((s) => s.updateThreadThinkingMode);
  const mode = thread?.thinkingMode ?? 'debug';
  const isDebug = mode === 'debug';
  const pendingRef = useRef(false);

  const toggle = useCallback(async () => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    const next = isDebug ? 'play' : 'debug';
    updateLocal(threadId, next);
    try {
      const res = await apiFetch(`/api/threads/${threadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thinkingMode: next }),
      });
      if (!res.ok) {
        updateLocal(threadId, mode);
      }
    } catch {
      // Revert on network failure
      updateLocal(threadId, mode);
    } finally {
      pendingRef.current = false;
    }
  }, [threadId, isDebug, mode, updateLocal]);

  return (
    <div className="flex items-center justify-between gap-2 min-w-0">
      <span className="truncate min-w-0">
        心里话: <span className="font-medium">{isDebug ? '调试' : '游戏'}</span>
      </span>
      <button
        onClick={toggle}
        className="shrink-0 rounded-full px-3 py-1 text-label transition-colors hover:text-studio"
        title={isDebug ? '切换到游戏模式（Agent互相看不到心里话）' : '切换到调试模式（Agent互相分享心里话）'}
      >
        {isDebug ? '切换游戏' : '切换调试'}
      </button>
    </div>
  );
}

const BUBBLE_LABELS: Record<string, string> = {
  global: '跟随全局',
  expanded: '展开',
  collapsed: '折叠',
};
const BUBBLE_CYCLE: Record<string, 'expanded' | 'collapsed' | 'global'> = {
  global: 'expanded',
  expanded: 'collapsed',
  collapsed: 'global',
};

/** Thread-level bubble display override (three-state: global / expanded / collapsed) */
function BubbleDisplayToggle({
  threadId,
  label,
  field,
}: {
  threadId: string;
  label: string;
  field: 'bubbleThinking' | 'bubbleCli';
}) {
  const thread = useChatStore((s) => s.threads.find((t) => t.id === threadId));
  const isLoadingThreads = useChatStore((s) => s.isLoadingThreads);
  const updateLocal = useChatStore((s) => s.updateThreadBubbleDisplay);
  const globalBubbleDefaults = useChatStore((s) => s.globalBubbleDefaults);
  const bubbleRestorePending = isLoadingThreads && !thread;
  const current = thread?.[field] ?? 'global';
  const currentEffective =
    current === 'global'
      ? field === 'bubbleThinking'
        ? globalBubbleDefaults.thinking
        : globalBubbleDefaults.cliOutput
      : current;
  const next = bubbleRestorePending
    ? null
    : current === 'global'
      ? currentEffective === 'expanded'
        ? 'collapsed'
        : 'expanded'
      : BUBBLE_CYCLE[current];
  const currentLabel = bubbleRestorePending
    ? '恢复中'
    : current === 'global'
      ? `${BUBBLE_LABELS.global}（当前${BUBBLE_LABELS[currentEffective]}）`
      : BUBBLE_LABELS[current];
  const pendingRef = useRef(false);

  const cycle = useCallback(async () => {
    if (pendingRef.current || bubbleRestorePending || !next) return;
    pendingRef.current = true;
    updateLocal(threadId, field, next);
    try {
      const res = await apiFetch(`/api/threads/${threadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: next }),
      });
      if (!res.ok) updateLocal(threadId, field, current);
    } catch {
      updateLocal(threadId, field, current);
    } finally {
      pendingRef.current = false;
    }
  }, [threadId, field, next, current, updateLocal, bubbleRestorePending]);

  return (
    <div className="flex items-center justify-between gap-2 min-w-0">
      <span className="truncate min-w-0">
        {label}: <span className="font-medium">{currentLabel}</span>
      </span>
      <button
        onClick={cycle}
        disabled={bubbleRestorePending}
        className="shrink-0 rounded-full px-3 py-1 text-label transition-colors hover:text-studio"
      >
        {bubbleRestorePending ? '恢复中...' : BUBBLE_LABELS[next as keyof typeof BUBBLE_LABELS]}
      </button>
    </div>
  );
}

/** F35: Reveal all whispers in the thread (game-end reveal) */
function RevealWhispersButton({ threadId }: { threadId: string }) {
  const [status, setStatus] = useState<'idle' | 'pending' | 'done'>('idle');
  const [revealedCount, setRevealedCount] = useState<number | null>(null);

  // Reset state when switching threads
  useEffect(() => {
    setStatus('idle');
    setRevealedCount(null);
  }, []);

  const handleReveal = useCallback(async () => {
    if (status === 'pending') return;
    setStatus('pending');
    // Capture cutoff before PATCH so whispers arriving mid-flight aren't falsely marked
    const revealCutoff = Date.now();
    try {
      const res = await apiFetch(`/api/threads/${threadId}/reveal`, {
        method: 'PATCH',
      });
      if (res.ok) {
        const data = await res.json();
        const count = data.revealed ?? 0;
        setRevealedCount(count);
        setStatus('done');
        // Update local chat store so whisper bubbles re-render as revealed
        if (count > 0) {
          useChatStore.setState((state) => ({
            messages: state.messages.map((m) =>
              m.visibility === 'whisper' && !m.revealedAt && (m.timestamp ?? 0) <= revealCutoff
                ? { ...m, revealedAt: revealCutoff }
                : m,
            ),
          }));
        }
        // Reset to idle after a delay so new whispers can be revealed later
        setTimeout(() => setStatus('idle'), 3000);
      } else {
        setStatus('idle');
      }
    } catch {
      setStatus('idle');
    }
  }, [threadId, status]);

  return (
    <div className="flex items-center justify-between gap-2 min-w-0">
      <span className="shrink-0">悄悄话:</span>
      {status === 'done' ? (
        <span className="shrink-0 text-label text-conn-emerald-text">已揭秘 {revealedCount} 条</span>
      ) : (
        <button
          onClick={handleReveal}
          disabled={status === 'pending'}
          className="shrink-0 rounded-full px-3 py-1 text-label text-conn-amber-text transition-colors hover:opacity-90 disabled:opacity-50"
          title="揭晓本线程所有悄悄话"
        >
          {status === 'pending' ? '揭秘中...' : '揭秘全部'}
        </button>
      )}
    </div>
  );
}

const LOGS_DIR = 'packages/api/data/logs/api';
const SIDEBAR_CARD = settingsResourceCardClass;

function parseLogFilename(name: string): { date: string; seq: number } | null {
  const m = name.match(/^api\.(\d{4}-\d{2}-\d{2})\.(\d+)\.log$/);
  if (!m) return null;
  return { date: m[1], seq: Number(m[2]) };
}

function RuntimeLogsButton() {
  const setRevealPath = useChatStore((s) => s.setWorkspaceRevealPath);
  const setOpenFile = useChatStore((s) => s.setWorkspaceOpenFile);

  const handleClick = useCallback(async () => {
    // Capture the originating thread BEFORE any awaits so that
    // workspace stamps attribute actions to the correct thread
    // even if the user switches threads during the async gap.
    const originThreadId = useChatStore.getState().currentThreadId;
    setRevealPath(LOGS_DIR, originThreadId);

    try {
      const wtRes = await apiFetch('/api/workspace/worktrees');
      if (!wtRes.ok) return;
      if (useChatStore.getState().currentThreadId !== originThreadId) return;
      const wtData = await wtRes.json();
      const wId = (wtData.worktrees ?? [])[0]?.id;
      if (!wId) return;

      const params = new URLSearchParams({ worktreeId: wId, path: LOGS_DIR, depth: '1' });
      const res = await apiFetch(`/api/workspace/tree?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      if (useChatStore.getState().currentThreadId !== originThreadId) return;
      const entries: { name: string; type: string }[] = Array.isArray(data.tree)
        ? data.tree
        : (data.tree?.children ?? []);
      const logFiles = entries
        .filter((f: { name: string; type: string }) => f.type === 'file' && f.name.endsWith('.log'))
        .map((f: { name: string }) => ({ name: f.name, parsed: parseLogFilename(f.name) }))
        .filter((f): f is { name: string; parsed: { date: string; seq: number } } => f.parsed !== null)
        .sort((a, b) => {
          const dc = b.parsed.date.localeCompare(a.parsed.date);
          return dc !== 0 ? dc : b.parsed.seq - a.parsed.seq;
        });
      if (logFiles.length > 0) {
        setOpenFile(`${LOGS_DIR}/${logFiles[0].name}`, null, wId, originThreadId);
      }
    } catch {
      // Directory revealed; file open is best-effort
    }
  }, [setRevealPath, setOpenFile]);

  return (
    <section className={`${SIDEBAR_CARD} flex items-center justify-between px-3 py-2`}>
      <h3 className="text-label font-bold text-studio">运行日志</h3>
      <button
        onClick={handleClick}
        className="text-label font-bold text-studio transition-colors hover:text-studio"
        title="在 Workspace 面板中打开运行日志目录"
      >
        查看日志
      </button>
    </section>
  );
}

export function RightStatusPanel({
  intentMode,
  targetAgents,
  agentStatuses,
  agentInvocations,
  activeInvocations,
  hasActiveInvocation,
  threadId,
  messageSummary,
  width,
  initialHistoryOpen = false,
}: RightStatusPanelProps) {
  // F26: Split into active (working now) vs history (appeared before)
  // review-#784 P2 + AC-Z15: pass intentMode so deriveActiveAgents preserves the
  // full targetAgents union during ideate rounds (matches ParallelStatusBar /
  // MobileStatusSheet behavior; without this, finished-agent slots get demoted
  // to history while the round is still running).
  const { activeAgents, historyAgents } = useMemo(() => {
    const snapshotAgents = collectSnapshotActiveAgents(agentInvocations);
    const active = deriveActiveAgents({
      targetAgents,
      snapshotAgents,
      activeInvocations,
      hasActiveInvocation,
      intentMode,
    });
    const allParticipants = new Set([...active, ...Object.keys(agentInvocations)]);
    const history = [...allParticipants].filter((c) => !active.includes(c));
    return { activeAgents: active, historyAgents: history };
  }, [targetAgents, agentInvocations, activeInvocations, hasActiveInvocation, intentMode]);

  const { getAgentById } = useAgentData();
  const [historyOpen, setHistoryOpen] = useState(initialHistoryOpen);
  const [viewSession, setViewSession] = useState<{ id: string; agentId?: string } | null>(null);

  // Clear session viewer when switching threads
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally reset on threadId change only
  React.useEffect(() => {
    setViewSession(null);
  }, [threadId]);

  const copyText = useCallback((value: string) => {
    void navigator.clipboard.writeText(value);
  }, []);

  return (
    <aside
      className="hidden lg:flex flex-col gap-3 overflow-y-auto px-4 py-[18px]"
      data-console-panel="status"
      style={{
        width: width ?? 304,
        flexShrink: 0,
        background: 'var(--console-shell-bg)',
      }}
    >
      <div className="px-0.5 pb-1">
        <p className="text-sm font-bold text-studio">状态栏</p>
        <span className="text-micro text-studio-secondary">当前模式：{modeLabel(intentMode)}</span>
      </div>

      <section className={`${SIDEBAR_CARD} p-2.5`}>
        <h3 className="text-label font-bold text-studio mb-2">角色状态</h3>
        <div className="space-y-2">
          {activeAgents.length > 0 ? (
            activeAgents.map((agentId) => {
              const agent = getAgentById(agentId);
              const dotColor = agentColorVar(agent?.id, 'primary');
              const status = agentStatuses[agentId] ?? 'pending';
              const inv = agentInvocations[agentId];
              return (
                <div key={agentId} className="console-list-card rounded-xl p-2">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: dotColor }} />
                      <span className="text-xs text-studio-secondary">{agent ? formatAgentName(agent) : agentId}</span>
                    </div>
                    <span className={`text-xs font-medium ${statusTone(status)}`}>{statusLabel(status)}</span>
                  </div>
                  {inv && <AgentInvocationCard agentId={agentId} inv={inv} onCopy={copyText} isActive />}
                </div>
              );
            })
          ) : (
            <div className="text-label text-studio-muted">空闲</div>
          )}
        </div>
      </section>

      {historyAgents.length > 0 && (
        <section className={`${SIDEBAR_CARD} p-2.5`}>
          <button
            onClick={() => setHistoryOpen((v) => !v)}
            className="w-full flex items-center justify-between text-label font-bold text-studio hover:text-studio"
          >
            <span>历史参与 ({historyAgents.length})</span>
            <svg
              className={`w-3 h-3 transition-transform ${historyOpen ? 'rotate-180' : ''}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          {historyOpen && (
            <div className="p-2.5 space-y-2">
              {historyAgents.map((agentId) => {
                const inv = agentInvocations[agentId];
                if (!inv) {
                  const agent = getAgentById(agentId);
                  return (
                    <div key={agentId} className="flex items-center gap-2 text-xs text-studio-muted">
                      <span
                        className="inline-block h-2 w-2 rounded-full opacity-50"
                        style={{ backgroundColor: agentColorVar(agent?.id, 'primary') }}
                      />
                      {agent ? formatAgentName(agent) : agentId}
                    </div>
                  );
                }
                return (
                  <AgentInvocationCard key={agentId} agentId={agentId} inv={inv} onCopy={copyText} isActive={false} />
                );
              })}
            </div>
          )}
        </section>
      )}

      <section className={`${SIDEBAR_CARD} p-2.5`}>
        <h3 className="text-label font-bold text-studio mb-2">消息统计</h3>
        <div className="console-list-card rounded-xl p-2.5 text-label text-studio-secondary space-y-1">
          <div>
            总数 {messageSummary.total} Agent 消息 {messageSummary.assistant}
          </div>
          <div>
            系统消息 {messageSummary.system} Evidence {messageSummary.evidence}
          </div>
          <div>Follow-up {messageSummary.followup}</div>
        </div>
      </section>

      <PlanBoardPanel threadId={threadId} agentInvocations={agentInvocations} />

      <SessionChainPanel
        threadId={threadId}
        agentInvocations={agentInvocations}
        onViewSession={(id, agentId) => setViewSession({ id, agentId })}
      />

      <section className={`${SIDEBAR_CARD} p-2.5`}>
        <h3 className="text-label font-bold text-studio mb-2">对话信息</h3>
        <div className="console-list-card rounded-xl p-2.5 text-label text-studio-secondary space-y-1.5">
          <div className="flex items-baseline gap-1 min-w-0">
            <span className="shrink-0">Thread:</span>
            <button
              className="truncate min-w-0 text-studio-secondary font-mono hover:text-studio cursor-pointer transition-colors"
              title={`点击复制: ${threadId}`}
              onClick={() => copyText(threadId)}
            >
              {threadId}
            </button>
          </div>
          <BubbleDisplayToggle threadId={threadId} label="Thinking" field="bubbleThinking" />
          <BubbleDisplayToggle threadId={threadId} label="CLI 气泡" field="bubbleCli" />
          <ThinkingModeToggle threadId={threadId} />
          <RevealWhispersButton threadId={threadId} />
        </div>
      </section>

      <AuditExplorerPanel
        key={threadId}
        threadId={threadId}
        externalSessionId={viewSession?.id ?? null}
        externalSessionAgentId={viewSession?.agentId}
        onCloseSession={() => setViewSession(null)}
      />

      <RuntimeLogsButton />
    </aside>
  );
}
