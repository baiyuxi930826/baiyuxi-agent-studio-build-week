'use client';

import { formatAgentName, useAgentData } from '@/hooks/useAgentData';
import { useElapsedTime } from '@/hooks/useElapsedTime';
import { useThreadLiveness } from '@/hooks/useThreadScopedSelectors';
import { agentColorMix, agentColorVar } from '@/lib/agent-slug';
import type { TokenUsage } from '@/stores/chat-types';
import type { AgentInvocationInfo } from '@/stores/chatStore';
import { deriveActiveAgents, formatCost, formatDuration, formatTokenCount } from './status-helpers';

function StatusDot({ status }: { status: string }) {
  switch (status) {
    case 'pending':
      return <span className="inline-block w-2 h-2 rounded-full bg-studio-surface-sunken animate-pulse" />;
    case 'streaming':
      return <span className="inline-block w-2 h-2 rounded-full bg-conn-emerald-text animate-pulse" />;
    case 'done':
      return <span className="text-conn-emerald-text text-xs">&#10003;</span>;
    case 'error':
      return <span className="text-conn-red-text text-xs">&#10007;</span>;
    case 'alive_but_silent':
      return <span className="inline-block w-2 h-2 rounded-full bg-conn-amber-text animate-pulse" />;
    case 'suspected_stall':
      return <span className="inline-block w-2 h-2 rounded-full bg-conn-amber-text animate-pulse" />;
    default:
      return null;
  }
}

function AgentStatusCard({
  agentId,
  status,
  invocation,
}: {
  agentId: string;
  status: string;
  invocation?: { startedAt?: number; durationMs?: number };
}) {
  const { getAgentById } = useAgentData();
  const agent = getAgentById(agentId);
  const elapsed = useElapsedTime(status === 'streaming' ? invocation?.startedAt : undefined);

  const timeDisplay = (() => {
    if (status === 'done' && invocation?.durationMs != null) {
      return formatDuration(invocation.durationMs);
    }
    if (status === 'streaming' && elapsed > 0) {
      return formatDuration(elapsed);
    }
    return null;
  })();

  const bgColor = agent ? agentColorMix(agent.id, 0.12, 'primary') : undefined;

  return (
    <div
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[var(--console-border-soft)]"
      style={{ backgroundColor: bgColor ?? 'var(--console-pill-bg)' }}
    >
      <StatusDot status={status} />
      <span
        className="text-xs font-medium"
        style={{ color: agent ? agentColorVar(agent.id, 'primary') : 'var(--studio-text-secondary)' }}
      >
        {agent ? formatAgentName(agent) : agentId}
      </span>
      {timeDisplay && <span className="text-xs text-studio-secondary ml-0.5">{timeDisplay}</span>}
    </div>
  );
}

/** Aggregate token usage across agent invocations, optionally filtered to specific agents */
export function aggregateUsage(
  invocations: Record<string, AgentInvocationInfo>,
  filterAgentIds?: string[],
): TokenUsage | null {
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  let count = 0;

  const entries = filterAgentIds
    ? filterAgentIds.map((id) => invocations[id]).filter(Boolean)
    : Object.values(invocations);

  for (const inv of entries) {
    const u = inv.usage;
    if (!u) continue;
    count++;
    if (u.inputTokens != null) inputTokens += u.inputTokens;
    if (u.outputTokens != null) outputTokens += u.outputTokens;
    if (u.totalTokens != null && u.inputTokens == null) inputTokens += u.totalTokens;
    if (u.costUsd != null) costUsd += u.costUsd;
  }

  if (count === 0) return null;
  return {
    ...(inputTokens > 0 ? { inputTokens } : {}),
    ...(outputTokens > 0 ? { outputTokens } : {}),
    ...(costUsd > 0 ? { costUsd } : {}),
  };
}

export function ParallelStatusBar({ onStop, threadId }: { onStop?: () => void; threadId: string }) {
  // F173 Phase C Task 3 — thread-scoped read. Caller (ChatContainer) passes
  // its threadId so we follow the per-thread liveness, not flat current.
  const {
    targetAgents,
    agentStatuses,
    agentInvocations,
    activeInvocations,
    intentMode,
    hasActive: hasActiveInvocation,
  } = useThreadLiveness(threadId);
  const activeAgents = deriveActiveAgents({
    targetAgents,
    activeInvocations,
    hasActiveInvocation,
    // F194 Phase Z5 AC-Z15: ideate mode 下保留 targetAgents UNION，让本轮所有角色的卡片
    // 全程显示，slot 移除（角色完成清 slot）不应让卡片消失
    intentMode,
  });

  if (activeAgents.length === 0) return null;

  const agg = aggregateUsage(agentInvocations, activeAgents);

  return (
    <div className="px-5 py-2.5 bg-gradient-to-r from-opus-bg via-codex-bg to-gemini-bg console-divider-b">
      <div className="flex items-center gap-4">
        <span className="text-sm font-medium text-studio-secondary">独立观点采样中</span>
        {activeAgents.map((agentId) => (
          <AgentStatusCard
            key={agentId}
            agentId={agentId}
            status={agentStatuses[agentId] ?? 'pending'}
            invocation={agentInvocations[agentId]}
          />
        ))}
        {onStop && (
          <button
            onClick={() => onStop()}
            className="ml-auto flex items-center gap-1 px-2.5 py-1 rounded-full bg-conn-red-bg text-conn-red-text hover:opacity-90 transition-colors text-xs font-medium"
            title="停止所有角色"
            aria-label="Stop all agents"
            data-testid="parallel-stop-button"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
              <rect x="4" y="4" width="12" height="12" rx="2" />
            </svg>
            停止
          </button>
        )}
      </div>
      {agg && (
        <div
          className="flex items-center gap-3 mt-1.5 text-xs text-studio-secondary"
          data-testid="parallel-usage-summary"
        >
          {agg.inputTokens != null && (
            <span>
              In: <span className="font-medium text-studio-secondary">{formatTokenCount(agg.inputTokens)}</span>
            </span>
          )}
          {agg.outputTokens != null && (
            <span>
              Out: <span className="font-medium text-studio-secondary">{formatTokenCount(agg.outputTokens)}</span>
            </span>
          )}
          {agg.costUsd != null && (
            <span>
              Cost: <span className="font-medium text-conn-amber-text">{formatCost(agg.costUsd)}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
