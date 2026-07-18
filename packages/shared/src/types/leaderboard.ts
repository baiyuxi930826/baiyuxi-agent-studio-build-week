/**
 * F075 Agent Leaderboard — shared types
 */

/** A agent ranked by a numeric metric */
export interface RankedAgent {
  agentId: string;
  displayName: string;
  count: number;
  rank: number;
}

/** A agent ranked by streak (consecutive days) */
export interface StreakAgent {
  agentId: string;
  displayName: string;
  currentStreak: number;
  maxStreak: number;
  rank: number;
}

export type LeaderboardRange = 'all' | '7d' | '30d';

export interface MentionStats {
  favoriteAgent: RankedAgent[];
  nightOwl: RankedAgent[];
  streak: StreakAgent[];
  chatty: RankedAgent[];
}

export interface WorkStats {
  commits: RankedAgent[];
  reviews: RankedAgent[];
  bugFixes: RankedAgent[];
}

/** Phase B: "笨蛋智能体" entry */
export interface SillyAgentEntry {
  agentId: string;
  displayName: string;
  label: string;
  description: string;
  count: number;
}

export interface SillyStats {
  entries: SillyAgentEntry[];
}

/** Phase B: Game record */
export interface GameRecord {
  id: string;
  game: string;
  agentId: string;
  result: 'win' | 'lose' | 'mvp' | 'shame';
  detail?: string;
  timestamp: number;
}

export type GameRecordInput = Omit<GameRecord, 'id'>;

export interface GameStats {
  agentTeamDrill: { wins: number; mvps: number; topAgent?: RankedAgent };
  whoSpy: { shameCount: number; shameAgent?: RankedAgent };
}

/** Phase C: Achievement badge */
export interface Achievement {
  id: string;
  /** Preferred icon key from the studio SVG set (F056). */
  icon?: string;
  /** Legacy fallback for old records/messages. */
  emoji?: string;
  label: string;
  description: string;
  category: 'cvo' | 'daily';
  unlockedAt?: number;
}

/** Phase C: operator ability level */
export interface CvoLevel {
  level: number;
  title: string;
  description: string;
  progress: number;
  nextTitle?: string;
  needed?: number;
}

/** Phase C: Inbound event from external systems (F087 etc.) */
export interface LeaderboardEvent {
  eventId: string;
  source: 'bootcamp' | 'chat' | 'git' | 'game' | 'system' | 'manual';
  agentId: string;
  eventType: string;
  payload: Record<string, unknown>;
  timestamp: string;
  userId?: string;
}

export interface LeaderboardStatsResponse {
  mentions: MentionStats;
  work: WorkStats;
  range: LeaderboardRange;
  fetchedAt: string;
  silly?: SillyStats;
  games?: GameStats;
  achievements?: Achievement[];
  cvoLevel?: CvoLevel;
}
