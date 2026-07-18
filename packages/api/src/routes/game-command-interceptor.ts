/**
 * Game Command Interceptor (F101)
 *
 * Parses `/game` chat commands and builds the input needed to start a game
 * via GameOrchestrator. This bridges the gap between chat messages and the
 * game lifecycle API.
 */

import type { Seat } from '@agent-studio/shared';

/** Known game types that have engine implementations */
const KNOWN_GAME_TYPES = new Set(['werewolf']);

/** Subcommands that should NOT be treated as game-start commands */
const SUBCOMMANDS = new Set(['status', 'end']);

/** Valid human role values */
const VALID_HUMAN_ROLES = new Set(['player', 'god-view']);

/** Valid board preset player counts (ascending) */
const VALID_PLAYER_COUNTS: readonly number[] = [6, 7, 8, 9, 10, 12];

/** Clamp a number to the nearest valid preset player count */
function clampToPreset(n: number): number {
  if (n <= VALID_PLAYER_COUNTS[0]) return VALID_PLAYER_COUNTS[0];
  if (n >= VALID_PLAYER_COUNTS[VALID_PLAYER_COUNTS.length - 1])
    return VALID_PLAYER_COUNTS[VALID_PLAYER_COUNTS.length - 1];
  // Find nearest valid preset (prefer lower if equidistant)
  let best = VALID_PLAYER_COUNTS[0];
  for (const preset of VALID_PLAYER_COUNTS) {
    if (preset <= n) best = preset;
  }
  return best;
}

/**
 * Filter agentIds to only include IDs present in the allowed whitelist.
 * Deduplicates to prevent same agent filling multiple seats.
 */
export function sanitizeAgentIds(agentIds: string[], allowedIds: readonly string[]): string[] {
  const allowed = new Set(allowedIds);
  const seen = new Set<string>();
  return agentIds.filter((id) => {
    if (!allowed.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export interface ParsedGameCommand {
  gameType: string;
  humanRole: 'player' | 'god-view';
  voiceMode: boolean;
  /** Player count from lobby config; undefined = use default */
  playerCount?: number;
  /** Specific agent IDs from lobby config; undefined = use all agents */
  agentIds?: string[];
}

/**
 * Parse a `/game` command from a chat message.
 * Returns null if the message is not a valid `/game` start command.
 *
 * Format: /game <type> <role> [<playerCount>] [<agentIds>] [voice]
 * Examples:
 *   /game werewolf player
 *   /game werewolf player 9
 *   /game werewolf player 9 opus,sonnet,codex,gpt52,spark,gemini,gemini25,dare
 *   /game werewolf god-view 7 opus,sonnet,codex voice
 */
export function parseGameCommand(content: string): ParsedGameCommand | null {
  const trimmed = content.trim();
  if (!trimmed.toLowerCase().startsWith('/game ') && trimmed.toLowerCase() !== '/game') return null;

  const parts = trimmed.split(/\s+/);
  // Need at least: /game <type> <role>
  if (parts.length < 3) return null;

  const gameType = parts[1]!.toLowerCase();

  // Reject subcommands like /game status, /game end
  if (SUBCOMMANDS.has(gameType)) return null;

  // Reject unknown game types
  if (!KNOWN_GAME_TYPES.has(gameType)) return null;

  const humanRole = parts[2]!.toLowerCase();
  if (!VALID_HUMAN_ROLES.has(humanRole)) return null;

  // Parse remaining parts: [playerCount] [agentIds] [voice]
  let playerCount: number | undefined;
  let agentIds: string[] | undefined;
  let voiceMode = false;

  for (let i = 3; i < parts.length; i++) {
    const part = parts[i]!.toLowerCase();
    if (part === 'voice') {
      voiceMode = true;
    } else if (/^\d+$/.test(part)) {
      playerCount = clampToPreset(parseInt(part, 10));
    } else if (!agentIds) {
      // First non-voice, non-digit token = agentIds (single or comma-separated)
      agentIds = part.split(',').filter(Boolean);
    }
  }

  return {
    gameType,
    humanRole: humanRole as 'player' | 'god-view',
    voiceMode,
    playerCount,
    agentIds,
  };
}

interface BuildSeatsInput {
  humanRole: 'player' | 'god-view' | 'detective';
  userId: string;
  agentIds: readonly string[];
  playerCount: number;
}

/**
 * Build seat assignments for a game.
 *
 * - player mode: P1 = human, P2..Pn = agents
 * - god-view / detective mode: all seats are agents (human observes)
 */
export function buildGameSeats(input: BuildSeatsInput): Seat[] {
  const { humanRole, userId, agentIds, playerCount } = input;

  // Enforce minimum agent count — no seat duplication allowed
  const agentSlotsNeeded = humanRole === 'player' ? playerCount - 1 : playerCount;
  if (agentIds.length < agentSlotsNeeded) {
    throw new Error(
      `Not enough agents: need ${agentSlotsNeeded} but got ${agentIds.length}. Each seat must have a unique actor.`,
    );
  }

  const seats: Seat[] = [];

  if (humanRole === 'player') {
    // P1 = human player
    seats.push({
      seatId: 'P1' as `P${number}`,
      actorType: 'human',
      actorId: userId,
      role: '',
      alive: true,
      properties: {},
    });
    // P2..Pn = AI agents (cycle if needed)
    for (let i = 1; i < playerCount; i++) {
      const agentId = agentIds[(i - 1) % agentIds.length]!;
      seats.push({
        seatId: `P${i + 1}` as `P${number}`,
        actorType: 'agent',
        actorId: agentId,
        role: '',
        alive: true,
        properties: {},
      });
    }
  } else {
    // god-view: all seats are agents
    for (let i = 0; i < playerCount; i++) {
      const agentId = agentIds[i % agentIds.length]!;
      seats.push({
        seatId: `P${i + 1}` as `P${number}`,
        actorType: 'agent',
        actorId: agentId,
        role: '',
        alive: true,
        properties: {},
      });
    }
  }

  return seats;
}
