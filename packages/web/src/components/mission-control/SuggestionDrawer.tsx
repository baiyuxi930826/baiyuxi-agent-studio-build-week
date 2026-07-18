'use client';

import type { BacklogItem, MissionHubSelfClaimScope, ThreadPhase } from '@agent-studio/shared';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { formatAgentName, useAgentData } from '@/hooks/useAgentData';
import { SuggestionDecisionPanel } from './SuggestionDecisionPanel';
import { SuggestionOpenForm } from './SuggestionOpenForm';

interface SuggestionDrawerProps {
  item: BacklogItem | null;
  submitting?: boolean;
  selectedPhase: ThreadPhase;
  selfClaimScopes: Record<string, MissionHubSelfClaimScope>;
  selfClaimPolicyBlocker?: 'once' | 'thread' | null;
  onChangePhase: (phase: ThreadPhase) => void;
  onSuggest: (payload: {
    itemId: string;
    agentId: string;
    why: string;
    plan: string;
    requestedPhase: ThreadPhase;
  }) => Promise<void>;
  onApprove: (payload: { itemId: string; threadPhase: ThreadPhase }) => Promise<void>;
  onReject: (payload: { itemId: string; note?: string }) => Promise<void>;
  onSelfClaim: (payload: {
    itemId: string;
    agentId: string;
    why: string;
    plan: string;
    requestedPhase: ThreadPhase;
  }) => Promise<void>;
  onAcquireLease: (payload: { itemId: string; agentId: string; ttlMs?: number }) => Promise<void>;
  onHeartbeatLease: (payload: { itemId: string; agentId: string; ttlMs?: number }) => Promise<void>;
  onReleaseLease: (payload: { itemId: string; agentId?: string }) => Promise<void>;
  onReclaimLease: (payload: { itemId: string }) => Promise<void>;
}

