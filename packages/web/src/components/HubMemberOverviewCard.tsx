import type { DragEvent as ReactDragEvent } from 'react';
import type { AgentData } from '@/hooks/useAgentData';
import { CO_CREATOR_COLOR } from '@/lib/color-defaults';
import { AvatarImageWithFallback } from './AvatarImageWithFallback';
import type { AgentConfig, CoCreatorConfig } from './config-viewer-types';
import { HubIcon } from './hub-icons';
import { SettingsResourceIconButton, SettingsResourceToggleSwitch } from './SettingsResourceCard';
import {
  SettingsBadge,
  SettingsFilterTabs,
  SettingsPrimaryButton,
  SettingsRow,
  SettingsStatusStrip,
  SettingsText,
} from './settings/primitives';

function safeAvatarSrc(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('/uploads/') || trimmed.startsWith('/avatars/')) return trimmed;
  return null;
}

function humanizeClientId(clientId: string) {
  if (clientId === 'openai') return 'OpenAI';
  if (clientId === 'anthropic') return 'Anthropic';
  if (clientId === 'google') return 'Gemini';
  if (clientId === 'dare') return 'Dare';
  if (clientId === 'opencode') return 'OpenCode';
  if (clientId === 'antigravity') return 'Antigravity';
  return clientId;
}

function clientRuntimeLabel(agent: AgentData, configAgent?: AgentConfig) {
  const accountRef = (agent.accountRef ?? '').toLowerCase();
  if (accountRef.includes('claude')) return 'Claude';
  if (accountRef.includes('codex')) return 'Codex';
  if (accountRef.includes('gemini')) return 'Gemini';
  if (accountRef.includes('kimi') || accountRef.includes('moonshot')) return 'Kimi';
  if (accountRef.includes('opencode')) return 'OpenCode';
  if (accountRef.includes('dare')) return 'Dare';
  if (agent.clientId === 'antigravity') return 'Antigravity';
  if (agent.clientId === 'openai') return 'OpenAI-Compatible';
  return humanizeClientId(configAgent?.clientId ?? agent.clientId);
}

function accountSummary(agent: AgentData) {
  const accountRef = agent.accountRef?.trim() ?? '';
  if (!accountRef) return humanizeClientId(agent.clientId);
  if (
    accountRef === 'claude' ||
    accountRef === 'codex' ||
    accountRef === 'gemini' ||
    accountRef === 'kimi' ||
    accountRef === 'dare' ||
    accountRef === 'opencode'
  ) {
    return 'CLI（OAuth）账号';
  }
  return `CLI（配置） · ${accountRef}`;
}

function getMetaSummary(agent: AgentData, configAgent?: AgentConfig) {
  if (agent.clientId === 'antigravity') {
    return `Antigravity · ${configAgent?.model ?? agent.defaultModel} · CLI Bridge`;
  }
  return `${clientRuntimeLabel(agent, configAgent)} · ${configAgent?.model ?? agent.defaultModel} · ${accountSummary(agent)}`;
}

function getStatusBadge(agent: AgentData): { enabled: boolean; label: string; tone: 'emerald' | 'slate' } {
  if (agent.roster?.available === false) {
    return { enabled: false, label: '已停用', tone: 'slate' };
  }
  return { enabled: true, label: '已启用', tone: 'emerald' };
}

function formatMentionPreview(patterns: string[], max = 3) {
  const visible = patterns.slice(0, max);
  const rest = patterns.length - visible.length;
  return rest > 0 ? `${visible.join('')}  +${rest}` : visible.join('');
}

function OwnerBadge() {
  return (
    <SettingsBadge tone="amber" className="inline-flex items-center gap-1">
      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"
        />
      </svg>
      Owner
    </SettingsBadge>
  );
}

// F206 exempt: coCreator config default colors — data-driven, not UI theme
function OwnerAvatar({ coCreator }: { coCreator: CoCreatorConfig }) {
  const primary = coCreator.color?.primary ?? CO_CREATOR_COLOR.primary;
  const avatarSrc = safeAvatarSrc(coCreator.avatar);
  return (
    <div
      className="flex h-8 w-8 items-center justify-center overflow-hidden text-xs font-bold"
      style={{ backgroundColor: primary, color: 'var(--studio-surface)', borderRadius: '9999px' }}
    >
      {avatarSrc ? (
        <AvatarImageWithFallback
          src={avatarSrc}
          alt={`${coCreator.name} avatar`}
          className="h-full w-full object-cover"
        />
      ) : (
        'ME'
      )}
    </div>
  );
}

export function HubCoCreatorOverviewCard({ coCreator, onEdit }: { coCreator: CoCreatorConfig; onEdit?: () => void }) {
  const primary = coCreator.color?.primary ?? CO_CREATOR_COLOR.primary;
  return (
    <SettingsRow
      icon={<OwnerAvatar coCreator={coCreator} />}
      title={coCreator.name}
      meta={
        <>
          <span>别名: {coCreator.aliases.join(' · ') || '无'} · 只能编辑，不能新增或删除</span>
          <span className="mt-0.5 block" style={{ color: primary }}>
            {formatMentionPreview(coCreator.mentionPatterns, 2)}
          </span>
        </>
      }
      badges={<OwnerBadge />}
      onClick={onEdit}
    />
  );
}

