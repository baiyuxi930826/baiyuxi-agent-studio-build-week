import { type DragEvent as ReactDragEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type AgentData, saveAgentOrder } from '@/hooks/useAgentData';
import { sortAgentsByOrder } from '@/lib/sort-agents-by-order';
import { apiFetch } from '@/utils/api-client';
import type { ConfigData } from './config-viewer-types';
import { DefaultAgentSelector } from './DefaultAgentSelector';
import { HubCoCreatorOverviewCard, HubMemberOverviewCard, HubOverviewToolbar } from './HubMemberOverviewCard';
import { BubbleToggle } from './settings/BubbleToggle';
import { SettingsField, SettingsSection, SettingsStatusStrip } from './settings/primitives';

/** Move srcId to the position of targetId within ids. Returns a new array. */
function reorderIds(ids: string[], srcId: string, targetId: string): string[] {
  const withoutSrc = ids.filter((id) => id !== srcId);
  const targetIdx = withoutSrc.indexOf(targetId);
  if (targetIdx < 0) return ids;
  return [...withoutSrc.slice(0, targetIdx), srcId, ...withoutSrc.slice(targetIdx)];
}

export type { AgentConfig, Capabilities, ConfigData, ContextBudget } from './config-viewer-types';

function KV({ label, value }: { label: string; value: string | number | boolean }) {
  const display = typeof value === 'boolean' ? (value ? '是' : '否') : String(value);
  return (
    <SettingsField label={label} inline compact>
      {display}
    </SettingsField>
  );
}

