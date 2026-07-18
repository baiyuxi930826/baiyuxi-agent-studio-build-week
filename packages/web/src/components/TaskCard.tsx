'use client';

import type { TaskItem } from '@agent-studio/shared';
import { useState } from 'react';
import { AgentAvatar } from './AgentAvatar';

type TaskStatus = 'todo' | 'doing' | 'blocked' | 'done';

const STATUS_CYCLE: Record<TaskStatus, TaskStatus> = {
  todo: 'doing',
  doing: 'blocked',
  blocked: 'done',
  done: 'todo',
};

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: '待办',
  doing: '进行中',
  blocked: '阻塞中',
  done: '已完成',
};

const STATUS_STYLES: Record<TaskStatus, { text: string; border: string; pillBg: string }> = {
  doing: {
    text: 'text-studio-crosspost',
    border: 'border-l-studio-crosspost',
    pillBg: 'bg-studio-crosspost/10 text-studio-crosspost',
  },
  blocked: {
    text: 'text-studio-accent',
    border: 'border-l-studio-accent',
    pillBg: 'bg-studio-accent/10 text-studio-accent',
  },
  todo: {
    text: 'text-studio-muted',
    border: 'border-l-studio-muted',
    pillBg: 'bg-studio-surface-elevated text-studio-muted',
  },
  done: {
    text: 'text-conn-green-text',
    border: 'border-l-conn-green-text',
    pillBg: 'bg-conn-green-bg text-conn-green-text dark:bg-green-950/20',
  },
};

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  return `${days}天前`;
}

export function TaskCard({
  task,
  onStatusChange,
}: {
  task: TaskItem;
  onStatusChange: (taskId: string, newStatus: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const status = task.status as TaskStatus;
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.todo;

  return (
    <div
      className={`border-l-4 ${style.border} bg-studio-surface-elevated border border-studio rounded-xl p-3 mx-3 mb-1.5 hover:-translate-y-0.5 transition-transform ease-out`}
    >
      <div className="flex items-center gap-2">
        {/* Title */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex-1 text-left text-sm font-medium text-studio-secondary truncate"
        >
          {task.title}
        </button>

        {/* Owner avatar */}
        {task.ownerAgentId && <AgentAvatar agentId={task.ownerAgentId} size={14} />}

        {/* Status pill (clickable to cycle) */}
        <button
          type="button"
          onClick={() => onStatusChange(task.id, STATUS_CYCLE[status])}
          className={`text-micro font-semibold px-2 py-0.5 rounded-full ${style.pillBg} transition-colors hover:opacity-80`}
        >
          {STATUS_LABELS[status]}
        </button>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="mt-2 pt-2 border-t border-studio">
          {task.why && <p className="text-xs text-studio-muted leading-relaxed">{task.why}</p>}
          <p className="text-micro text-studio-muted mt-1">
            {formatRelativeTime(task.createdAt)} · {task.createdBy === 'user' ? 'Baiyuxi' : task.createdBy}
          </p>
        </div>
      )}
    </div>
  );
}
