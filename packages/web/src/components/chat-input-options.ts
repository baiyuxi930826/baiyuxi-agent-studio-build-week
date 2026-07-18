import type { AgentData } from '@/hooks/useAgentData';
import { agentColorVar } from '@/lib/agent-slug';
import { GROUP_MENTION_COLOR } from '@/lib/color-defaults';

export interface AgentOption {
  id: string;
  label: string;
  desc: string;
  insert: string;
  color: string; // CSS color (var or hex) for inline style
  avatar: string;
  /** Group mention (e.g. @thread, @all) — renders group icon instead of agent avatar */
  isGroup?: boolean;
}

/** Static group mention shortcuts — shown at top of autocomplete.
 *  Aligned with backend AgentRouter.parseGroupMentions patterns. */
const STATIC_GROUP_MENTIONS: AgentOption[] = [
  {
    id: 'thread',
    label: '@thread',
    desc: '本帖全体参与角色',
    insert: '@thread ',
    color: GROUP_MENTION_COLOR,
    avatar: '',
    isGroup: true,
  },
  {
    id: 'all',
    label: '@all',
    desc: '全体Agent',
    insert: '@all ',
    color: GROUP_MENTION_COLOR,
    avatar: '',
    isGroup: true,
  },
];

/** Build role-scoped group mention options (e.g. @全体Ethan（任务主控与实现）) from agent data.
 *  Only generates options for roles with 2+ available agents. */
function buildRoleGroupOptions(agents: AgentData[]): AgentOption[] {
  const roleMap = new Map<string, { displayName: string; color: string; count: number }>();
  for (const agent of agents) {
    if (!agent.roleId || !isAvailable(agent)) continue;
    const existing = roleMap.get(agent.roleId);
    if (existing) {
      existing.count++;
    } else {
      roleMap.set(agent.roleId, {
        displayName: agent.roleDisplayName ?? agent.displayName,
        color: agentColorVar(agent.id, 'primary'),
        count: 1,
      });
    }
  }
  return [...roleMap.entries()]
    .filter(([, info]) => info.count >= 2)
    .map(([roleId, info]) => ({
      id: `role:${roleId}`,
      label: `@全体${info.displayName}`,
      desc: `${info.displayName}全体 (${info.count}个)`,
      insert: `@全体${info.displayName} `,
      color: info.color,
      avatar: '',
      isGroup: true,
    }));
}

/** Build @mention autocomplete options from dynamic agent data.
 *  Filters out agents with no mentionPatterns (not routable via @mention). */
/** Format display label with optional variant disambiguation */
function formatAgentLabel(agent: AgentData): string {
  return agent.variantLabel ? `@${agent.displayName} (${agent.variantLabel})` : `@${agent.displayName}`;
}

function isAvailable(agent: AgentData): boolean {
  return agent.roster?.available !== false;
}

export function buildAgentOptions(agents: AgentData[]): AgentOption[] {
  const roleGroups = buildRoleGroupOptions(agents);
  const individuals = agents
    .filter((agent) => agent.mentionPatterns.length > 0 && isAvailable(agent))
    .map((agent) => ({
      id: agent.id,
      label: formatAgentLabel(agent),
      desc: agent.roleDescription,
      insert: `@${agent.mentionPatterns[0].replace(/^@/, '')} `,
      color: agentColorVar(agent.id, 'primary'),
      avatar: agent.avatar,
    }));
  // Group mentions (@thread, @all, @全体xx角色) are low-frequency — put them
  // at the bottom so individual agents occupy the prime visible slots.
  // Users can still reach groups via arrow-up or by typing the filter text.
  return [...individuals, ...STATIC_GROUP_MENTIONS, ...roleGroups];
}

/** Build whisper target options from dynamic agent data.
 *  Includes ALL agents — whisper routing accepts any agentId regardless of mentionPatterns. */
export function buildWhisperOptions(agents: AgentData[]): AgentOption[] {
  return agents.filter(isAvailable).map((agent) => ({
    id: agent.id,
    label: formatAgentLabel(agent),
    desc: agent.roleDescription,
    insert: agent.mentionPatterns.length > 0 ? `@${agent.mentionPatterns[0].replace(/^@/, '')} ` : '',
    color: agent.color.primary,
    avatar: agent.avatar,
  }));
}

/** Layer 1: game list (currently only werewolf) */
export const GAME_LIST = [
  {
    id: 'werewolf',
    label: '狼人杀',
    desc: '经典推理对抗',
  },
] as const;

/** Layer 2: mode options after selecting a game */
export const WEREWOLF_MODES = [
  { id: 'player', label: '玩家模式', desc: '当一名玩家参与', command: '/game werewolf player' },
  { id: 'god-view', label: '上帝视角', desc: '观战所有角色动态', command: '/game werewolf god-view' },
  { id: 'detective', label: '推理模式', desc: '绑定一个角色的视角推理', command: '/game werewolf detective' },
  { id: 'player-voice', label: '玩家模式（语音）', desc: '语音发言+互动', command: '/game werewolf player voice' },
  { id: 'god-view-voice', label: '上帝视角（语音）', desc: '语音观战体验', command: '/game werewolf god-view voice' },
] as const;

export type GameListItem = (typeof GAME_LIST)[number];
export type GameModeItem = (typeof WEREWOLF_MODES)[number];

/** Pure detection — returns menu trigger type from current input, or null. */
export function detectMenuTrigger(
  val: string,
  selectionStart: number,
): { type: 'game' } | { type: 'mention'; start: number; filter: string } | null {
  const trimmed = val.trimStart();
  if (/^\/g(a(m(e( )?)?)?)?$/i.test(trimmed) && trimmed.length <= 6) {
    return { type: 'game' };
  }
  const textBefore = val.slice(0, selectionStart);
  const atIdx = textBefore.lastIndexOf('@');
  if (atIdx >= 0) {
    const fragment = textBefore.slice(atIdx + 1);
    const charBefore = atIdx > 0 ? val[atIdx - 1] : ' ';
    if (/\s/.test(charBefore!) && fragment.length <= 12 && !/\s/.test(fragment)) {
      return { type: 'mention', start: atIdx, filter: fragment };
    }
  }
  return null;
}
