import type { AgentId } from './ids.js';

export type CallbackPrincipal =
  | {
      kind: 'invocation';
      invocationId: string;
      parentInvocationId?: string;
      threadId: string;
      userId: string;
      agentId: AgentId;
    }
  | {
      kind: 'agent_key';
      agentKeyId: string;
      userId: string;
      agentId: AgentId;
      scope: 'user-bound';
    };