export function SuggestionDrawer({
  item,
  submitting,
  selectedPhase,
  selfClaimScopes,
  selfClaimPolicyBlocker,
  onChangePhase,
  onSuggest,
  onApprove,
  onReject,
  onSelfClaim,
  onAcquireLease,
  onHeartbeatLease,
  onReleaseLease,
  onReclaimLease,
}: SuggestionDrawerProps) {
  const { agents } = useAgentData();
  const agentOptions = useMemo(
    () =>
      agents.map((agent) => ({
        id: agent.id,
        label:
          !agent.variantLabel && agent.nickname
            ? `${formatAgentName(agent)}（${agent.nickname}）`
            : formatAgentName(agent),
      })),
    [agents],
  );

  const [agentId, setAgentId] = useState('');
  const [why, setWhy] = useState('');
  const [plan, setPlan] = useState('');
  const [rejectNote, setRejectNote] = useState('');
  const [leaseClock, setLeaseClock] = useState(() => Date.now());
  const leaseState = item?.lease?.state;
  const leaseExpiresAt = item?.lease?.expiresAt;
  const itemStatus = item?.status;
  const itemId = item?.id;

  useEffect(() => {
    if (agentOptions.length === 0) {
      if (agentId) setAgentId('');
      return;
    }
    if (!agentId || !agentOptions.some((option) => option.id === agentId)) {
      setAgentId(agentOptions[0].id);
    }
  }, [agentOptions, agentId]);

  useEffect(() => {
    if (!itemId || itemStatus !== 'dispatched' || leaseState !== 'active' || !leaseExpiresAt) {
      return;
    }

    const delayMs = Math.max(0, leaseExpiresAt - Date.now()) + 50;
    const timer = window.setTimeout(() => {
      setLeaseClock(Date.now());
    }, delayMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [itemId, itemStatus, leaseState, leaseExpiresAt]);

  const statusLabel = useMemo(() => {
    if (!item) return '未选择任务';
    if (item.status === 'open') return '待建议领取';
    if (item.status === 'suggested') return '等待 Baiyuxi 决策';
    if (item.status === 'dispatched') return '已派发';
    return '已批准';
  }, [item]);

  const currentSelfClaimScope: MissionHubSelfClaimScope = selfClaimScopes[agentId] ?? 'disabled';
  const canSelfClaim = currentSelfClaimScope !== 'disabled';
  const leaseOwnerAgentId = item?.lease?.ownerAgentId ?? item?.suggestion?.agentId ?? agentId;
  const leaseExpiresAtMs = item?.lease?.expiresAt ?? 0;
  const leaseIsActive = item?.lease?.state === 'active' && leaseExpiresAtMs > leaseClock;
  const leaseExpired = item?.lease?.state === 'active' && leaseExpiresAtMs <= leaseClock;

  if (!item) {
    return (
      <aside className="rounded-2xl bg-[var(--console-card-bg)] p-4 shadow-[0_8px_22px_rgba(43,33,26,0.04)]">
        <h2 className="mb-2 text-sm font-semibold text-studio">Suggestion Detail</h2>
        <p className="text-xs text-studio-secondary">点击左侧卡片查看详情并执行建议领取/批准流程。</p>
      </aside>
    );
  }

  return (
    <aside className="rounded-2xl bg-[var(--console-card-bg)] p-4 shadow-[0_8px_22px_rgba(43,33,26,0.04)]">
      <h2 className="text-sm font-semibold text-studio">Suggestion Detail</h2>
      <p className="mt-1 text-xs text-studio-secondary">状态：{statusLabel}</p>
      <h3 className="mt-3 text-sm font-semibold text-studio">{item.title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-studio-secondary">{item.summary}</p>

      {item.status === 'open' && (
        <div className="mt-4 space-y-2">
          <SuggestionOpenForm
            itemId={item.id}
            agentOptions={agentOptions}
            agentId={agentId}
            why={why}
            plan={plan}
            selectedPhase={selectedPhase}
            submitting={submitting}
            onAgentIdChange={setAgentId}
            onWhyChange={setWhy}
            onPlanChange={setPlan}
            onSubmit={async (payload) => {
              await onSuggest(payload);
              setWhy('');
              setPlan('');
            }}
          />
          <div className="rounded-lg bg-[var(--console-shell-bg)] p-2 text-xs text-studio-secondary">
            <p>
              Self-claim policy：<span className="font-semibold">{currentSelfClaimScope}</span>
            </p>
            {currentSelfClaimScope === 'once' && (
              <p className="mt-1 text-xs text-studio-secondary">once：每个角色只允许一次非幂等自领。</p>
            )}
            {currentSelfClaimScope === 'thread' && (
              <p className="mt-1 text-xs text-studio-secondary">
                thread：同一个角色同一时间只允许一个 active lease 线程。
              </p>
            )}
            {selfClaimPolicyBlocker === 'once' && (
              <p className="mt-1 text-xs text-[var(--mc-status-risk)]" data-testid="mc-self-claim-blocker-once">
                当前阻断原因：once 自领额度已用完。
              </p>
            )}
            {selfClaimPolicyBlocker === 'thread' && (
              <p className="mt-1 text-xs text-[var(--mc-status-risk)]" data-testid="mc-self-claim-blocker-thread">
                当前阻断原因：该角色已有 active lease 线程。
              </p>
            )}
            {canSelfClaim ? (
              <button
                type="button"
                disabled={submitting || !agentId || !why.trim() || !plan.trim()}
                onClick={() =>
                  void onSelfClaim({
                    itemId: item.id,
                    agentId,
                    why: why.trim(),
                    plan: plan.trim(),
                    requestedPhase: selectedPhase,
                  })
                }
                className="mt-2 w-full rounded-lg bg-[var(--console-shell-bg)] px-3 py-2 text-xs font-semibold text-studio hover:bg-[var(--console-hover-bg)] disabled:opacity-40"
                data-testid="mc-self-claim-submit"
              >
                直接自领并派发
              </button>
            ) : (
              <p className="mt-1 text-xs text-studio-secondary">当前策略为 disabled：请走「建议 + 批准」流程。</p>
            )}
          </div>
        </div>
      )}

      {(item.status === 'suggested' || item.status === 'approved') && (
        <SuggestionDecisionPanel
          item={item}
          selectedPhase={selectedPhase}
          rejectNote={rejectNote}
          submitting={submitting}
          onChangePhase={onChangePhase}
          onChangeRejectNote={setRejectNote}
          onApprove={onApprove}
          onReject={onReject}
        />
      )}

      {item.status === 'dispatched' && (
        <div className="mt-4 rounded-lg bg-[var(--mc-status-dispatched-bg)] p-3 text-xs text-[var(--mc-status-dispatched-text)]">
          <p>已派发到 Thread：{item.dispatchedThreadId}</p>
          <p>Phase：{item.dispatchedThreadPhase}</p>
          {item.lease && (
            <div className="mt-2 rounded-lg bg-[var(--mc-status-dispatched-bg)] px-2 py-1.5 text-xs text-[var(--mc-status-dispatched-text)]">
              <p>Lease：{item.lease.state}</p>
              <p>Owner：{item.lease.ownerAgentId}</p>
              <p>ExpiresAt：{new Date(item.lease.expiresAt).toLocaleString()}</p>
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            {!leaseIsActive && !leaseExpired && (
              <button
                type="button"
                disabled={submitting || !leaseOwnerAgentId}
                onClick={() => void onAcquireLease({ itemId: item.id, agentId: leaseOwnerAgentId, ttlMs: 60_000 })}
                className="rounded border border-[var(--mc-status-dispatched-dot)] px-2 py-1 text-xs font-semibold text-[var(--mc-status-dispatched-text)] disabled:opacity-40"
                data-testid="mc-lease-acquire"
              >
                获取 Lease
              </button>
            )}
            {leaseIsActive && (
              <>
                <button
                  type="button"
                  disabled={submitting || !leaseOwnerAgentId}
                  onClick={() => void onHeartbeatLease({ itemId: item.id, agentId: leaseOwnerAgentId, ttlMs: 60_000 })}
                  className="rounded border border-[var(--mc-status-dispatched-dot)] px-2 py-1 text-xs font-semibold text-[var(--mc-status-dispatched-text)] disabled:opacity-40"
                  data-testid="mc-lease-heartbeat"
                >
                  续租 Heartbeat
                </button>
                <button
                  type="button"
                  disabled={submitting || !leaseOwnerAgentId}
                  onClick={() => void onReleaseLease({ itemId: item.id, agentId: leaseOwnerAgentId })}
                  className="rounded bg-[var(--console-shell-bg)] px-2 py-1 text-xs font-semibold text-studio-secondary disabled:opacity-40"
                  data-testid="mc-lease-release"
                >
                  释放 Lease
                </button>
              </>
            )}
            {leaseExpired && (
              <button
                type="button"
                disabled={submitting}
                onClick={() => void onReclaimLease({ itemId: item.id })}
                className="rounded border border-[var(--mc-status-suggested-dot)] px-2 py-1 text-xs font-semibold text-[var(--mc-status-suggested-text)] disabled:opacity-40"
                data-testid="mc-lease-reclaim"
              >
                回收过期 Lease
              </button>
            )}
          </div>
          {item.dispatchedThreadId && (
            <Link
              href={`/thread/${item.dispatchedThreadId}`}
              className="mt-2 inline-flex rounded bg-[var(--studio-text)] px-2 py-1 text-xs font-semibold text-[var(--studio-surface)]"
              data-testid="mc-open-thread-link"
            >
              打开执行 Thread
            </Link>
          )}
        </div>
      )}
    </aside>
  );
}
