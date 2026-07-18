/**
 * Redis key patterns for Game Store (F101)
 */
export const GameKeys = {
  /** Hash: full game state */
  detail: (gameId: string) => `game:${gameId}`,
  /** String: maps threadId → active gameId (KD-15: single game per thread) */
  threadActive: (threadId: string) => `game:thread:${threadId}:active`,
  /** Sorted Set: finished games for a thread (score = endedAt timestamp) */
  threadHistory: (threadId: string) => `game:thread:${threadId}:history`,
} as const;
