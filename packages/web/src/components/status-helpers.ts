/**
 * Shared helper functions for RightStatusPanel and related components.
 */

export type IntentMode = 'execute' | 'ideate' | null;
export type AgentStatus =
  | 'spawning'
  | 'pending'
  | 'streaming'
  | 'done'
  | 'error'
  | 'alive_but_silent'
  | 'suspected_stall';
export type ActiveInvocationSlot = { agentId: string; mode?: string; startedAt?: number };
export type TaskProgressSnapshot = {
  tasks?: unknown[];
  snapshotStatus?: 'running' | 'interrupted' | 'completed' | string;
};

/**
 * Extract agents that still have a non-completed task-progress snapshot.
 * These snapshots should remain visible even when an invocation temporarily drops.
 */
export function collectSnapshotActiveAgents(
  agentInvocations: Record<string, { taskProgress?: TaskProgressSnapshot }>,
): string[] {
  return Object.entries(agentInvocations)
    .filter(([, inv]) => {
      const taskProgress = inv.taskProgress;
      if (!taskProgress || (taskProgress.tasks?.length ?? 0) === 0) return false;
      return taskProgress.snapshotStatus !== 'completed';
    })
    .map(([agentId]) => agentId);
}

/**
 * Derive agents currently considered active in UI components.
 * Priority:
 * 1) invocation slots (authoritative runtime truth)
 * 2) targetAgents only while invocation is still active but slots not ready (degraded)
 * 3) snapshot-only when invocation has ended
 * Legacy compatibility: when slot data is not provided, keep previous targetAgents behavior.
 *
 * F194 Phase Z5 AC-Z15: ideate mode 下保留 targetAgents UNION（不只看 slots），
 * 让 ParallelStatusBar 全程显示本轮所有 targetAgents 卡片。slot 移除（角色完成清 slot）
 * 不应让卡片消失——owner alpha catch 2026-05-10 04:51："并发 at 47 和 55
 * 但是观点采样面板只显示 47"。
 */
export function deriveActiveAgents({
  targetAgents,
  snapshotAgents = [],
  activeInvocations,
  hasActiveInvocation,
  intentMode,
}: {
  targetAgents: string[];
  snapshotAgents?: string[];
  activeInvocations?: Record<string, ActiveInvocationSlot>;
  hasActiveInvocation?: boolean;
  intentMode?: IntentMode;
}): string[] {
  if (activeInvocations == null && hasActiveInvocation == null) {
    return Array.from(new Set([...targetAgents, ...snapshotAgents]));
  }

  const slotAgents = Array.from(
    new Set(
      Object.values(activeInvocations ?? {})
        .map((slot) => slot?.agentId)
        .filter((agentId): agentId is string => typeof agentId === 'string' && agentId.length > 0),
    ),
  );

  // F194 Phase Z5 AC-Z15: ideate mode 下 fallback 到 targetAgents UNION，slot 状态用作每个角色
  // 卡片的状态展示（done/streaming/error）但不剔除卡片本身。仅在 hasActiveInvocation 为 true
  // 时启用，避免 invocation 完全结束后还残留陈旧卡片。
  if (intentMode === 'ideate' && hasActiveInvocation && targetAgents.length > 0) {
    return Array.from(new Set([...targetAgents, ...slotAgents, ...snapshotAgents]));
  }

  if (slotAgents.length > 0) return Array.from(new Set([...slotAgents, ...snapshotAgents]));
  if (hasActiveInvocation) return Array.from(new Set([...targetAgents, ...snapshotAgents]));
  return Array.from(new Set(snapshotAgents));
}

export function modeLabel(mode: IntentMode): string {
  if (mode === 'ideate') return '独立观点采样';
  if (mode === 'execute') return '执行';
  return '空闲';
}

export function statusLabel(status: AgentStatus): string {
  switch (status) {
    case 'spawning':
      return '启动中';
    case 'pending':
      return '待命';
    case 'streaming':
      return '工作中';
    case 'done':
      return '完成';
    case 'error':
      return '异常';
    case 'alive_but_silent':
      return '静默等待';
    case 'suspected_stall':
      return '疑似卡住';
    default:
      return '未知';
  }
}

export function statusTone(status: AgentStatus): string {
  switch (status) {
    case 'spawning':
      return 'text-blue-500';
    case 'pending':
      return 'text-studio-secondary';
    case 'streaming':
      return 'text-green-600';
    case 'done':
      return 'text-emerald-700';
    case 'error':
      return 'text-red-600';
    case 'alive_but_silent':
      return 'text-amber-500';
    case 'suspected_stall':
      return 'text-orange-600';
    default:
      return 'text-studio-secondary';
  }
}

export function truncateId(id: string, len = 8): string {
  return id.length > len ? `${id.slice(0, len)}…` : id;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** F8: Format token count as compact string (e.g. 39270 → "39.3k") */
export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** F8: Format USD cost (e.g. 0.03 → "$0.03") */
export function formatCost(usd: number): string {
  return `$${usd.toFixed(usd < 0.01 ? 4 : 2)}`;
}
