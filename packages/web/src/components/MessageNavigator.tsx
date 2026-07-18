'use client';

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { type AgentData, formatAgentName, useAgentData } from '@/hooks/useAgentData';
import { useCoCreatorConfig } from '@/hooks/useCoCreatorConfig';
import { agentColorVar } from '@/lib/agent-slug';
import { AGENT_COLORS } from '@/lib/color-defaults';
import type { ChatMessage as ChatMessageData } from '@/stores/chatStore';
import { scrollToMessage } from '@/utils/scrollToMessage';

/** Maximum dots rendered on the track — prevents clutter in long conversations */
const MAX_DOTS = 18;

type AgentLookup = (id: string) => AgentData | undefined;

const FALLBACK_AGENT_META: Record<string, { label: string; color: string }> = {
  opus: { label: 'Ethan（任务主控与实现）', color: AGENT_COLORS.opus.primary },
  codex: { label: 'Owen（验证与审查）', color: AGENT_COLORS.codex.primary },
  gemini: { label: 'Andy（界面与视觉）', color: AGENT_COLORS.gemini.primary },
  kimi: { label: 'Nora（研究与上下文）', color: AGENT_COLORS.kimi.primary },
};

function resolveFallbackAgentMeta(agentId: string): { baseId: string; label: string; color: string } | undefined {
  const normalizedId = agentId.toLowerCase();
  const direct = FALLBACK_AGENT_META[normalizedId];
  if (direct) return { baseId: normalizedId, ...direct };

  const base = normalizedId.split('-')[0];
  if (base && base !== normalizedId && FALLBACK_AGENT_META[base]) {
    return { baseId: base, ...FALLBACK_AGENT_META[base] };
  }

  return undefined;
}

function resolveAgentById(getAgentById: AgentLookup, agentId: string): AgentData | undefined {
  const normalizedId = agentId.toLowerCase();
  const direct = getAgentById(normalizedId);
  if (direct) return direct;
  const base = normalizedId.split('-')[0];
  if (base && base !== normalizedId) return getAgentById(base);
  return undefined;
}

