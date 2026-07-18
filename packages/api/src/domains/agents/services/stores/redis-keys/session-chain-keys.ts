/**
 * Redis key patterns for SessionChainStore.
 * F24: Session Chain + Context Health.
 *
 * Note: agent-studio: prefix is auto-added by ioredis keyPrefix.
 * All keys here are bare (without prefix).
 */

export const SessionChainKeys = {
  /** Hash: session record fields */
  detail: (id: string) => `session:${id}`,
  /** Sorted Set: agent+thread session chain (score = seq) */
  chain: (agentId: string, threadId: string) => `session-chain:${agentId}:${threadId}`,
  /** String: agent+thread → active session ID (fast lookup) */
  active: (agentId: string, threadId: string) => `session-active:${agentId}:${threadId}`,
  /** String: CLI session ID → record ID index */
  byCli: (cliSessionId: string) => `session-cli:${cliSessionId}`,
  /**
   * F198 Bug #3: chainKey → record ID index. Stable conversation anchor for
   * bg carrier (`bg:${threadId}:${agentId}`) that survives daemon sessionId
   * rotation. Lets session_init reuse the same record instead of seal+create.
   */
  byChainKey: (chainKey: string) => `session-by-chainkey:${chainKey}`,
};
