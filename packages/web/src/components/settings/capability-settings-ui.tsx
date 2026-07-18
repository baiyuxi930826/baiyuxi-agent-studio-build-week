'use client';

import type { MouseEvent } from 'react';
import { useMemo } from 'react';
import type { AgentFamily, CapabilityBoardItem } from '../capability-board-ui';
import { HubIcon } from '../hub-icons';
import { SettingsResourceToggleSwitch } from '../SettingsResourceCard';
import { projectDisplayName } from './useCapabilityState';

const AVATAR_COLORS = ['#C65F3D', '#8B6E5A', '#A0522D', '#7B6B63', '#9B7653', '#6F5946'];

export function avatarColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

export function ToggleSwitch({
  enabled,
  busy,
  onClick,
  title,
  disabled,
}: {
  enabled: boolean;
  busy: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <SettingsResourceToggleSwitch enabled={enabled} busy={busy} onClick={onClick} title={title} disabled={disabled} />
  );
}

export function ProjectSelector({
  resolvedPath,
  knownProjects,
  currentSelection,
  onSwitch,
  alwaysShow,
}: {
  resolvedPath: string;
  knownProjects: string[];
  currentSelection: string | null;
  onSwitch: (path: string | null) => void;
  /** When true, show a read-only project label even when there's only one project */
  alwaysShow?: boolean;
}) {
  const allPaths = useMemo(() => {
    const set = new Set<string>();
    if (resolvedPath) set.add(resolvedPath);
    for (const path of knownProjects) set.add(path);
    return Array.from(set);
  }, [resolvedPath, knownProjects]);

  if (allPaths.length === 0 && !alwaysShow) return null;
  if (allPaths.length <= 1 && !alwaysShow) return null;

  // Single project with alwaysShow: read-only label showing current project
  if (allPaths.length <= 1) {
    const displayPath = allPaths[0] || resolvedPath;
    if (!displayPath) return null;
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="whitespace-nowrap text-studio-muted">项目:</span>
        <code className="min-w-0 flex-1 truncate rounded-lg border border-[var(--console-border-soft)] bg-[var(--console-field-bg)] px-2 py-1.5 text-xs text-studio-secondary">
          {projectDisplayName(displayPath)}
        </code>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      <label htmlFor="cap-project-select" className="whitespace-nowrap text-studio-muted">
        项目:
      </label>
      <select
        id="cap-project-select"
        value={currentSelection ?? ''}
        onChange={(event) => onSwitch(event.target.value || null)}
        className="min-w-0 flex-1 truncate rounded-lg border border-[var(--console-border-soft)] bg-[var(--console-field-bg)] px-2 py-1.5 text-xs text-studio-secondary"
      >
        <option value="">{projectDisplayName(resolvedPath)}</option>
        {allPaths
          .filter((path) => path !== resolvedPath)
          .map((path) => (
            <option key={path} value={path}>
              {projectDisplayName(path)}
            </option>
          ))}
      </select>
    </div>
  );
}

export function PluginManagedLink({ pluginId }: { pluginId: string }) {
  return (
    <a
      href="/settings?s=plugins"
      onClick={(event) => event.stopPropagation()}
      title={`由插件 ${pluginId} 管理，前往插件集成`}
      className="inline-flex h-[30px] shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-studio-muted transition-colors hover:bg-[var(--console-hover-bg)] hover:text-studio-accent"
    >
      <HubIcon name="puzzle" className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">插件管理</span>
    </a>
  );
}

export function PerAgentToggles({
  item,
  agentFamilies,
  toggling,
  onToggle,
  disabled,
}: {
  item: CapabilityBoardItem;
  agentFamilies: AgentFamily[];
  toggling: string | null;
  onToggle: (item: CapabilityBoardItem, enabled: boolean, agentId?: string) => void;
  disabled?: boolean;
}) {
  if (agentFamilies.length === 0 || !item.agents) return null;
  const agentEntries = Object.entries(item.agents);
  if (agentEntries.length === 0) return null;

  return (
    <div className="px-4 pb-3 pt-2">
      <span className="text-micro font-medium uppercase tracking-wider text-studio-muted">按角色开关</span>
      <div className="mt-1.5 space-y-1">
        {agentFamilies.map((family) => {
          const relevantAgents = family.agentIds.filter((agentId) => agentId in item.agents);
          if (relevantAgents.length === 0) return null;
          return (
            <div key={family.id} className="space-y-1">
              {relevantAgents.length > 1 && <span className="text-micro text-studio-muted">{family.name}</span>}
              {relevantAgents.map((agentId) => {
                const enabled = item.agents[agentId] ?? false;
                const busy = toggling === `${item.id}:${agentId}`;
                return (
                  <div key={agentId} className="flex items-center justify-between">
                    <span className="text-xs text-studio-secondary">{agentId}</span>
                    <ToggleSwitch
                      enabled={enabled}
                      busy={busy}
                      disabled={disabled}
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggle(item, !enabled, agentId);
                      }}
                    />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