/** Screen 2 summary overview — owner card plus member cards */
export function AgentOverviewTab({
  config,
  agents,
  onAddMember,
  onEditCoCreator,
  onEditMember,
  onDeleteMember,
  onToggleAvailability,
  togglingAgentId,
}: {
  config: ConfigData;
  agents: AgentData[];
  onAddMember?: () => void;
  onEditCoCreator?: () => void;
  onEditMember?: (agent: AgentData) => void;
  onDeleteMember?: (agent: AgentData) => void;
  onToggleAvailability?: (agent: AgentData) => void;
  togglingAgentId?: string | null;
}) {
  // F154 Phase B (AC-B2): Fetch and manage global default agent
  const [defaultAgentId, setDefaultAgentId] = useState<string | null>(null);
  const [defaultAgentLoading, setDefaultAgentLoading] = useState(false);
  const [defaultAgentFetchError, setDefaultAgentFetchError] = useState(false);
  const [defaultAgentSaveError, setDefaultAgentSaveError] = useState<string | null>(null);

  // F166: Local optimistic agent order; null = follow props. Re-sorted against incoming agents.
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragError, setDragError] = useState<string | null>(null);
  const draggingIdRef = useRef<string | null>(null);
  const saveSeqRef = useRef(0);

  const allDisplayAgents = useMemo(
    () => (localOrder ? sortAgentsByOrder(agents, localOrder) : agents),
    [agents, localOrder],
  );
  const displayAgents = useMemo(
    () => allDisplayAgents.filter((c) => c.roster?.available !== false),
    [allDisplayAgents],
  );
  const disabledAgents = useMemo(
    () => allDisplayAgents.filter((c) => c.roster?.available === false),
    [allDisplayAgents],
  );

  const handleDragStart = useCallback((agent: AgentData, event: ReactDragEvent<HTMLElement>) => {
    draggingIdRef.current = agent.id;
    setDraggingId(agent.id);
    event.dataTransfer?.setData('text/plain', agent.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOver = useCallback((_cat: AgentData, event: ReactDragEvent<HTMLElement>) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDragEnd = useCallback(() => {
    draggingIdRef.current = null;
    setDraggingId(null);
  }, []);

  const handleDrop = useCallback(
    async (target: AgentData, event: ReactDragEvent<HTMLElement>) => {
      event.preventDefault();
      const srcId = draggingIdRef.current ?? event.dataTransfer?.getData('text/plain') ?? '';
      draggingIdRef.current = null;
      setDraggingId(null);
      if (!srcId || srcId === target.id) return;
      const currentIds = allDisplayAgents.map((c) => c.id);
      const nextOrder = reorderIds(currentIds, srcId, target.id);
      if (nextOrder.length === 0) return;
      const previous = localOrder;
      const mySeq = ++saveSeqRef.current;
      setLocalOrder(nextOrder);
      setDragError(null);
      try {
        await saveAgentOrder(nextOrder);
      } catch {
        if (saveSeqRef.current === mySeq) {
          setLocalOrder(previous);
          setDragError('排序保存失败，请重试');
        }
      }
    },
    [allDisplayAgents, localOrder],
  );

  const fetchDefaultAgent = useCallback(() => {
    setDefaultAgentFetchError(false);
    apiFetch('/api/config/default-agent')
      .then((r) => r.json())
      .then((data: { agentId: string }) => setDefaultAgentId(data.agentId))
      .catch(() => setDefaultAgentFetchError(true));
  }, []);

  useEffect(() => {
    fetchDefaultAgent();
  }, [fetchDefaultAgent]);

  const handleDefaultAgentSelect = useCallback(
    async (agentId: string) => {
      if (agentId === defaultAgentId) return;
      setDefaultAgentLoading(true);
      setDefaultAgentSaveError(null);
      try {
        const res = await apiFetch('/api/config/default-agent', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId }),
        });
        if (res.ok) {
          const data = (await res.json()) as { warning?: string };
          setDefaultAgentId(agentId);
          if (data.warning) setDefaultAgentSaveError(data.warning);
        } else {
          setDefaultAgentSaveError('保存失败，请重试');
        }
      } catch {
        setDefaultAgentSaveError('网络错误，请重试');
      } finally {
        setDefaultAgentLoading(false);
      }
    },
    [defaultAgentId],
  );

  return (
    <div className="space-y-4">
      <HubOverviewToolbar onAddMember={onAddMember} />
      {/* F154 Phase B: Global default agent selector (AC-B2: always visible, even on error) */}
      <DefaultAgentSelector
        agents={agents.filter((c) => c.roster?.available !== false)}
        currentDefaultAgentId={defaultAgentId ?? ''}
        onSelect={handleDefaultAgentSelect}
        isLoading={defaultAgentLoading}
        fetchError={defaultAgentFetchError}
        saveError={defaultAgentSaveError}
        onRetry={fetchDefaultAgent}
      />
      {config.coCreator ? <HubCoCreatorOverviewCard coCreator={config.coCreator} onEdit={onEditCoCreator} /> : null}
      {dragError ? <SettingsStatusStrip tone="error">{dragError}</SettingsStatusStrip> : null}
      <div className="space-y-3">
        {displayAgents.map((agentData, idx) => (
          <HubMemberOverviewCard
            key={agentData.id}
            agent={agentData}
            configAgent={config.agents[agentData.id]}
            onEdit={onEditMember}
            onDelete={onDeleteMember}
            onToggleAvailability={onToggleAvailability}
            togglingAvailability={togglingAgentId === agentData.id}
            guideTargetId={idx === 0 ? 'agents.first-member' : undefined}
            draggable
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onDragEnd={handleDragEnd}
            isDragging={draggingId === agentData.id}
          />
        ))}
      </div>
      <SettingsStatusStrip tone="muted">按住 ⠿ 拖动卡片可自由排序；点击卡片进入成员配置 →</SettingsStatusStrip>
      {agents.length === 0 && <SettingsStatusStrip tone="muted">未找到成员配置数据</SettingsStatusStrip>}
      {disabledAgents.length > 0 && (
        <div className="space-y-3">
          <SettingsStatusStrip tone="muted">已停用成员</SettingsStatusStrip>
          {disabledAgents.map((agentData) => (
            <HubMemberOverviewCard
              key={agentData.id}
              agent={agentData}
              configAgent={config.agents[agentData.id]}
              onEdit={onEditMember}
              onDelete={onDeleteMember}
              onToggleAvailability={onToggleAvailability}
              togglingAvailability={togglingAgentId === agentData.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function SystemTab({ config, onConfigChange }: { config: ConfigData; onConfigChange?: () => void }) {
  const handleChanged = useCallback(() => onConfigChange?.(), [onConfigChange]);

  return (
    <>
      <SettingsSection title="气泡显示">
        <div className="space-y-1.5">
          <BubbleToggle
            label="Thinking 默认"
            value={config.ui?.bubbleDefaults?.thinking ?? 'collapsed'}
            configKey="ui.bubble.thinking"
            onChanged={handleChanged}
          />
          <BubbleToggle
            label="CLI 气泡默认"
            value={config.ui?.bubbleDefaults?.cliOutput ?? 'collapsed'}
            configKey="ui.bubble.cliOutput"
            onChanged={handleChanged}
          />
        </div>
      </SettingsSection>
      <SettingsSection title="A2A Agent互调">
        <div className="space-y-1.5">
          <KV label="启用" value={config.a2a.enabled} />
          <KV label="最大深度" value={config.a2a.maxDepth} />
        </div>
      </SettingsSection>
      <SettingsSection title="记忆 (F3-lite)">
        <div className="space-y-1.5">
          <KV label="启用" value={config.memory.enabled} />
          <KV label="每线程最大 key 数" value={config.memory.maxKeysPerThread} />
        </div>
      </SettingsSection>
      {config.codexExecution ? (
        <SettingsSection title="Codex 推理执行">
          <div className="space-y-1.5">
            <KV label="Model" value={config.codexExecution.model} />
            <KV label="Auth Mode" value={config.codexExecution.authMode} />
            <KV label="Pass --model Arg" value={config.codexExecution.passModelArg} />
          </div>
        </SettingsSection>
      ) : null}
      <SettingsSection title="治理 & 降级">
        <div className="space-y-1.5">
          <KV label="降级策略启用" value={config.governance.degradationEnabled} />
          <KV label="Done 超时" value={`${config.governance.doneTimeoutMs / 1000}s`} />
          <KV label="Heartbeat 间隔" value={`${config.governance.heartbeatIntervalMs / 1000}s`} />
        </div>
      </SettingsSection>
    </>
  );
}
