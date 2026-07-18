'use client';

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { AgentSelector } from './AgentSelector';

interface ThreadAgentSettingsProps {
  threadId: string;
  currentAgents: string[];
  onSave: (threadId: string, agents: string[]) => void | Promise<void>;
  triggerLabel?: string;
  triggerIcon?: ReactNode;
  triggerClassName?: string;
  triggerRole?: 'menuitem';
}

/**
 * F32-b Phase 3: Inline popover to edit a thread's preferredAgents.
 * Shown as a small icon button; opens AgentSelector in a positioned dropdown.
 */
export function ThreadAgentSettings({
  threadId,
  currentAgents,
  onSave,
  triggerLabel,
  triggerIcon,
  triggerClassName,
  triggerRole,
}: ThreadAgentSettingsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedAgents, setSelectedAgents] = useState<string[]>(currentAgents);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Sync when prop changes (e.g. server-side update)
  useEffect(() => {
    if (!isOpen) setSelectedAgents(currentAgents);
  }, [currentAgents, isOpen]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSelectedAgents(currentAgents); // revert on cancel
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen, currentAgents]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setSaveError(false);
    try {
      await onSave(threadId, selectedAgents);
      setIsOpen(false);
    } catch {
      setSaveError(true);
    } finally {
      setIsSaving(false);
    }
  }, [threadId, selectedAgents, onSave]);

  const hasChanged = JSON.stringify([...selectedAgents].sort()) !== JSON.stringify([...currentAgents].sort());

  /** Fixed position so popover escapes sidebar overflow-y-auto clipping */
  const getPopoverStyle = (): React.CSSProperties => {
    if (!buttonRef.current) return {};
    const rect = buttonRef.current.getBoundingClientRect();
    const width = 256; // 16rem
    return {
      position: 'fixed',
      top: rect.bottom + 4,
      left: Math.max(8, rect.right - width),
      width,
    };
  };

  return (
    <div ref={popoverRef}>
      <button
        ref={buttonRef}
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className={
          triggerClassName ??
          `p-0.5 rounded transition-all ${
            currentAgents.length > 0
              ? 'text-studio-accent'
              : 'opacity-0 group-hover:opacity-100 text-studio-muted hover:text-studio-accent'
          }`
        }
        title="设置默认角色"
        role={triggerRole}
      >
        {triggerLabel ? (
          <>
            {triggerIcon}
            <span>{triggerLabel}</span>
          </>
        ) : (
          <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 1C4.7 1 2 3.2 2 6c0 1.4.7 2.6 1.7 3.5-.1.8-.4 1.6-.9 2.3a.5.5 0 00.4.8c1.2 0 2.3-.5 3.1-1.1.5.1 1.1.2 1.7.2 3.3 0 6-2.2 6-5S11.3 1 8 1z" />
          </svg>
        )}
      </button>
      {isOpen && (
        <div
          style={getPopoverStyle()}
          data-thread-action-popover="true"
          className="bg-studio-surface rounded-lg shadow-lg border border-studio z-50 flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-3 overflow-y-auto max-h-[50vh]">
            <AgentSelector selectedAgents={selectedAgents} onSelectionChange={setSelectedAgents} />
          </div>
          {saveError && <p className="text-micro text-conn-red-text px-3 mt-1">保存失败，请重试</p>}
          <div className="flex items-center justify-between px-3 pb-3 pt-2 border-t border-studio-subtle flex-shrink-0">
            {selectedAgents.length > 0 && (
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
                  setSelectedAgents(currentAgents);
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
    </div>
  );
}
