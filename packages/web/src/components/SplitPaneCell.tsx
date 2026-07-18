'use client';

import { useMemo } from 'react';
import type { ThreadState } from '@/stores/chat-types';
import type { ChatMessage } from '@/stores/chatStore';
import { AgentAvatar } from './AgentAvatar';
import { getAgentStatusType } from './ThreadAgentStatus';

const VISIBLE_MESSAGES = 5;

interface SplitPaneCellProps {
  threadId: string;
  threadTitle: string;
  threadState: ThreadState;
  isSelected: boolean;
  onSelect: (threadId: string) => void;
  onDoubleClick: (threadId: string) => void;
}

function MiniMessage({ msg }: { msg: ChatMessage }) {
  const isUser = msg.type === 'user' && !msg.agentId;
  return (
    <div className={`flex gap-1.5 ${isUser ? 'justify-end' : ''}`}>
      {!isUser && msg.agentId && <AgentAvatar agentId={msg.agentId} size={16} />}
      <p
        className={`text-xs leading-relaxed truncate max-w-[90%] px-2 py-1 rounded-lg ${
          isUser ? 'bg-studio-surface text-studio-black' : 'bg-studio-surface-elevated text-studio-secondary'
        } ${msg.isStreaming ? 'opacity-70' : ''}`}
      >
        {msg.content.slice(0, 120)}
        {msg.content.length > 120 ? '...' : ''}
        {msg.isStreaming && <span className="animate-pulse ml-1">|</span>}
      </p>
    </div>
  );
}

export function SplitPaneCell({
  threadId,
  threadTitle,
  threadState,
  isSelected,
  onSelect,
  onDoubleClick,
}: SplitPaneCellProps) {
  const agentStatus = getAgentStatusType(threadState.agentStatuses);
  const recentMessages = useMemo(() => threadState.messages.slice(-VISIBLE_MESSAGES), [threadState.messages]);

  const statusColor =
    agentStatus === 'error'
      ? 'text-conn-red-text'
      : agentStatus === 'working'
        ? 'text-conn-amber-text'
        : agentStatus === 'done'
          ? 'text-conn-emerald-text'
          : 'text-studio-muted';

  return (
    <div
      className={`flex flex-col rounded-lg border-2 transition-colors cursor-pointer overflow-hidden ${
        isSelected ? 'border-studio-accent shadow-sm' : 'border-studio hover:border-studio'
      }`}
      onClick={() => onSelect(threadId)}
      onDoubleClick={() => onDoubleClick(threadId)}
    >
      {/* Pane header */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-studio-surface-elevated border-b border-studio-subtle flex-shrink-0">
        <span className={`text-xs ${statusColor}`}>{agentStatus !== 'idle' ? 'ᓚᘏᗢ' : ''}</span>
        <span className="text-xs font-medium text-studio-secondary truncate flex-1">{threadTitle}</span>
        {threadState.isLoading && (
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--semantic-warning)] animate-pulse" />
        )}
        {threadState.unreadCount > 0 && (
          <span className="text-micro bg-[var(--semantic-warning)] text-[var(--studio-surface)] rounded-full px-1 min-w-[14px] text-center">
            {threadState.unreadCount > 99 ? '99+' : threadState.unreadCount}
          </span>
        )}
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5 min-h-0">
        {recentMessages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <span className="text-xs text-studio-muted">无消息</span>
          </div>
        ) : (
          recentMessages.map((msg) => <MiniMessage key={msg.id} msg={msg} />)
        )}
      </div>
    </div>
  );
}

/** Empty pane placeholder */
export function SplitPanePlaceholder({ index }: { index: number }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-studio transition-colors">
      <span className="text-2xl text-studio-muted mb-1">+</span>
      <span className="text-xs text-studio-muted">窗格 {index + 1}</span>
      <span className="text-micro text-studio-muted mt-0.5">点击左侧 thread 分配到此处</span>
    </div>
  );
}
