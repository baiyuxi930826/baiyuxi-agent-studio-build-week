import type { AgentId } from './ids.js';

export interface AgentAlternative {
  readonly agentId: AgentId;
  readonly mention: string;
  readonly displayName: string;
  readonly family: string;
}

export type AgentRoutingError =
  | { kind: 'agent_not_found'; mention: string; alternatives: AgentAlternative[] }
  | { kind: 'agent_disabled'; agentId: AgentId; displayName: string; alternatives: AgentAlternative[] };
