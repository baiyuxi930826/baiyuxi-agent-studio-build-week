'use client';

import { useMemo } from 'react';
import { formatAgentName, useAgentData } from '@/hooks/useAgentData';
import { agentColorVar } from '@/lib/agent-slug';
import { AgentTokenUsage } from './AgentTokenUsage';
import type { RightStatusPanelProps } from './RightStatusPanel';
import {
  collectSnapshotActiveAgents,
  deriveActiveAgents,
  modeLabel,
  statusLabel,
  statusTone,
  truncateId,
} from './status-helpers';

interface MobileStatusSheetProps extends RightStatusPanelProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Bottom sheet overlay for mobile/tablet (<lg) showing key status info.
 * Desktop uses the RightStatusPanel sidebar instead.
 */
export function MobileStatusSheet({
  open,
  onClose,
  intentMode,
  targetAgents,
  agentStatuses,
  agentInvocations,
  activeInvocations,
  hasActiveInvocation,
  threadId,
  messageSummary,
}: MobileStatusSheetProps) {
  const { getAgentById } = useAgentData();

  const activeAgents = useMemo(() => {
    const snapshotAgents = collectSnapshotActiveAgents(agentInvocations);
    // F194 Phase Z5 AC-Z15 R7 (cloud Codex P2): 跨 panel coherence — see RightStatusPanel comment.
    return deriveActiveAgents({ targetAgents, snapshotAgents, activeInvocations, hasActiveInvocation, intentMode });
  }, [targetAgents, agentInvocations, activeInvocations, hasActiveInvocation, intentMode]);

  const allParticipants = useMemo(() => {
    return [...new Set([...activeAgents, ...Object.keys(agentInvocations)])];
  }, [activeAgents, agentInvocations]);

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-[var(--console-overlay-backdrop)] z-40 backdrop-blur-sm transition-opacity lg:hidden ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet */}
      <div
        className={`fixed inset-x-0 bottom-0 z-50 bg-studio-surface rounded-t-2xl shadow-2xl transition-transform duration-300 ease-out lg:hidden max-h-[70vh] overflow-y-auto safe-area-bottom ${
          open ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        {/* Handle bar + header */}
        <div className="sticky top-0 bg-studio-surface rounded-t-2xl pt-3 pb-2 px-4 border-b border-studio-subtle z-10">
          <div className="w-10 h-1 bg-studio-surface-sunken rounded-full mx-auto mb-2" />
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-studio-black">状态面板</h2>
            <button
              onClick={onClose}
              className="text-studio-muted hover:text-studio-secondary p-1 -mr-1"
              aria-label="关闭状态面板"
            >
              <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>
          <p className="text-xs text-studio-secondary mt-1">
            当前模式: <span className="font-medium">{modeLabel(intentMode)}</span>
          </p>
        </div>

        <div className="p-4 space-y-3">
          {/* ── Agent status ── */}
          <section className="rounded-lg bg-studio-surface-elevated/70 p-3">
            <h3 className="text-xs font-semibold text-studio-secondary mb-2">
              {activeAgents.length > 0 ? '当前调用' : '角色状态'}
            </h3>
            {activeAgents.length > 0 ? (
              <div className="space-y-2">
                {activeAgents.map((agentId) => {
                  const agent = getAgentById(agentId);
                  const dotColor = agentColorVar(agentId, 'primary');
                  const status = agentStatuses[agentId] ?? 'pending';
                  const inv = agentInvocations[agentId];
                  return (
                    <div key={agentId}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-block h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: dotColor }}
                          />
                          <span className="text-xs text-studio-secondary">
                            {agent ? formatAgentName(agent) : agentId}
                          </span>
                        </div>
                        <span className={`text-xs font-medium ${statusTone(status)}`}>{statusLabel(status)}</span>
                      </div>
                      {inv?.usage && (
                        <div className="ml-3.5 mt-1">
                          <AgentTokenUsage agentId={agentId} usage={inv.usage} contextHealth={inv.contextHealth} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : allParticipants.length > 0 ? (
              <div className="space-y-1.5">
                {allParticipants.map((agentId) => {
                  const agent = getAgentById(agentId);
                  return (
                    <div key={agentId} className="flex items-center gap-2 text-xs text-studio-secondary">
                      <span
                        className="inline-block h-2 w-2 rounded-full opacity-60"
                        style={{ backgroundColor: agentColorVar(agentId, 'primary') }}
                      />
                      {agent ? formatAgentName(agent) : agentId}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-xs text-studio-muted">空闲</div>
            )}
          </section>

          {/* ── Message stats ── */}
          <section className="rounded-lg bg-studio-surface-elevated/70 p-3">
            <h3 className="text-xs font-semibold text-studio-secondary mb-2">消息统计</h3>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-studio-secondary">
              <div>总数</div>
              <div className="text-right font-medium">{messageSummary.total}</div>
              <div>Agent 消息</div>
              <div className="text-right font-medium">{messageSummary.assistant}</div>
              <div>系统消息</div>
              <div className="text-right font-medium">{messageSummary.system}</div>
            </div>
          </section>

          {/* ── Thread info ── */}
          <section className="rounded-lg bg-studio-surface-elevated/70 p-3">
            <h3 className="text-xs font-semibold text-studio-secondary mb-2">对话信息</h3>
            <div className="text-xs text-studio-secondary">
              Thread:{' '}
              <button
                className="text-studio-secondary font-mono hover:text-studio transition-colors"
                title={`点击复制: ${threadId}`}
                onClick={() => {
                  void navigator.clipboard.writeText(threadId);
                }}
              >
                {truncateId(threadId, 16)}
              </button>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
