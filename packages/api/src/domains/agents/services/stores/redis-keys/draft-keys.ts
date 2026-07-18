/**
 * Redis key patterns for streaming draft storage.
 * All keys share the agent-studio: prefix set by the Redis client.
 *
 * Draft keys are scoped by userId for isolation (R1 P1-1).
 */

export const DraftKeys = {
  /** Hash with draft details: draft:{userId}:{threadId}:{invocationId} */
  detail: (userId: string, threadId: string, invocationId: string) => `draft:${userId}:${threadId}:${invocationId}`,

  /** Per-user+thread draft index set: drafts:idx:{userId}:{threadId} */
  index: (userId: string, threadId: string) => `drafts:idx:${userId}:${threadId}`,
} as const;
