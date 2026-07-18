/**
 * Callback task routes — MCP post_message 回传的任务更新端点
 */

import type { AgentId } from '@agent-studio/shared';
import { agentRegistry, createAgentId } from '@agent-studio/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { resolveAgentTarget } from '../domains/agents/services/agents/routing/agent-target-resolver.js';
import type { ITaskStore } from '../domains/agents/services/stores/ports/TaskStore.js';
import type { IThreadStore } from '../domains/agents/services/stores/ports/ThreadStore.js';
import type { SocketManager } from '../infrastructure/websocket/index.js';
import { requireCallbackAuth } from './callback-auth-prehandler.js';
import { deriveCallbackActor, resolveScopedThreadId } from './callback-scope-helpers.js';

// F193-E1: shared refine — single source for status-dependent dispatch gate validation.
// dispatched → require both dispatchedThreadId AND dispatchedMessageId (trace IDs).
// not_dispatched → require non-empty reason.
// missing → only system-set (MCP handler), not agent-fillable via MCP schemas.
// Exported for testing — real tests import this, not a copy.
export function refineDispatchGate(gate: {
  status: string;
  dispatchedThreadId?: string;
  dispatchedMessageId?: string;
  reason?: string;
}): boolean {
  if (gate.status === 'dispatched') return !!gate.dispatchedThreadId && !!gate.dispatchedMessageId;
  if (gate.status === 'not_dispatched') return !!gate.reason;
  return true;
}
const REFINE_MSG = 'dispatched requires dispatchedThreadId AND dispatchedMessageId; not_dispatched requires reason.';

const updateDispatchGateSchema = z
  .object({
    status: z.enum(['dispatched', 'not_dispatched']),
    dispatchedThreadId: z.string().optional(),
    dispatchedMessageId: z.string().optional(),
    reason: z.string().optional(),
    decidedAt: z.number().optional(),
  })
  .refine(refineDispatchGate, { message: REFINE_MSG })
  .optional();

/** @internal Exported for contract testing only — not part of public API */
export const updateTaskSchema = z.object({
  taskId: z.string().min(1),
  status: z.enum(['todo', 'doing', 'blocked', 'done']).optional(),
  why: z.string().max(1000).optional(),
  // F193-E1 P1-4: allow patching dispatchGate
  dispatchGate: updateDispatchGateSchema,
});

const suggestedCrossPostSchema = z
  .object({
    type: z.literal('cross_post'),
    threadId: z.string().optional(),
    featureId: z.string().optional(),
    ownerAgentId: z.string().optional(),
    targetAgents: z.array(z.string()).optional(),
    reason: z.string().optional(),
    source: z.enum(['dispatch_gate', 'search_evidence', 'list_recent', 'feat_index']),
  })
  .optional();

// API create accepts 'missing' (system-set by MCP handler) + dispatched/not_dispatched (agent-set).
// Same refine applies to dispatched/not_dispatched; 'missing' passes through (no trace IDs needed).
const dispatchGateSchema = z
  .object({
    status: z.enum(['missing', 'dispatched', 'not_dispatched']),
    dispatchedThreadId: z.string().optional(),
    dispatchedMessageId: z.string().optional(),
    reason: z.string().optional(),
    suggestedAction: suggestedCrossPostSchema,
    decidedAt: z.number().optional(),
  })
  .refine(refineDispatchGate, { message: REFINE_MSG })
  .optional();

/** @internal Exported for contract testing only — not part of public API */
export const createTaskSchema = z.object({
  title: z.string().min(1).max(200),
  why: z.string().max(1000).optional().default(''),
  ownerAgentId: z.string().min(1).optional(),
  // F193 Phase E (dispatch gate)
  relatedFeatureId: z
    .string()
    .regex(/^F\d+$/)
    .optional(),
  detectedFeatureIds: z.array(z.string()).optional(),
  dispatchGate: dispatchGateSchema,
});

const listTasksQuerySchema = z.object({
  threadId: z.string().min(1).optional(),
  agentId: z.string().min(1).optional(),
  status: z.enum(['todo', 'doing', 'blocked', 'done']).optional(),
  kind: z.enum(['work', 'pr_tracking']).optional(),
});

