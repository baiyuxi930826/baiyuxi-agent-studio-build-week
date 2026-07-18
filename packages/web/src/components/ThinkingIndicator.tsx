'use client';

import { useAgentData } from '@/hooks/useAgentData';
import { useThreadLiveness } from '@/hooks/useThreadScopedSelectors';
import type { AgentStatusType, LivenessWarningSnapshot } from '@/stores/chat-types';
import { useChatStore } from '@/stores/chatStore';

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min > 0) return `${min}m ${sec}s`;
  return `${sec}s`;
}

/** Lucide timer icon (inline SVG to avoid emoji per design spec) */
function TimerIcon({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg
      className={className}
      style={style}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="10" x2="14" y1="2" y2="2" />
      <line x1="12" x2="12" y1="14" y2="10" />
      <circle cx="12" cy="14" r="8" />
    </svg>
  );
}

/** Lucide triangle-alert icon */
function TriangleAlertIcon({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg
      className={className}
      style={style}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <line x1="12" x2="12" y1="9" y2="13" />
      <line x1="12" x2="12.01" y1="17" y2="17" />
    </svg>
  );
}

/** Lucide square icon */
function SquareIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="18" height="18" x="3" y="3" rx="2" />
    </svg>
  );
}

interface ThinkingIndicatorProps {
  onCancel?: (threadId: string, agentId?: string) => void;
  threadId?: string;
}

/**
 * Single-agent thinking indicator.
 * Shows a simple banner when only one agent is being invoked (execute mode).
 * F118 Phase C: Extended with liveness warning states.
 */
export function ThinkingIndicator({ onCancel, threadId }: ThinkingIndicatorProps) {
  const currentThreadId = useChatStore((s) => s.currentThreadId);
  const effectiveThreadId = threadId ?? currentThreadId;
  const { targetAgents, agentStatuses, agentStatusDetails, agentInvocations, activeInvocations } =
    useThreadLiveness(effectiveThreadId);
  const { getAgentById } = useAgentData();

  // Derive display+cancel target from the same truth source (activeInvocations)
  // to avoid "显示 A、取消 B" when targetAgents is stale.
  const slots = Object.values(activeInvocations ?? {});
  const agentId = slots.length === 1 ? slots[0]?.agentId : targetAgents.length === 1 ? targetAgents[0] : undefined;
  if (!agentId) return null;
  const status: AgentStatusType = agentStatuses[agentId] ?? 'pending';
  if (status === 'done') return null;

  const agentData = getAgentById(agentId);
  const name = agentData?.displayName ?? agentId;
  const warning: LivenessWarningSnapshot | undefined = agentInvocations?.[agentId]?.livenessWarning;

  // F118 D2: spawning — CLI not yet connected, earliest signal
  if (status === 'spawning') {
    return (
      <div className="px-5 py-2 border-b border-studio bg-studio-surface-elevated">
        <div className="flex items-center gap-2">
          <SquareIcon className="w-3.5 h-3.5 animate-bounce text-studio-secondary" />
          <span className="text-sm text-studio-secondary">{name} 启动中</span>
          <span className="flex items-center gap-0.5">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="inline-block w-1 h-1 rounded-full bg-studio-secondary animate-bounce"
                style={{ animationDelay: `${i * 150}ms`, animationDuration: '0.8s' }}
              />
            ))}
          </span>
        </div>
      </div>
    );
  }

  // F118: alive_but_silent — amber warning banner with cancel button
  if (status === 'alive_but_silent' && warning) {
    const elapsed = formatDuration(warning.silenceDurationMs);
    return (
      <div
        data-testid="liveness-warning"
        className="px-5 py-3 border-b"
        style={{
          backgroundColor: 'var(--semantic-warning-surface)',
          borderColor: 'color-mix(in srgb, var(--semantic-warning) 20%, transparent)',
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <TimerIcon className="w-4 h-4 animate-pulse flex-shrink-0" style={{ color: 'var(--semantic-warning)' }} />
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="text-sm font-semibold" style={{ color: 'var(--studio-text)' }}>
                {name} 静默等待中… {elapsed}
              </span>
              <span className="text-xs" style={{ color: 'var(--studio-text-secondary)' }}>
                {warning.state === 'busy-silent'
                  ? '进程存活且 CPU 活跃，可能正在执行工具或等待 API 响应'
                  : '进程存活，等待响应中'}
              </span>
            </div>
          </div>
          {onCancel && effectiveThreadId && (
            <button
              type="button"
              data-testid="cancel-btn"
              onClick={() => onCancel(effectiveThreadId, agentId)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-[var(--studio-surface)] flex-shrink-0 transition-opacity hover:opacity-90"
              style={{ backgroundColor: 'var(--semantic-warning)' }}
            >
              <SquareIcon className="w-3.5 h-3.5" />
              取消
            </button>
          )}
        </div>
      </div>
    );
  }

  // F118: suspected_stall — orange warning banner with cancel button
  if (status === 'suspected_stall' && warning) {
    const elapsed = formatDuration(warning.silenceDurationMs);
    return (
      <div
        data-testid="liveness-warning"
        className="px-5 py-3 border-b"
        style={{
          backgroundColor: 'var(--semantic-critical-surface)',
          borderColor: 'color-mix(in srgb, var(--semantic-critical) 20%, transparent)',
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <TriangleAlertIcon className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--semantic-critical)' }} />
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="text-sm font-semibold" style={{ color: 'var(--studio-text)' }}>
                {name} 可能卡住了 — {elapsed} 无输出
              </span>
              <span className="text-xs" style={{ color: 'var(--studio-text-secondary)' }}>
                {warning.state === 'idle-silent'
                  ? '进程存活但 CPU 平坦，未检测到工具执行或 API 活动'
                  : '进程可能无响应'}
              </span>
            </div>
          </div>
          {onCancel && effectiveThreadId && (
            <button
              type="button"
              data-testid="cancel-btn"
              onClick={() => onCancel(effectiveThreadId, agentId)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-[var(--studio-surface)] flex-shrink-0 transition-opacity hover:opacity-90"
              style={{ backgroundColor: 'var(--semantic-critical)' }}
            >
              <SquareIcon className="w-3.5 h-3.5" />
              取消
            </button>
          )}
        </div>
      </div>
    );
  }

  // Default: normal thinking/streaming indicator.
  // F210 H3: agy trajectory 进度（agentStatusDetails）覆盖默认"回复中/思考中"，让 agy 长任务过程在
  // chat 区单行可见（折叠，不刷屏；done 后该 agent 不在 streaming/pending → 此分支不渲染）。
  const agyProgress = agentStatusDetails?.[agentId];
  return (
    <div className="px-5 py-2 border-b border-studio bg-studio-surface-elevated">
      <div className="flex items-center gap-2">
        <SquareIcon className="w-3.5 h-3.5 animate-bounce text-studio-secondary" />
        <span className="text-sm text-studio-secondary">
          {name}
          {agyProgress ? ` · ${agyProgress}` : status === 'streaming' ? '回复中' : '思考中'}
        </span>
        {/* #738: animated typing dots */}
        <span className="flex items-center gap-0.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="inline-block w-1 h-1 rounded-full bg-studio-secondary animate-bounce"
              style={{ animationDelay: `${i * 150}ms`, animationDuration: '0.8s' }}
            />
          ))}
        </span>
      </div>
    </div>
  );
}
