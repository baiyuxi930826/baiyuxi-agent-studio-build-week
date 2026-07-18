/**
 * F33: Bind an external CLI session to a agent that has no active session in this thread yet.
 * Extracted from SessionChainPanel to keep file size under 350 lines.
 */

// biome-ignore lint/correctness/noUnusedImports: React needed for JSX in vitest environment
import React, { useState } from 'react';
import { formatAgentName, useAgentData } from '@/hooks/useAgentData';
import { useIMEGuard } from '@/hooks/useIMEGuard';
import { apiFetch } from '@/utils/api-client';

export interface BindNewSessionSectionProps {
  threadId: string;
  activeAgentIds: Set<string>;
  onBound: () => void;
  disabled?: boolean;
}

export function BindNewSessionSection({ threadId, activeAgentIds, onBound, disabled }: BindNewSessionSectionProps) {
  const { agents } = useAgentData();
  const [expanded, setExpanded] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'ok' | 'error'>('idle');
  const ime = useIMEGuard();

  // Agents that don't yet have an active session in this thread
  const availableAgents = agents.filter((c) => !activeAgentIds.has(c.id));

  const handleBind = async () => {
    if (disabled) return;
    const trimmed = sessionId.trim();
    if (!trimmed || !selectedAgent || status === 'saving') return;
    setStatus('saving');
    try {
      const res = await apiFetch(`/api/threads/${threadId}/sessions/${selectedAgent}/bind`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cliSessionId: trimmed }),
      });
      if (!res.ok) {
        setStatus('error');
        return;
      }
      setStatus('ok');
      setSessionId('');
      setSelectedAgent('');
      setTimeout(() => {
        setExpanded(false);
        setStatus('idle');
        onBound();
      }, 800);
    } catch {
      setStatus('error');
    }
  };

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        disabled={disabled}
        className="text-micro text-studio-muted hover:text-studio-secondary transition-colors mt-1 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        + 绑定外部 Session
      </button>
    );
  }

  return (
    <div className="mt-2 p-2 rounded-lg bg-[var(--console-shell-bg)]">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-micro font-medium text-studio-secondary">绑定外部 Session</span>
        <button
          type="button"
          onClick={() => {
            setExpanded(false);
            setStatus('idle');
          }}
          className="text-micro text-studio-muted hover:text-studio-secondary"
        >
          ✕
        </button>
      </div>
      <div className="space-y-1.5">
        <select
          value={selectedAgent}
          onChange={(e) => setSelectedAgent(e.target.value)}
          className="w-full text-xs px-2 py-1 rounded-[10px] border-transparent bg-[var(--console-field-bg,var(--console-card-bg))] focus:outline-none focus:ring-1 focus:ring-studio-accent"
        >
          <option value="">选择角色...</option>
          {availableAgents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {formatAgentName(agent)}
            </option>
          ))}
        </select>
        <input
          value={sessionId}
          onChange={(e) => setSessionId(e.target.value)}
          onCompositionStart={ime.onCompositionStart}
          onCompositionEnd={ime.onCompositionEnd}
          onKeyDown={(e) => {
            if (ime.isComposing()) return;
            if (e.key === 'Enter') void handleBind();
          }}
          placeholder="CLI Session ID"
          maxLength={500}
          className="w-full text-xs font-mono px-2 py-1 rounded-[10px] border-transparent bg-[var(--console-field-bg,var(--console-card-bg))] focus:outline-none focus:ring-1 focus:ring-studio-accent"
        />
        <button
          type="button"
          onClick={() => void handleBind()}
          disabled={status === 'saving' || !sessionId.trim() || !selectedAgent || disabled}
          className="w-full text-micro px-2 py-1 rounded bg-studio-surface hover:bg-[var(--console-hover-bg)] disabled:opacity-40 transition-colors"
        >
          {status === 'saving'
            ? '绑定中...'
            : status === 'ok'
              ? '已绑定'
              : status === 'error'
                ? '绑定失败，重试'
                : '绑定'}
        </button>
      </div>
    </div>
  );
}
