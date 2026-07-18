/**
 * Registry exports
 */

export type { AgentRegistryEntry } from './AgentRegistry.js';
export {
  AgentRegistry,
  agentRegistry,
  assertKnownAgentId,
} from './AgentRegistry.js';

export { agentIdSchema } from './agent-id-schema.js';

export { type NormalizeAgentResult, normalizeAgentId } from './normalize-agent-id.js';