export function registerCallbackTaskRoutes(
  app: FastifyInstance,
  deps: {
    taskStore: ITaskStore;
    socketManager: SocketManager;
    threadStore?: IThreadStore;
  },
): void {
  const { taskStore, socketManager, threadStore } = deps;

  app.post('/api/callbacks/update-task', async (request, reply) => {
    const record = requireCallbackAuth(request, reply);
    if (!record) return;
    const actor = deriveCallbackActor(record);

    const parsed = updateTaskSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: 'Invalid request body', details: parsed.error.issues };
    }

    const { taskId, status, why, dispatchGate } = parsed.data;

    const existing = await taskStore.get(taskId);
    if (!existing) {
      reply.status(404);
      return { error: 'Task not found' };
    }
    if (existing.threadId !== actor.threadId) {
      reply.status(403);
      return { error: 'Task belongs to a different thread' };
    }
    if (existing.ownerAgentId && existing.ownerAgentId !== actor.agentId) {
      reply.status(403);
      return { error: 'Task is owned by another agent' };
    }

    const updateData: Record<string, unknown> = {};
    if (status) updateData.status = status;
    if (why) updateData.why = why;
    // F193-E1 P1-4: allow patching dispatchGate on existing tasks
    if (dispatchGate) updateData.dispatchGate = dispatchGate;

    const updated = await taskStore.update(taskId, updateData);
    if (!updated) {
      reply.status(500);
      return { error: 'Failed to update task' };
    }

    socketManager.broadcastToRoom(`thread:${updated.threadId}`, 'task_updated', updated);
    return { status: 'ok', task: updated };
  });

  // F160: create-task — kind forced to 'work' (KD-4)
  app.post('/api/callbacks/create-task', async (request, reply) => {
    const record = requireCallbackAuth(request, reply);
    if (!record) return;
    const actor = deriveCallbackActor(record);

    const parsed = createTaskSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: 'Invalid request body', details: parsed.error.issues };
    }

    const { title, why, ownerAgentId, relatedFeatureId, detectedFeatureIds, dispatchGate } = parsed.data;

    // F182 AC-C2: B class — validate ownerAgentId is available (contract 400 on disabled)
    let resolvedOwnerAgentId: AgentId | null = null;
    if (ownerAgentId) {
      const resolved = resolveAgentTarget(ownerAgentId);
      if ('error' in resolved) {
        reply.status(400);
        return resolved.error;
      }
      resolvedOwnerAgentId = createAgentId(resolved.ok);
    }

    const task = await taskStore.create({
      threadId: actor.threadId,
      title,
      why: why ?? '',
      createdBy: actor.agentId,
      kind: 'work',
      subjectKey: null,
      ownerAgentId: resolvedOwnerAgentId,
      userId: actor.userId,
      // F193 Phase E (dispatch gate) — pass through to store
      ...(relatedFeatureId ? { relatedFeatureId } : {}),
      ...(detectedFeatureIds?.length ? { detectedFeatureIds } : {}),
      ...(dispatchGate ? { dispatchGate } : {}),
    });

    socketManager.broadcastToRoom(`thread:${task.threadId}`, 'task_created', task);
    reply.status(201);
    return { status: 'ok', task };
  });

  app.get('/api/callbacks/list-tasks', async (request, reply) => {
    const record = requireCallbackAuth(request, reply);
    if (!record) return;
    const actor = deriveCallbackActor(record);

    const parsed = listTasksQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      reply.status(400);
      return { error: 'Invalid request query', details: parsed.error.issues };
    }

    const { threadId, agentId, status, kind } = parsed.data;

    if (agentId && !agentRegistry.has(agentId)) {
      reply.status(400);
      return { error: `Unknown agentId: ${agentId}` };
    }

    let scopedThreadIds: string[] = [];
    if (threadId) {
      const scoped = await resolveScopedThreadId(actor, threadId, {
        threadStore,
        threadStoreMissingError: 'Thread store not configured for cross-thread task query',
        accessDeniedError: 'Thread access denied',
      });
      if (!scoped.ok) {
        reply.status(scoped.statusCode);
        return { error: scoped.error };
      }
      scopedThreadIds = [scoped.threadId];
    } else if (threadStore) {
      const userThreads = await threadStore.list(actor.userId);
      scopedThreadIds = userThreads.map((item) => item.id);
    } else {
      app.log.warn(
        { userId: actor.userId, invocationId: actor.invocationId },
        '[callbacks/list-tasks] threadStore unavailable, falling back to current thread only',
      );
      scopedThreadIds = [actor.threadId];
    }

    const perThreadTasks = await Promise.all(scopedThreadIds.map((id) => taskStore.listByThread(id)));
    let tasks = perThreadTasks.flat();
    if (agentId) tasks = tasks.filter((item) => item.ownerAgentId === agentId);
    if (status) tasks = tasks.filter((item) => item.status === status);
    if (kind) tasks = tasks.filter((item) => item.kind === kind);
    tasks.sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt || b.id.localeCompare(a.id));

    return { tasks };
  });
}
