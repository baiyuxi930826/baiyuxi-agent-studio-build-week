import type { AgentConfig, AgentId } from '@agent-studio/shared';

type HandoffAgentConfig = Pick<AgentConfig, 'displayName' | 'variantLabel'>;

export function formatA2AHandoffAgentLabel(agentId: AgentId | string, config?: HandoffAgentConfig): string {
  const displayName = config?.displayName?.trim() || agentId;
  const qualifier = config?.variantLabel?.trim() || (displayName !== agentId ? agentId : '');
  return qualifier ? `${displayName}(${qualifier})` : displayName;
}

export function formatA2AHandoffContent(
  fromAgentId: AgentId | string,
  toAgentId: AgentId | string,
  fromConfig?: HandoffAgentConfig,
  toConfig?: HandoffAgentConfig,
): string {
  return `${formatA2AHandoffAgentLabel(fromAgentId, fromConfig)} → ${formatA2AHandoffAgentLabel(toAgentId, toConfig)}`;
}
