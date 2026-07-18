/**
 * Werewolf Role Definitions (F101)
 *
 * All standard roles with faction, description, and night action phase.
 */

export interface WerewolfRole {
  name: string;
  faction: 'wolf' | 'village';
  description: string;
  nightActionPhase?: string;
}

export const WEREWOLF_ROLES: Record<string, WerewolfRole> = {
  wolf: {
    name: 'wolf',
    faction: 'wolf',
    description: '每晚合议杀一名玩家',
    nightActionPhase: 'night_wolf',
  },
  seer: {
    name: 'seer',
    faction: 'village',
    description: '每晚查验一名玩家的身份',
    nightActionPhase: 'night_seer',
  },
  witch: {
    name: 'witch',
    faction: 'village',
    description: '持有解药（救人）和毒药（毒人）各一瓶',
    nightActionPhase: 'night_witch',
  },
  hunter: {
    name: 'hunter',
    faction: 'village',
    description: '被狼刀死时可开枪带走一人（毒死不可）',
  },
  guard: {
    name: 'guard',
    faction: 'village',
    description: '每晚守护一名玩家，不能连续两晚守同一人',
    nightActionPhase: 'night_guard',
  },
  idiot: {
    name: 'idiot',
    faction: 'village',
    description: '被投票放逐时翻牌存活，但失去投票权',
  },
  villager: {
    name: 'villager',
    faction: 'village',
    description: '普通村民，白天投票放逐',
  },
};
