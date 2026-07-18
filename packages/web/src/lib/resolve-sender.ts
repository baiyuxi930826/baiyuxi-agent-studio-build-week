/**
 * Unified sender resolution — owner is a first-class member.
 *
 * Replaces the repeated `senderAgentId === null ? coCreator : getAgentById(...)` branching
 * scattered across ReplyPill, ReplyPreviewBar, SummaryCard, MessageNavigator, etc.
 *
 * Usage:
 *   const sender = resolveSender(senderAgentId, getAgentById, coCreator);
 *   // sender.label  → "@宪宪" | "始皇帝" | "@unknown-agent"
 *   // sender.color  → resolved primary color, always non-null
 */

import type { CoCreatorConfig } from '@/components/config-viewer-types';
import type { AgentData } from '@/hooks/useAgentData';
import { CO_CREATOR_COLOR, UNKNOWN_AGENT_COLOR } from '@/lib/color-defaults';

export interface SenderMeta {
  /** Display label: agent name, owner name for user, "@rawId" for unknown */
  label: string;
  /** Resolved primary color — always a valid hex string */
  color: string;
  /** true when sender is the owner (senderAgentId was null) */
  isCoCreator: boolean;
}

/**
 * Resolve any senderAgentId to display metadata.
 *
 * - `null` -> owner (owner is a member too)
 * - known agentId → agent display name + agent color
 * - unknown agentId → raw ID + fallback color
 */
export function resolveSender(
  senderAgentId: string | null,
  getAgentById: (id: string) => AgentData | undefined,
  coCreator: CoCreatorConfig,
): SenderMeta {
  // Co-creator — first-class member, not a "null fallback"
  if (senderAgentId === null) {
    return {
      label: coCreator.name,
      color: coCreator.color?.primary ?? CO_CREATOR_COLOR.primary,
      isCoCreator: true,
    };
  }

  // Known agent
  const agent = getAgentById(senderAgentId);
  if (agent) {
    return {
      label: `@${agent.displayName}`,
      color: agent.color.primary,
      isCoCreator: false,
    };
  }

  // Unknown agent ID
  return {
    label: `@${senderAgentId}`,
    color: UNKNOWN_AGENT_COLOR.primary,
    isCoCreator: false,
  };
}
