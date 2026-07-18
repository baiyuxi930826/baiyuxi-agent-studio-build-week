/**
 * #921: PATCH /api/threads/:id/members/:agentId/session-strategy
 *
 * Expose the per-member session strategy (resume / reborn) that was
 * implemented in PR #834 / #836 but lacked an API surface.
 *
 * GET returns the current strategy (undefined = default resume).
 * PATCH sets or clears it.
 */

import { agentIdSchema } from '@agent-studio/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { canAccessThread, isSharedDefaultThread } from '../domains/guides/guide-state-access.js';
import { resolveHeaderUserId } from '../utils/request-identity.js';

const strategySchema = z.object({
  strategy: z.enum(['resume', 'reborn']).nullable(),
});

export interface ThreadMemberStrategyRouteOptions {
  threadStore: {
    get(id: string): { id: string; createdBy: string } | null | Promise<{ id: string; createdBy: string } | null>;
    updateMemberSessionStrategy(
      threadId: string,
      agentId: string,
      strategy: 'resume' | 'reborn' | null,
    ): void | Promise<void>;
    getMemberSessionStrategy?(
      threadId: string,
      agentId: string,
      userId: string,
    ): 'resume' | 'reborn' | undefined | Promise<'resume' | 'reborn' | undefined>;
  };
}

export const threadMemberStrategyRoutes: FastifyPluginAsync<ThreadMemberStrategyRouteOptions> = async (app, opts) => {
  const { threadStore } = opts;

  // GET /api/threads/:id/members/:agentId/session-strategy
  app.get<{ Params: { id: string; agentId: string } }>(
    '/api/threads/:id/members/:agentId/session-strategy',
    async (request, reply) => {
      const userId = resolveHeaderUserId(request);
      if (!userId) {
        reply.status(401);
        return { error: 'Identity required' };
      }

      const { id, agentId } = request.params;
      const agentParsed = agentIdSchema().safeParse(agentId);
      if (!agentParsed.success) {
        reply.status(400);
        return { error: 'Invalid agentId' };
      }

      const thread = await threadStore.get(id);
      if (!thread) {
        reply.status(404);
        return { error: 'Thread not found' };
      }
      if (!canAccessThread(thread, userId)) {
        reply.status(403);
        return { error: 'Access denied' };
      }
      if (isSharedDefaultThread(thread)) {
        reply.status(400);
        return { error: 'Session strategy is not available on the shared default thread' };
      }

      const current = threadStore.getMemberSessionStrategy
        ? await threadStore.getMemberSessionStrategy(id, agentId, userId)
        : undefined;

      return { threadId: id, agentId, strategy: current ?? 'resume' };
    },
  );

  // PATCH /api/threads/:id/members/:agentId/session-strategy
  app.patch<{ Params: { id: string; agentId: string } }>(
    '/api/threads/:id/members/:agentId/session-strategy',
    async (request, reply) => {
      const userId = resolveHeaderUserId(request);
      if (!userId) {
        reply.status(401);
        return { error: 'Identity required' };
      }

      const { id, agentId } = request.params;
      const agentParsed = agentIdSchema().safeParse(agentId);
      if (!agentParsed.success) {
        reply.status(400);
        return { error: 'Invalid agentId' };
      }

      const parsed = strategySchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400);
        return { error: 'strategy must be "resume", "reborn", or null', details: parsed.error.issues };
      }

      const thread = await threadStore.get(id);
      if (!thread) {
        reply.status(404);
        return { error: 'Thread not found' };
      }
      if (!canAccessThread(thread, userId)) {
        reply.status(403);
        return { error: 'Access denied' };
      }
      // Shared default thread stores strategy by thread+agent only (not per-user),
      // so allowing writes here would leak one user's preference to all others.
      if (isSharedDefaultThread(thread)) {
        reply.status(400);
        return { error: 'Session strategy cannot be set on the shared default thread' };
      }

      await threadStore.updateMemberSessionStrategy(id, agentId, parsed.data.strategy);

      return { ok: true, threadId: id, agentId, strategy: parsed.data.strategy ?? 'resume' };
    },
  );
};
