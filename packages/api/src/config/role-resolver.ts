/**
 * F32-b P4d: Resolve roleId for a agentName.
 * Reads from agentRegistry (.agent-studio/agent-catalog.json).
 */
import { agentRegistry } from '@agent-studio/shared';

export function resolveRoleId(agentName: string): string | undefined {
  return agentRegistry.tryGet(agentName)?.config.roleId;
}
