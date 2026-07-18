'use client';

import type { AgentStatusType, ThreadState } from '@/stores/chat-types';

/**
 * Compact agent status indicator for thread sidebar.
 */

function aggregateStatus(ts: ThreadState): 'idle' | 'working' | 'done' | 'error' {
  const statuses = Object.values(ts.agentStatuses);
  if (statuses.length === 0) return 'idle';
  if (statuses.some((s) => s === 'error')) return 'error';
  if (statuses.some((s) => s === 'streaming' || s === 'pending' || s === 'spawning')) return 'working';
  if (statuses.some((s) => s === 'done')) return 'done';
  return 'idle';
}

function getDaemonDetailTooltip(threadState: ThreadState, status: string): string {
  if (status !== 'working') return status;
  const workingAgents = Object.entries(threadState.agentStatuses)
    .filter(([, s]) => s === 'streaming' || s === 'pending' || s === 'spawning')
    .map(([agentId]) => agentId);
  const details = workingAgents.map((agentId) => threadState.agentStatusDetails?.[agentId]).filter(Boolean);
  return details.length > 0 ? (details[0] as string) : status;
}

export function ThreadAgentStatus({
  threadState,
  unreadCount,
  hasUserMention,
}: {
  threadState: ThreadState;
  unreadCount: number;
  hasUserMention?: boolean;
}) {
  const status = aggregateStatus(threadState);

  if (status === 'idle' && unreadCount === 0 && !hasUserMention) return null;

  const statusClasses: Record<string, string> = {
    idle: 'text-studio-muted',
    working: 'text-conn-amber-text animate-agent-bounce',
    done: 'text-conn-emerald-text',
    error: 'text-conn-red-text animate-agent-shake',
  };

  const tooltip = getDaemonDetailTooltip(threadState, status);

  return (
    <span className="inline-flex items-center gap-0.5 flex-shrink-0">
      {status !== 'idle' && (
        <span className={`text-xs ${statusClasses[status]}`} title={tooltip}>
          ●
        </span>
      )}
      {status === 'done' && <span className="text-conn-emerald-text text-micro">&#10003;</span>}
      {hasUserMention && (
        <span className="text-xs font-semibold text-conn-red-text" title="Agent @ 了你">
          @
        </span>
      )}
      {unreadCount > 0 && (
        <span
          className={`inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[var(--studio-surface)] text-micro font-bold leading-none ${
            hasUserMention ? 'bg-conn-red-text' : 'bg-[var(--semantic-warning)]'
          }`}
        >
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </span>
  );
}

/** Aggregate agent status for a given set of agentStatuses */
export function getAgentStatusType(
  agentStatuses: Record<string, AgentStatusType>,
): 'idle' | 'working' | 'done' | 'error' {
  const statuses = Object.values(agentStatuses);
  if (statuses.length === 0) return 'idle';
  if (statuses.some((s) => s === 'error')) return 'error';
  if (statuses.some((s) => s === 'streaming' || s === 'pending' || s === 'spawning')) return 'working';
  if (statuses.some((s) => s === 'done')) return 'done';
  return 'idle';
}