function getSenderLabel(
  msg: ChatMessageData,
  resolveAgent: (agentId: string) => AgentData | undefined,
  ownerName: string,
): string {
  const agentId = msg.agentId;
  const isOwner = msg.type === 'user' && !agentId;
  if (isOwner) return ownerName;

  const isAssistant = msg.type === 'assistant' || (msg.type === 'user' && !!agentId);
  if (!isAssistant) return '系统';
  if (!agentId) return '系统';
  const agent = resolveAgent(agentId);
  if (!agent) {
    const fallback = resolveFallbackAgentMeta(agentId);
    if (!fallback) return agentId;
    return fallback.baseId === agentId.toLowerCase() ? fallback.label : `${fallback.label}（${agentId}）`;
  }
  const baseName = formatAgentName(agent);
  return agent.id === agentId ? baseName : `${agent.displayName}（${agentId}）`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function truncateContent(content: string, maxLen: number): string {
  return content.length <= maxLen ? content : `${content.slice(0, maxLen)}…`;
}

interface MessageNavigatorProps {
  messages: ChatMessageData[];
  scrollContainerRef: React.RefObject<HTMLElement | null>;
}

export function MessageNavigator({ messages, scrollContainerRef }: MessageNavigatorProps) {
  const { getAgentById } = useAgentData();
  const coCreator = useCoCreatorConfig();
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const resolveAgent = useCallback((agentId: string) => resolveAgentById(getAgentById, agentId), [getAgentById]);

  const getSenderName = useCallback(
    (msg: ChatMessageData) => getSenderLabel(msg, resolveAgent, coCreator.name),
    [coCreator.name, resolveAgent],
  );

  // Filter to user + assistant only
  const navItems = useMemo(() => messages.filter((m) => m.type === 'user' || m.type === 'assistant'), [messages]);

  // Sample at fixed intervals when too many messages
  const sampledItems = useMemo(() => {
    if (navItems.length <= MAX_DOTS) {
      return navItems.map((msg, i) => ({ msg, sourceIdx: i }));
    }
    const step = (navItems.length - 1) / (MAX_DOTS - 1);
    return Array.from({ length: MAX_DOTS }, (_, i) => {
      const idx = Math.round(i * step);
      return { msg: navItems[idx], sourceIdx: idx };
    });
  }, [navItems]);

  // Click on track background → scroll proportionally
  const handleTrackClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const track = trackRef.current;
      const container = scrollContainerRef.current;
      if (!track || !container) return;
      // Ignore clicks on dots — closest() handles future child elements too (P3 fix)
      if ((e.target as HTMLElement).closest('button')) return;
      const rect = track.getBoundingClientRect();
      const ratio = (e.clientY - rect.top) / rect.height;
      container.scrollTo({
        top: ratio * (container.scrollHeight - container.clientHeight),
        behavior: 'smooth',
      });
    },
    [scrollContainerRef],
  );

  if (navItems.length < 3) return null;

  return (
    <div className="absolute right-0.5 top-2 bottom-2 w-5 z-10">
      <div ref={trackRef} className="relative h-full cursor-pointer" onClick={handleTrackClick}>
        {/* Track rail — thin connecting line between dots */}
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-[var(--console-border-soft)] -translate-x-1/2" />

        {/* Sampled dots */}
        {sampledItems.map(({ msg, sourceIdx }, idx) => {
          const top = sampledItems.length <= 1 ? 50 : (idx / (sampledItems.length - 1)) * 100;
          const isOwner = msg.type === 'user' && !msg.agentId;
          const isAssistant = msg.type === 'assistant' || (msg.type === 'user' && !!msg.agentId);
          const agent = isAssistant && msg.agentId ? resolveAgent(msg.agentId) : undefined;
          const fallback = isAssistant && msg.agentId ? resolveFallbackAgentMeta(msg.agentId) : undefined;
          const className = isOwner ? 'bg-studio-accent' : agent || fallback ? '' : 'bg-gray-400';
          const style = isOwner
            ? undefined
            : agent
              ? { backgroundColor: agentColorVar(agent.id, 'primary') }
              : fallback
                ? { backgroundColor: fallback.color }
                : undefined;

          return (
            <button
              key={`${msg.id}-${sourceIdx}`}
              className={`absolute w-2 h-2 rounded-full -translate-x-1/2 -translate-y-1/2 transition-all duration-150 hover:scale-[2] ${className}`}
              style={{ top: `${top}%`, left: '50%', ...(style ?? {}) }}
              onClick={() => scrollToMessage(msg.id)}
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
              aria-label={`跳转到 ${getSenderName(msg)} 的消息`}
            />
          );
        })}

        {/* Tooltip */}
        {hoveredIdx !== null && sampledItems[hoveredIdx] && (
          <NavTooltip
            message={sampledItems[hoveredIdx].msg}
            topPercent={sampledItems.length <= 1 ? 50 : (hoveredIdx / (sampledItems.length - 1)) * 100}
            ownerName={coCreator.name}
          />
        )}
      </div>
    </div>
  );
}

function NavTooltip({
  message,
  topPercent,
  ownerName,
}: {
  message: ChatMessageData;
  topPercent: number;
  ownerName: string;
}) {
  const { getAgentById } = useAgentData();
  const resolveAgent = useCallback((agentId: string) => resolveAgentById(getAgentById, agentId), [getAgentById]);

  const senderName = useMemo(() => {
    return getSenderLabel(message, resolveAgent, ownerName);
  }, [message, ownerName, resolveAgent]);

  return (
    <div
      className="absolute right-full mr-2 -translate-y-1/2 bg-studio-surface-sunken text-studio text-xs rounded-lg px-2.5 py-1.5 max-w-[200px] pointer-events-none whitespace-nowrap z-50"
      style={{ top: `${topPercent}%` }}
    >
      <div className="font-medium">
        {senderName} · {formatTime(message.timestamp)}
      </div>
      <div className="text-studio-muted truncate mt-0.5">{truncateContent(message.content, 40)}</div>
    </div>
  );
}
