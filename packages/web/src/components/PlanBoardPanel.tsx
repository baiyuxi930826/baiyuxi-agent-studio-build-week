'use client';

import { useMemo, useState } from 'react';
import { formatAgentName, useAgentData } from '@/hooks/useAgentData';
import { useSendMessage } from '@/hooks/useSendMessage';
import { NEUTRAL_DOT_COLOR } from '@/lib/color-defaults';
import type { AgentInvocationInfo } from '@/stores/chatStore';
import { buildContinueMessage } from '@/utils/taskProgressContinue';
import { useConfirm } from './useConfirm';

export interface PlanBoardPanelProps {
  threadId: string;
  agentInvocations: Record<string, AgentInvocationInfo>;
}

function TaskStatusIcon({ status }: { status: 'completed' | 'in_progress' | 'pending' }) {
  if (status === 'completed') {
    return (
      <svg
        className="w-3.5 h-3.5 text-conn-emerald-text"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    );
  }
  if (status === 'in_progress') {
    return (
      <svg
        className="w-3.5 h-3.5 text-conn-blue-text animate-spin"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v6h6M20 20v-6h-6" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M20 9a8 8 0 00-14.9-3M4 15a8 8 0 0014.9 3" />
      </svg>
    );
  }
  return (
    <svg
      className="w-3.5 h-3.5 text-studio-muted"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect x="5" y="5" width="14" height="14" rx="2" />
    </svg>
  );
}

function taskStatusA11yText(status: 'completed' | 'in_progress' | 'pending'): string {
  if (status === 'completed') return '已完成';
  if (status === 'in_progress') return '进行中';
  return '待处理';
}

/* ── Per-agent plan card ────────────────────────────────────── */

function PlanCard({ agentId, threadId, inv }: { agentId: string; threadId: string; inv: AgentInvocationInfo }) {
  const confirm = useConfirm();
  const { getAgentById } = useAgentData();
  const { handleSend } = useSendMessage(threadId);
  const agent = getAgentById(agentId);
  const dotColor = agent?.color.primary ?? NEUTRAL_DOT_COLOR;
  const tp = inv.taskProgress!;
  const { tasks } = tp;
  const completed = tasks.filter((t) => t.status === 'completed').length;
  const status = tp.snapshotStatus;

  const statusLabel =
    status === 'completed' ? '已完成' : status === 'interrupted' ? '已中断' : status === 'running' ? '运行中' : null;
  const statusTone =
    status === 'completed'
      ? 'bg-conn-green-bg text-conn-green-text'
      : status === 'interrupted'
        ? 'bg-conn-red-bg text-conn-red-text'
        : status === 'running'
          ? 'bg-conn-blue-bg text-conn-blue-text'
          : 'bg-[var(--console-field-bg)] text-studio-secondary';

  return (
    <div className="py-1.5">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <span
            className={`inline-block h-2 w-2 rounded-full ${status === 'running' ? 'animate-pulse' : ''}`}
            style={{ backgroundColor: dotColor }}
          />
          <span className="text-xs font-medium text-studio-secondary">{agent ? formatAgentName(agent) : agentId}</span>
          <span className="text-micro text-studio-muted">
            {completed}/{tasks.length}
          </span>
          {statusLabel && <span className={`text-xs px-1 py-0.5 rounded ${statusTone}`}>{statusLabel}</span>}
        </div>
        {status === 'interrupted' && (
          <button
            className="text-micro px-2 py-0.5 rounded-full border border-[var(--console-border-soft)] hover:bg-[var(--console-hover-bg)] transition-colors"
            onClick={async () => {
              if (await confirm({ title: '继续任务', message: '确认继续上次任务？' })) {
                void handleSend(buildContinueMessage(agentId, tp), undefined, threadId);
              }
            }}
          >
            继续
          </button>
        )}
      </div>
      <div className="space-y-0.5 ml-3.5">
        {tasks.map((t) => {
          const taskText = t.status === 'in_progress' ? (t.activeForm ?? t.subject) : t.subject;
          return (
            <div key={t.id} className="flex items-start gap-1 text-xs leading-tight">
              <span className="sr-only">{taskStatusA11yText(t.status)} </span>
              <span className="mt-px flex-shrink-0" aria-hidden="true">
                <TaskStatusIcon status={t.status} />
              </span>
              <span className={t.status === 'completed' ? 'text-studio-muted line-through' : 'text-studio-secondary'}>
                {taskText}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-1 ml-3.5 h-1 bg-studio-surface-sunken rounded-full overflow-hidden">
        <div
          className="h-full bg-conn-green-text rounded-full transition-all duration-300"
          style={{ width: `${Math.round((completed / tasks.length) * 100)}%` }}
        />
      </div>
    </div>
  );
}

/* ── Main panel ───────────────────────────────────────────── */

export function PlanBoardPanel({ threadId, agentInvocations }: PlanBoardPanelProps) {
  const [completedOpen, setCompletedOpen] = useState(false);

  const { runningAgents, interruptedAgents, completedAgents } = useMemo(() => {
    const running: Array<[string, AgentInvocationInfo]> = [];
    const interrupted: Array<[string, AgentInvocationInfo]> = [];
    const completed: Array<[string, AgentInvocationInfo]> = [];

    for (const [agentId, inv] of Object.entries(agentInvocations)) {
      const tp = inv.taskProgress;
      if (!tp || tp.tasks.length === 0) continue;

      if (tp.snapshotStatus === 'completed') {
        completed.push([agentId, inv]);
      } else if (tp.snapshotStatus === 'interrupted') {
        interrupted.push([agentId, inv]);
      } else {
        running.push([agentId, inv]);
      }
    }

    running.sort((a, b) => (b[1].startedAt ?? 0) - (a[1].startedAt ?? 0));
    completed.sort((a, b) => (b[1].taskProgress?.lastUpdate ?? 0) - (a[1].taskProgress?.lastUpdate ?? 0));

    return { runningAgents: running, interruptedAgents: interrupted, completedAgents: completed };
  }, [agentInvocations]);

  const totalAgents = runningAgents.length + interruptedAgents.length + completedAgents.length;
  if (totalAgents === 0) return null;

  return (
    <section className="rounded-lg border border-[var(--console-border-soft)] bg-[var(--console-card-bg)] p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-studio-secondary">Agent祟祟 ({totalAgents})</h3>
      </div>

      {/* Running agents */}
      {runningAgents.map(([agentId, inv]) => (
        <PlanCard key={agentId} agentId={agentId} threadId={threadId} inv={inv} />
      ))}

      {/* Interrupted agents */}
      {interruptedAgents.map(([agentId, inv]) => (
        <PlanCard key={agentId} agentId={agentId} threadId={threadId} inv={inv} />
      ))}

      {/* Completed agents — folded */}
      {completedAgents.length > 0 && (
        <div className="mt-2 console-divider-t pt-2">
          <button
            onClick={() => setCompletedOpen((v) => !v)}
            className="w-full flex items-center justify-between text-micro text-studio-secondary hover:text-studio-secondary"
          >
            <span>已完成 ({completedAgents.length})</span>
            <span>{completedOpen ? '▲' : '▼'}</span>
          </button>
          {completedOpen && (
            <div className="mt-1">
              {completedAgents.map(([agentId, inv]) => (
                <PlanCard key={agentId} agentId={agentId} threadId={threadId} inv={inv} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
