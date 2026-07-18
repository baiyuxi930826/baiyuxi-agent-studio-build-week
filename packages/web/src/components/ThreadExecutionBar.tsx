'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatAgentName, useAgentData } from '@/hooks/useAgentData';
import { useThreadLiveness } from '@/hooks/useThreadScopedSelectors';
import { agentColorVar } from '@/lib/agent-slug';
import type { AgentInvocationInfo } from '@/stores/chat-types';
import { useChatStore } from '@/stores/chatStore';
import { useToastStore } from '@/stores/toastStore';
import { apiFetch } from '@/utils/api-client';
import { ForceResetDialog } from './ForceResetDialog';
import { deriveActiveAgents } from './status-helpers';

type ActiveInvocationSlots = Record<string, { agentId: string; mode: string; startedAt?: number }>;

interface ThreadExecutionBarProps {
  threadId?: string;
}

/** F122B AC-B8+B9: Per-agent execution status bar with stop controls.
 *  B8/B9 polish: agent names use formatAgentName() — "品种（variant）" format, colors from agent-config. */
export function ThreadExecutionBar({ threadId }: ThreadExecutionBarProps) {
  const currentThreadId = useChatStore((s) => s.currentThreadId);
  const effectiveThreadId = threadId ?? currentThreadId;
  const {
    activeInvocations,
    agentInvocations,
    agentStatuses,
    hasActive: hasActiveInvocation,
    intentMode,
    targetAgents,
  } = useThreadLiveness(effectiveThreadId);
  const { getAgentById } = useAgentData();
  const [, setTick] = useState(0);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  const activeAgents = deriveActiveAgents({
    targetAgents,
    activeInvocations,
    hasActiveInvocation,
    intentMode,
  }).map((agentId) => ({ agentId, startedAt: getStartedAt(agentId, activeInvocations, agentInvocations) }));

  // Build display info from agent-config (dynamic, not hardcoded)
  const agentDisplayMap = useMemo(() => {
    const map = new Map<string, { label: string; color: string }>();
    for (const { agentId } of activeAgents) {
      const agent = getAgentById(agentId);
      if (agent) {
        map.set(agentId, {
          label: formatAgentName(agent),
          color: agentColorVar(agent.id, 'primary'),
        });
      } else {
        map.set(agentId, { label: agentId, color: 'var(--studio-accent)' });
      }
    }
    return map;
  }, [activeAgents, getAgentById]);

  // Auto-update elapsed time every second when agents are active
  useEffect(() => {
    if (activeAgents.length === 0) return;
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [activeAgents.length]);

  const handleStopAgent = useCallback(
    async (agentId: string) => {
      if (!effectiveThreadId) return;
      await apiFetch(`/api/threads/${effectiveThreadId}/cancel/${agentId}`, { method: 'POST' });
    },
    [effectiveThreadId],
  );

  const handleStopAll = useCallback(async () => {
    if (!effectiveThreadId) return;
    await Promise.all(activeAgents.map(({ agentId }) => handleStopAgent(agentId)));
  }, [effectiveThreadId, activeAgents, handleStopAgent]);

  // F220 Phase 3: 升级态判定 — 任一活跃角色疑似卡死（liveness warning）→ 入口上浮变醒目。
  const stalled = activeAgents.some(({ agentId }) => {
    const s = agentStatuses[agentId];
    return s === 'suspected_stall' || s === 'alive_but_silent';
  });

  // F220 Phase 3: 确认后调 force-reset 端点（只清运行态，LL-048 不碰持久化）→ toast → 关弹窗。
  const handleForceReset = useCallback(async () => {
    if (!effectiveThreadId) return;
    setResetting(true);
    try {
      await apiFetch(`/api/threads/${effectiveThreadId}/force-reset`, { method: 'POST' });
      useToastStore.getState().addToast({
        type: 'success',
        title: '已重置',
        message: '对话已解放，可以发新消息了',
        duration: 4000,
      });
      setResetDialogOpen(false);
    } finally {
      setResetting(false);
    }
  }, [effectiveThreadId]);

  if (activeAgents.length === 0) return null;

  return (
    <div className="console-divider-b">
      <div className="flex items-center gap-2 px-4 py-1.5 text-xs">
        <span className="text-studio-muted font-medium shrink-0">执行中</span>
        {activeAgents.map(({ agentId, startedAt }) => {
          const info = agentDisplayMap.get(agentId) ?? { label: agentId, color: 'var(--studio-accent)' };
          return (
            <AgentStatusChip
              key={agentId}
              agentId={agentId}
              label={info.label}
              color={info.color}
              startedAt={startedAt}
              onStop={handleStopAgent}
            />
          );
        })}
        {activeAgents.length > 1 && (
          <button
            type="button"
            onClick={handleStopAll}
            className="ml-auto text-xs text-studio-muted hover:text-conn-red-text transition-colors shrink-0"
          >
            全部停止
          </button>
        )}
      </div>
      <ForceResetEntry escalated={stalled} onClick={() => setResetDialogOpen(true)} />
      <ForceResetDialog
        open={resetDialogOpen}
        busy={resetting}
        onCancel={() => setResetDialogOpen(false)}
        onConfirm={handleForceReset}
      />
    </div>
  );
}

function TriangleAlertIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

/** F220 Phase 3: force-reset 入口。默认低调（dashed-top + 灰 + 小，藏面板底）；
 *  escalated（疑似卡死）时上浮变醒目（critical-surface 底 + 警告色）。 */
function ForceResetEntry({ escalated, onClick }: { escalated: boolean; onClick: () => void }) {
  if (escalated) {
    return (
      <div className="px-4 pb-1.5">
        <button
          type="button"
          data-testid="force-reset-entry"
          data-escalated="true"
          onClick={onClick}
          className="w-full flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-opacity hover:opacity-90"
          style={{
            backgroundColor: 'var(--semantic-critical-surface)',
            color: 'var(--semantic-critical)',
            border: '1px solid color-mix(in srgb, var(--semantic-critical) 30%, transparent)',
          }}
        >
          <TriangleAlertIcon className="w-3.5 h-3.5" />
          卡住了？强制重置
        </button>
      </div>
    );
  }
  return (
    <div className="px-4 pb-1.5">
      <button
        type="button"
        data-testid="force-reset-entry"
        data-escalated="false"
        onClick={onClick}
        className="flex items-center gap-1.5 w-full pt-1.5 border-t border-dashed border-studio text-xs text-studio-muted hover:text-studio-secondary transition-colors"
      >
        <TriangleAlertIcon className="w-3 h-3 opacity-70" />
        卡住了？强制重置
      </button>
    </div>
  );
}

function getStartedAt(
  agentId: string,
  activeInvocations: ActiveInvocationSlots,
  agentInvocations: Record<string, AgentInvocationInfo>,
) {
  const slot = Object.values(activeInvocations).find((inv) => inv.agentId === agentId);
  if (typeof slot?.startedAt === 'number') return slot.startedAt;

  const invocationStartedAt = agentInvocations[agentId]?.startedAt;
  if (typeof invocationStartedAt === 'number') return invocationStartedAt;

  return Date.now();
}

function AgentStatusChip({
  agentId,
  label,
  color,
  startedAt,
  onStop,
}: {
  agentId: string;
  label: string;
  color: string;
  startedAt: number;
  onStop: (agentId: string) => void;
}) {
  const elapsed = Math.floor((Date.now() - startedAt) / 1000);
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

  return (
    <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-studio-surface/50">
      <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: color }} />
      <span className="text-studio-secondary font-medium">{label}</span>
      <span className="text-studio-muted tabular-nums">{timeStr}</span>
      <button
        type="button"
        onClick={() => onStop(agentId)}
        className="ml-0.5 text-studio-muted hover:text-conn-red-text transition-colors"
        aria-label={`Stop ${agentId}`}
      >
        <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path
            fillRule="evenodd"
            d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
            clipRule="evenodd"
          />
        </svg>
      </button>
    </span>
  );
}
