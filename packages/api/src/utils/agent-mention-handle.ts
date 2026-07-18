/**
 * Resolve a registered agentId to its primary stable mention handle, and
 * normalise `@agentId` tokens inside free-form text to `@<handle>`.
 *
 * Why this exists (F128):
 *   AgentRouter.parseAllMentions only recognises mentions that match
 *   agentRegistry's configured `mentionPatterns` (e.g. "@砚砚", "@opus46").
 *   Raw agentId tokens like `@agent-rcs85pvn` are NOT in those patterns, so
 *   downstream dispatch can't route on them. When a agent proposes a new
 *   thread it sometimes writes `@agent-rcs85pvn` into `initialMessage`
 *   (carried over from `agent_studio_get_thread_agents` output). Normalising at
 *   the propose boundary lets the persisted message route correctly.
 *
 *   Keeps `preferredAgents` field on the proposal record AS-IS (agentIds are
 *   the right shape for dispatch lookup). Only the human-readable
 *   `initialMessage` text is rewritten so router can identify the mention.
 */

import { agentRegistry } from '@agent-studio/shared';

/**
 * Resolve a registered agentId to its primary stable mention handle (with
 * leading "@"). Returns null if the agentId is not registered or the entry has
 * no mention patterns configured.
 *
 * Example: `agent-rcs85pvn` → `"@砚砚"`
 */
export function primaryMentionHandleForAgentId(agentId: string): string | null {
  const entry = agentRegistry.tryGet(agentId);
  if (!entry) return null;
  const pattern = entry.config.mentionPatterns?.[0];
  if (!pattern) return null;
  return pattern.startsWith('@') ? pattern : `@${pattern}`;
}

/**
 * Replace `@<token>` matches in text with the agent's primary mention handle
 * when the token resolves to a registered agentId. Tokens that don't resolve
 * (e.g. user wrote `@co-creator` or already-stable handles like `@砚砚`) are left
 * untouched.
 *
 * Test seam: callers may pass a custom `resolveHandle` to test without
 * touching the global agentRegistry state.
 */
export function normalizeAgentIdMentionsInText(
  text: string,
  resolveHandle: (token: string) => string | null = primaryMentionHandleForAgentId,
): string {
  // Match @<token> where token starts with a letter and may contain letters,
  // digits, underscore, or hyphen. Hyphen support is what makes `@agent-rcs85pvn`
  // captured as a single token instead of stopping at `@agent`.
  return text.replace(/@([A-Za-z][A-Za-z0-9_-]*)/g, (full, captured: string) => {
    const handle = resolveHandle(captured);
    return handle ?? full;
  });
}
