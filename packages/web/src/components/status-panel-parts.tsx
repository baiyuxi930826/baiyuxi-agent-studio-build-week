'use client';

import { useState } from 'react';
import { useElapsedTime } from '@/hooks/useElapsedTime';
import type { AgentInvocationInfo } from '@/stores/chat-types';
import { formatDuration } from './status-helpers';

export function AgentInvocationTime({ invocation }: { invocation: AgentInvocationInfo }) {
  const elapsed = useElapsedTime(invocation.startedAt && !invocation.durationMs ? invocation.startedAt : undefined);

  if (invocation.durationMs != null) {
    return <span className="text-studio-secondary ml-auto">{formatDuration(invocation.durationMs)}</span>;
  }

  if (invocation.startedAt && elapsed > 0) {
    return <span className="text-conn-emerald-text ml-auto">{formatDuration(elapsed)}</span>;
  }

  return null;
}

export function CollapsibleIds({
  sessionId,
  invocationId,
  onCopy,
}: {
  sessionId?: string;
  invocationId?: string;
  onCopy: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="ml-3.5 mt-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-micro text-studio-muted hover:text-studio-secondary transition-colors cursor-pointer select-none"
      >
        {open ? '▾' : '▸'} IDs
      </button>
      {open && (
        <div className="mt-0.5 space-y-0.5 animate-fade-in">
          {sessionId && (
            <div className="flex items-baseline min-w-0">
              <span className="shrink-0 text-micro text-studio-muted mr-1">session:</span>
              <button
                className="truncate min-w-0 text-micro text-studio-muted font-mono hover:text-studio-secondary cursor-pointer transition-colors"
                title={`点击复制: ${sessionId}`}
                onClick={() => onCopy(sessionId)}
              >
                {sessionId}
              </button>
            </div>
          )}
          {invocationId && (
            <div className="flex items-baseline min-w-0">
              <span className="shrink-0 text-micro text-studio-muted mr-1">invocation:</span>
              <button
                className="truncate min-w-0 text-micro text-studio-muted font-mono hover:text-studio-secondary cursor-pointer transition-colors"
                title={`点击复制: ${invocationId}`}
                onClick={() => onCopy(invocationId)}
              >
                {invocationId}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
