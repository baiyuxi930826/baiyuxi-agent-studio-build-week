'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatAgentName, useAgentData } from '@/hooks/useAgentData';
import { agentColorVar } from '@/lib/agent-slug';
import { useChatStore } from '@/stores/chatStore';
import { apiFetch } from '@/utils/api-client';
import { MemberSessionStrategy } from './MemberSessionStrategy';
import { AgentSelector } from './ThreadSidebar/AgentSelector';

/**
 * KD-5: v1 single-agent mode. When AgentSelector calls back with multiple agents,
 * keep only the newly added one (replacing the old selection).
 * Exported for testability.
 */
export function enforceSingleSelect(newIds: string[], currentIds: string[]): string[] {
  if (newIds.length <= 1) return newIds;
  const added = newIds.find((id) => !currentIds.includes(id));
  return added ? [added] : [newIds[newIds.length - 1]];
}

/**
 * Compute popover position from pill rect, clamping to viewport edges.
 * Exported for testability (P2-2 right-edge clamp).
 */
export function computePopoverPosition(
  pillRect: { bottom: number; left: number },
  viewportWidth: number,
): { top: number; left: number; width: number } {
  const width = 280;
  const rightEdge = pillRect.left + width;
  const left = rightEdge > viewportWidth - 8 ? viewportWidth - width - 8 : Math.max(8, pillRect.left);
  return { top: pillRect.bottom + 6, left, width };
}

interface ThreadAgentPillProps {
  threadId: string;
}

const NO_PREFERRED_AGENTS: string[] = [];

/** F154 Phase B — Shows preferred agent in thread header, click to open AgentSelector popover. */
export function ThreadAgentPill({ threadId }: ThreadAgentPillProps) {
  const threads = useChatStore((s) => s.threads);
  const updateThreadPreferredAgents = useChatStore((s) => s.updateThreadPreferredAgents);
  const { getAgentById } = useAgentData();

  const [isOpen, setIsOpen] = useState(false);
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const pillRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const thread = threads.find((t) => t.id === threadId);
  const preferredAgents: string[] = thread?.preferredAgents ?? NO_PREFERRED_AGENTS;

  // Sync local selection when prop changes or popover closes; clear stale error on reopen
  useEffect(() => {
    if (isOpen) {
      setSaveError(false);
    } else {
      setSelectedAgents(preferredAgents);
    }
  }, [preferredAgents, isOpen]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        popoverRef.current &&
        !popoverRef.current.contains(target) &&
        pillRef.current &&
        !pillRef.current.contains(target)
      ) {
        setIsOpen(false);
        setSelectedAgents(preferredAgents);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen, preferredAgents]);

  // P2-2: Close on resize/scroll (position becomes stale)
  useEffect(() => {
    if (!isOpen) return;
    const close = () => {
      setIsOpen(false);
      setSelectedAgents(preferredAgents);
    };
    const onScroll = (e: Event) => {
      if (popoverRef.current?.contains(e.target as Node)) return;
      close();
    };
    window.addEventListener('resize', close);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [isOpen, preferredAgents]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setSaveError(false);
    try {
      const res = await apiFetch(`/api/threads/${threadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferredAgents: selectedAgents }),
      });
      if (!res.ok) throw new Error('保存失败');
      updateThreadPreferredAgents(threadId, selectedAgents);
      setIsOpen(false);
    } catch {
      setSaveError(true);
    } finally {
      setIsSaving(false);
    }
  }, [threadId, selectedAgents, updateThreadPreferredAgents]);

  // P1-1 KD-5: Enforce single-select when AgentSelector calls back
  const handleSelectionChange = useCallback(
    (ids: string[]) => {
      setSelectedAgents(enforceSingleSelect(ids, selectedAgents));
    },
    [selectedAgents],
  );

  /** Fixed position so popover escapes header overflow clipping (P2-2: right-edge clamp) */
  const getPopoverStyle = (): React.CSSProperties => {
    if (!pillRef.current) return {};
    const rect = pillRef.current.getBoundingClientRect();
    const pos = computePopoverPosition(rect, window.innerWidth);
    return { position: 'fixed', ...pos };
  };

  const agentId = preferredAgents[0];
  const agent = agentId ? getAgentById(agentId) : undefined;

  const hasChanged = JSON.stringify([...selectedAgents].sort()) !== JSON.stringify([...preferredAgents].sort());

  return (
    <>
      <button
        ref={pillRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border transition-colors text-xs ${
          agent
            ? 'border-studio-subtle hover:bg-studio-surface-sunken'
            : 'border-dashed border-studio-muted hover:border-studio-subtle hover:bg-studio-surface-sunken'
        }`}
        data-testid="thread-agent-pill"
      >
        {agent ? (
          <>
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: agentColorVar(agent.id, 'primary') }}
              data-testid="pill-dot"
            />
            <span className="text-studio-secondary font-medium">{formatAgentName(agent)}</span>
          </>
        ) : (
          <span className="text-studio-muted">首选角色</span>
        )}
        <span className="text-studio-muted">▾</span>
      </button>
      {isOpen && (
        <div
          ref={popoverRef}
          style={getPopoverStyle()}
          className="bg-studio-surface rounded-lg shadow-lg border border-studio z-50 flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-3 overflow-y-auto max-h-[50vh]">
            <AgentSelector selectedAgents={selectedAgents} onSelectionChange={handleSelectionChange} />
          </div>
          {/* #921: Per-member session strategy control.
              Uses the persisted preferredAgents (not draft selectedAgents) so that
              strategy toggles don't fire PATCHes for unsaved selections — if
              the user cancels or save fails, no orphan strategy state remains.
              Component self-hides when API returns non-200 (shared default
              thread, system-indexed threads, or any access restriction). */}
          {preferredAgents.length === 1 && <MemberSessionStrategy threadId={threadId} agentId={preferredAgents[0]} />}
          <div className="flex items-center justify-between px-3 pb-3 pt-2 border-t border-studio-subtle flex-shrink-0">
            {saveError && <span className="text-micro text-conn-red-text">保存失败</span>}
            {!saveError && selectedAgents.length > 0 && (
              <button
                onClick={() => setSelectedAgents([])}
                className="text-micro text-studio-muted hover:text-conn-red-text"
              >
                清除
              </button>
            )}
            <div className="flex gap-1.5 ml-auto">
              <button
                onClick={() => {
                  setIsOpen(false);
                  setSelectedAgents(preferredAgents);
                }}
                className="text-xs px-2 py-0.5 rounded text-studio-secondary hover:bg-studio-surface-elevated"
              >
                取消
              </button>
              <button
                onClick={() => void handleSave()}
                disabled={!hasChanged || isSaving}
                className="text-xs px-2 py-0.5 rounded bg-studio-accent text-[var(--studio-surface)] hover:bg-studio-interactive disabled:opacity-40"
              >
                {isSaving ? '...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
