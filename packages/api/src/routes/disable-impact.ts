/**
 * GET /api/agents/:agentId/disable-impact
 * F182 Phase D — server-side aggregation of active references for a agent
 * (OQ-2: server-side endpoint, no index, thin scan)
 */

import { agentRegistry } from '@agent-studio/shared';
import type { FastifyInstance } from 'fastify';
import type { ITaskStore } from '../domains/agents/services/stores/ports/TaskStore.js';
import { resolveHeaderUserId } from '../utils/request-identity.js';

interface DynamicTaskDefLike {
  id: string;
  templateId: string;
  params: Record<string, unknown>;
  display: { label: string };
  enabled: boolean;
}

interface DynamicTaskStoreLike {
  getAll(): DynamicTaskDefLike[];
}

interface DisableImpactDeps {
  taskStore: ITaskStore;
  dynamicTaskStore?: DynamicTaskStoreLike;
}

async function aggregateActiveReferences(
  agentId: string,
  deps: DisableImpactDeps,
  userId: string,
): Promise<{
  tasks: Array<{ id: string; title: string; status: string; ownerAgentId: string | null; threadId: string }>;
  scheduledTasks: Array<{ id: string; label: string; templateId: string }>;
}> {
  const { taskStore, dynamicTaskStore } = deps;

  const allWork = await taskStore.listByKind('work');
  const tasks = allWork
    .filter((t) => t.ownerAgentId === agentId && t.status !== 'done' && t.userId === userId)
    .map((t) => ({ id: t.id, title: t.title, status: t.status, ownerAgentId: t.ownerAgentId, threadId: t.threadId }));

  const scheduledTasks = dynamicTaskStore
    ? dynamicTaskStore
        .getAll()
        .filter((d) => d.enabled && d.params.targetAgentId === agentId && d.params.triggerUserId === userId)
        .map((d) => ({ id: d.id, label: d.display.label, templateId: d.templateId }))
    : [];

  return { tasks, scheduledTasks };
}

export function registerDisableImpactRoute(app: FastifyInstance, deps: DisableImpactDeps): void {
  app.get<{ Params: { agentId: string } }>('/api/agents/:agentId/disable-impact', async (request, reply) => {
    const { agentId } = request.params;
    if (!agentRegistry.has(agentId)) {
      reply.status(404);
      return { error: `Agent "${agentId}" not found` };
    }
    const userId = resolveHeaderUserId(request);
    if (!userId) {
      reply.status(401);
      return { error: 'Authentication required' };
    }
    return aggregateActiveReferences(agentId, deps, userId);
  });
}
