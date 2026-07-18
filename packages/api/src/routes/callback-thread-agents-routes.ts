/**
 * GET /api/callbacks/thread-agents — discover agents in a thread via MCP callback auth.
 * Delegates to shared categorizeThreadAgents() (F142). Auth: invocationId + callbackToken.
 */

import { agentRegistry as agentConfigRegistry } from '@agent-studio/shared';
import type { FastifyInstance } from 'fastify';
import { isAgentAvailable } from '../config/agent-config-loader.js';
import type { IThreadStore } from '../domains/agents/services/stores/ports/ThreadStore.js';
import { requireCallbackAuth } from './callback-auth-prehandler.js';
import { categorizeThreadAgents } from './thread-agents-core.js';

interface ThreadAgentsCallbackDeps {
  threadStore: IThreadStore;
  agentRegistry: { getAllEntries(): Map<string, unknown> };
}

export function registerCallbackThreadAgentsRoutes(app: FastifyInstance, deps: ThreadAgentsCallbackDeps): void {
  const { threadStore, agentRegistry } = deps;

  app.get('/api/callbacks/thread-agents', async (request, reply) => {
    const record = requireCallbackAuth(request, reply);
    if (!record) return;

    const threadId = record.threadId;
    if (!threadId) {
      reply.status(400);
      return { error: 'No threadId associated with this invocation' };
    }

    const thread = await threadStore.get(threadId);
    if (!thread) {
      reply.status(404);
      return { error: 'Thread not found' };
    }

    const allAgentConfigs = agentConfigRegistry.getAllConfigs();
    const participantActivity = await threadStore.getParticipantsWithActivity(threadId);
    const result = categorizeThreadAgents({
      participantActivity: participantActivity.map((p) => ({
        agentId: p.agentId as string,
        lastMessageAt: p.lastMessageAt,
        messageCount: p.messageCount,
        lastResponseHealthy: p.lastResponseHealthy,
      })),
      registeredServices: agentRegistry.getAllEntries(),
      allAgentIds: Object.keys(allAgentConfigs),
      getAgentDisplayName: (agentId: string) => allAgentConfigs[agentId]?.displayName ?? agentId,
      isAgentAvailable,
    });

    return {
      threadId,
      ...result,
      routingPolicy: thread.routingPolicy ? `v${thread.routingPolicy.v}` : null,
    };
  });
}
