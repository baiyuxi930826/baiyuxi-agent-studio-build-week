'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAgentData } from '@/hooks/useAgentData';
import { apiFetch } from '@/utils/api-client';
import { AgentOverviewTab, type ConfigData } from '../config-viewer-tabs';
import { HubAccountsTab } from '../HubAccountsTab';
import { HubAgentEditor } from '../HubAgentEditor';
import { HubCoCreatorEditor } from '../HubCoCreatorEditor';
import { HubConnectorConfigTab } from '../HubConnectorConfigTab';
import { HubEnvFilesTab } from '../HubEnvFilesTab';
import { PushSettingsPanel } from '../PushSettingsPanel';
import { useConfirm } from '../useConfirm';
import { VoiceSettingsPanel } from '../VoiceSettingsPanel';
import { ConciergeSettingsContent } from './ConciergeSettingsContent';
import { MarketplaceContent } from './MarketplaceContent';
import { McpManageContent } from './McpManageContent';
import { OpsContent } from './OpsContent';
import { PluginsContent } from './PluginsContent';
import { SettingsText } from './primitives';
import { RulesPromptsContent } from './RulesPromptsContent';
import { ServiceStatusPanel } from './ServiceStatusPanel';
import { SettingsPageHeader } from './SettingsPageHeader';
import { SettingsPlaceholder } from './SettingsPlaceholder';
import { SkillsContent } from './SkillsContent';
import { SETTINGS_SECTIONS } from './settings-nav-config';

interface SettingsContentProps {
  section: string;
  initialEditAgentId?: string;
}

export function SettingsContent({ section, initialEditAgentId }: SettingsContentProps) {
  const { agents, refresh } = useAgentData();
  const [config, setConfig] = useState<ConfigData | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<(typeof agents)[number] | null>(null);
  const [createDraft, setCreateDraft] = useState<Parameters<typeof HubAgentEditor>[0]['draft']>(null);
  const [togglingAgentId, setTogglingAgentId] = useState<string | null>(null);
  const [coCreatorEditorOpen, setCoCreatorEditorOpen] = useState(false);
  const confirm = useConfirm();

  const fetchData = useCallback(async () => {
    setFetchError(null);
    try {
      const res = await apiFetch('/api/config');
      if (!res.ok) {
        setFetchError(`配置加载失败 (${res.status})`);
        return;
      }
      const payload = (await res.json()) as { config: ConfigData };
      setConfig(payload.config);
    } catch {
      setFetchError('配置加载失败');
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const consumedDeepLinkRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      initialEditAgentId &&
      section === 'members' &&
      agents.length > 0 &&
      consumedDeepLinkRef.current !== initialEditAgentId
    ) {
      const agent = agents.find((c) => c.id === initialEditAgentId);
      if (agent) {
        consumedDeepLinkRef.current = initialEditAgentId;
        setCreateDraft(null);
        setEditingAgent(agent);
        setEditorOpen(true);
      }
    }
  }, [initialEditAgentId, section, agents]);

  const handleEditorSaved = useCallback(async () => {
    await Promise.all([fetchData(), refresh()]);
  }, [fetchData, refresh]);

  const handleToggleAvailability = useCallback(
    async (agent: (typeof agents)[number]) => {
      setTogglingAgentId(agent.id);
      setFetchError(null);
      try {
        const res = await apiFetch(`/api/agents/${agent.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ available: agent.roster?.available === false }),
        });
        if (!res.ok) {
          const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
          setFetchError((payload.error as string) ?? `成员状态切换失败 (${res.status})`);
          return;
        }
        await Promise.all([fetchData(), refresh()]);
      } catch {
        setFetchError('成员状态切换失败');
      } finally {
        setTogglingAgentId(null);
      }
    },
    [fetchData, refresh],
  );

  const handleDeleteMember = useCallback(
    async (agent: (typeof agents)[number]) => {
      const ok = await confirm({
        title: '删除确认',
        message: `确认删除成员「${agent.displayName}」吗？此操作不可撤销。`,
        variant: 'danger',
        confirmLabel: '删除',
      });
      if (!ok) return;
      setFetchError(null);
      try {
        const res = await apiFetch(`/api/agents/${agent.id}`, { method: 'DELETE' });
        if (!res.ok) {
          const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
          setFetchError((payload.error as string) ?? `删除失败 (${res.status})`);
          return;
        }
        await Promise.all([fetchData(), refresh()]);
      } catch {
        setFetchError('删除失败');
      }
    },
    [confirm, fetchData, refresh],
  );

  if (section === 'marketplace') return <MarketplaceContent />;
  if (section === 'skills') return <SkillsContent />;

  const meta = SETTINGS_SECTIONS.find((item) => item.id === section) ?? SETTINGS_SECTIONS[0];

  const content = (() => {
    switch (meta.id) {
      case 'members':
        if (fetchError)
          return (
            <SettingsText as="p" variant="sm" tone="red">
              {fetchError}
            </SettingsText>
          );
        return config ? (
          <AgentOverviewTab
            config={config}
            agents={agents}
            onAddMember={() => {
              setEditingAgent(null);
              setCreateDraft(null);
              setEditorOpen(true);
            }}
            onEditMember={(agent) => {
              setCreateDraft(null);
              setEditingAgent(agent);
              setEditorOpen(true);
            }}
            onEditCoCreator={() => setCoCreatorEditorOpen(true)}
            onDeleteMember={handleDeleteMember}
            onToggleAvailability={handleToggleAvailability}
            togglingAgentId={togglingAgentId}
          />
        ) : (
          <SettingsText as="p" variant="sm" tone="muted">
            加载中...
          </SettingsText>
        );
      case 'accounts':
        return <HubAccountsTab />;
      case 'im':
        return <HubConnectorConfigTab />;
      case 'voice':
        return (
          <div className="space-y-6">
            <ServiceStatusPanel
              filterFeatures={[
                'voice-input',
                'voice-output',
                'voice-companion',
                'voice-postprocess',
                'meeting-copilot',
                'live-transcript',
              ]}
              title="语音服务"
            />
            <VoiceSettingsPanel />
          </div>
        );
      case 'system':
        return <HubEnvFilesTab excludeCategories={['connector']} />;
      case 'notify':
        return <PushSettingsPanel />;
      case 'ops':
        return <OpsContent />;
      case 'rules':
        return <RulesPromptsContent />;
      case 'mcp':
        return <McpManageContent />;
      case 'plugins':
        return <PluginsContent />;
      case 'concierge':
        return <ConciergeSettingsContent />;
      default:
        return <SettingsPlaceholder section={meta.label} description="此分区即将上线" />;
    }
  })();

  return (
    <>
      <SettingsPageHeader title={meta.label} subtitle={meta.description} />
      {content}
      {editorOpen && (
        <HubAgentEditor
          open
          agent={editingAgent}
          draft={createDraft}
          onClose={() => {
            setEditorOpen(false);
            setEditingAgent(null);
            setCreateDraft(null);
          }}
          onSaved={handleEditorSaved}
        />
      )}
      {coCreatorEditorOpen && config && (
        <HubCoCreatorEditor
          open
          coCreator={config.coCreator}
          onClose={() => setCoCreatorEditorOpen(false)}
          onSaved={handleEditorSaved}
        />
      )}
    </>
  );
}
