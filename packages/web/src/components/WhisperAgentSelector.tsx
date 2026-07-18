'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { type AgentData, formatAgentName } from '@/hooks/useAgentData';
import { agentColorVar } from '@/lib/agent-slug';

interface WhisperAgentSelectorProps {
  agents: AgentData[];
  selected: Set<string>;
  activeAgentIds: Set<string>;
  onToggle: (agentId: string) => void;
}

/** F108 Scene 2 v2: Mention-like floating popup for whisper target selection.
 *  Mirrors the @ mention experience: compact, avatar+label+desc, positioned above input. */
export function WhisperAgentSelector({ agents, selected, activeAgentIds, onToggle }: WhisperAgentSelectorProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollDown, setCanScrollDown] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const check = () => setCanScrollDown(el.scrollHeight > el.clientHeight + el.scrollTop + 4);
    check();
    el.addEventListener('scroll', check);
    return () => el.removeEventListener('scroll', check);
  }, []);

  return (
    <div className="absolute bottom-full left-4 mb-2 bg-studio-surface rounded-xl shadow-lg border border-studio overflow-hidden w-64 z-10 max-h-80 flex flex-col">
      <div className="px-4 py-1.5 text-xs text-semantic-warning font-medium border-b border-studio-subtle shrink-0">
        悄悄话目标 · 可多选
      </div>
      <div ref={scrollRef} className="overflow-y-auto flex-1">
        {agents.map((agent) => (
          <AgentRow
            key={agent.id}
            agent={agent}
            isActive={activeAgentIds.has(agent.id)}
            isSelected={selected.has(agent.id)}
            onToggle={onToggle}
          />
        ))}
      </div>
      {canScrollDown && (
        <div className="px-4 py-1 text-micro text-studio-muted text-center border-t border-studio-subtle bg-gradient-to-t from-[var(--studio-surface)] shrink-0">
          ↓ 还有更多角色
        </div>
      )}
      {selected.size === 0 && (
        <div className="px-4 py-1.5 text-xs text-semantic-critical border-t border-studio-subtle shrink-0">
          请至少选一个角色
        </div>
      )}
    </div>
  );
}

/** Compact chip showing selected whisper targets below the input area. */
export function WhisperTargetChips({
  agents,
  selected,
  onToggle,
}: {
  agents: AgentData[];
  selected: Set<string>;
  onToggle: (agentId: string) => void;
}) {
  if (selected.size === 0) return null;
  const selectedAgents = agents.filter((c) => selected.has(c.id));
  return (
    <div className="px-4 pt-1 flex items-center gap-1.5 flex-wrap">
      <span className="text-xs text-semantic-warning shrink-0">悄悄话:</span>
      {selectedAgents.map((agent) => (
        <button
          key={agent.id}
          type="button"
          onClick={() => onToggle(agent.id)}
          className="text-xs px-2 py-0.5 rounded-full border border-current bg-semantic-warning-surface font-medium transition-colors hover:opacity-70"
          style={{ color: agentColorVar(agent.id, 'primary') }}
        >
          {formatAgentName(agent)} ×
        </button>
      ))}
    </div>
  );
}

function AgentRow({
  agent,
  isActive,
  isSelected,
  onToggle,
}: {
  agent: AgentData;
  isActive: boolean;
  isSelected: boolean;
  onToggle: (agentId: string) => void;
}) {
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (!isActive) onToggle(agent.id);
    },
    [isActive, agent.id, onToggle],
  );

  return (
    <button
      type="button"
      onMouseDown={handleClick}
      disabled={isActive}
      className={`w-full text-left px-4 py-2.5 flex items-center gap-3 transition-colors ${
        isActive
          ? 'opacity-40 cursor-not-allowed'
          : isSelected
            ? 'bg-studio-surface-elevated'
            : 'hover:bg-studio-surface-elevated'
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={agent.avatar}
        alt={formatAgentName(agent)}
        className="w-7 h-7 rounded-full shrink-0"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = 'none';
        }}
      />
      <div className="min-w-0 flex-1">
        <div
          className="text-sm font-semibold flex items-center gap-1.5"
          style={{ color: agentColorVar(agent.id, 'primary') }}
        >
          {formatAgentName(agent)}
          {isSelected && (
            <svg className="w-3.5 h-3.5 text-semantic-warning shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
          )}
        </div>
        <div className="text-xs text-studio-muted truncate">{agent.roleDescription}</div>
      </div>
      {isActive && (
        <span className="text-micro px-1.5 py-0.5 rounded bg-studio-surface-elevated text-studio-muted shrink-0">
          执行中
        </span>
      )}
    </button>
  );
}