const MEMBER_FILTER_TABS = [
  { key: '全部', label: '全部' },
  { key: '已启用', label: '已启用' },
  { key: '已停用', label: '已停用' },
  { key: 'oauth', label: 'CLI（OAuth）' },
  { key: 'api_key', label: 'CLI（配置）' },
];

export function HubOverviewToolbar({
  onAddMember,
  activeFilter,
  onFilterChange,
}: {
  onAddMember?: () => void;
  activeFilter?: string;
  onFilterChange?: (key: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      {onFilterChange ? (
        <SettingsFilterTabs tabs={MEMBER_FILTER_TABS} activeKey={activeFilter ?? '全部'} onTabChange={onFilterChange} />
      ) : (
        <SettingsStatusStrip tone="muted">全部 · 已启用 · 已停用 · CLI（OAuth） · CLI（配置）</SettingsStatusStrip>
      )}
      {onAddMember && (
        <SettingsPrimaryButton
          onClick={onAddMember}
          data-bootcamp-step="add-member-button"
          data-guide-id="agents.add-member"
        >
          + 添加成员
        </SettingsPrimaryButton>
      )}
    </div>
  );
}

function AvailabilityToggle({
  agent,
  enabled,
  onToggle,
  busy,
}: {
  agent: AgentData;
  enabled: boolean;
  onToggle?: (agent: AgentData) => void;
  busy: boolean;
}) {
  if (!onToggle) return null;
  const label = enabled ? '停用成员' : '启用成员';
  return (
    <SettingsResourceToggleSwitch
      enabled={enabled}
      busy={busy}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(agent);
      }}
      title={`${label}：${agent.displayName}`}
      ariaLabel={`${label}：${agent.displayName}`}
    />
  );
}

function MemberMeta({ agent, configAgent }: { agent: AgentData; configAgent?: AgentConfig }) {
  const sessionChainEnabled = agent.sessionChain !== false;
  return (
    <>
      <span>
        {getMetaSummary(agent, configAgent)}
        {agent.adapterMode && (
          <SettingsBadge
            tone={agent.adapterMode === 'acp' ? 'emerald' : 'slate'}
            size="xxs"
            className="ml-1.5 inline-block"
          >
            {agent.adapterMode.toUpperCase()}
          </SettingsBadge>
        )}
      </span>
      <span className="mt-0.5 flex flex-wrap items-center gap-2">
        <SettingsText tone="purple">{formatMentionPreview(agent.mentionPatterns)}</SettingsText>
        <SettingsBadge tone={sessionChainEnabled ? 'emerald' : 'slate'}>
          {sessionChainEnabled ? 'Session Chain 已开启' : 'Session Chain 未开启'}
        </SettingsBadge>
      </span>
    </>
  );
}

export function HubMemberOverviewCard({
  agent,
  configAgent,
  onEdit,
  onToggleAvailability,
  onDelete,
  togglingAvailability = false,
  draggable = false,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  isDragging = false,
  guideTargetId,
}: {
  agent: AgentData;
  configAgent?: AgentConfig;
  onEdit?: (agent: AgentData) => void;
  onToggleAvailability?: (agent: AgentData) => void;
  onDelete?: (agent: AgentData) => void;
  togglingAvailability?: boolean;
  draggable?: boolean;
  onDragStart?: (agent: AgentData, event: ReactDragEvent<HTMLElement>) => void;
  onDragOver?: (agent: AgentData, event: ReactDragEvent<HTMLElement>) => void;
  onDrop?: (agent: AgentData, event: ReactDragEvent<HTMLElement>) => void;
  onDragEnd?: (agent: AgentData, event: ReactDragEvent<HTMLElement>) => void;
  isDragging?: boolean;
  guideTargetId?: string;
}) {
  const status = getStatusBadge(agent);
  const title = [agent.roleDisplayName ?? agent.displayName, agent.nickname].filter(Boolean).join(' · ');

  return (
    <SettingsRow
      data-testid={`agent-card-${agent.id}`}
      data-guide-id={guideTargetId}
      draggable={draggable}
      onDragStart={draggable ? (event) => onDragStart?.(agent, event) : undefined}
      onDragOver={draggable ? (event) => onDragOver?.(agent, event) : undefined}
      onDrop={draggable ? (event) => onDrop?.(agent, event) : undefined}
      onDragEnd={draggable ? (event) => onDragEnd?.(agent, event) : undefined}
      onClick={() => onEdit?.(agent)}
      isDragging={isDragging}
      dragHandle={
        draggable ? (
          <span aria-hidden="true" title="拖动排序" className="select-none leading-none text-lg">
            ⠿
          </span>
        ) : undefined
      }
      title={title}
      meta={<MemberMeta agent={agent} configAgent={configAgent} />}
      badges={<SettingsBadge tone={status.tone}>{status.label}</SettingsBadge>}
      actions={
        <>
          <AvailabilityToggle
            agent={agent}
            enabled={status.enabled}
            onToggle={onToggleAvailability}
            busy={togglingAvailability}
          />
          {onDelete && (
            <SettingsResourceIconButton
              tone="danger"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(agent);
              }}
              title="删除成员"
              aria-label="删除成员"
            >
              <HubIcon name="trash" className="h-3.5 w-3.5" />
            </SettingsResourceIconButton>
          )}
        </>
      }
      tone={status.enabled ? 'active' : 'inactive'}
    />
  );
}
