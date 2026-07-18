import type { AgentConfig } from '@agent-studio/shared';

function trimBinding(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Resolve the bound accountRef for runtime and editor flows.
 *
 * accountRef is authoritative once it has been written into the runtime
 * catalog. Bootstrap/template state must not reinterpret it later.
 */
export function resolveBoundAccountRefForAgent(
  _projectRoot: string,
  _agentId: string,
  agentConfig: AgentConfig | null | undefined,
): string | undefined {
  if (!agentConfig) return undefined;
  return trimBinding(agentConfig.accountRef);
}
