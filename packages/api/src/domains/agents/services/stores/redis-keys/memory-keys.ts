/**
 * Redis key patterns for memory store.
 */

/** Memory hash key pattern: agent-studio:memory:{threadId} */
export function memoryKey(threadId: string): string {
  return `agent-studio:memory:${threadId}`;
}

/** TTL for memory entries: 30 days */
export const MEMORY_TTL_SECONDS = 0; // persistent — set >0 to enable expiry
