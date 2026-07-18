/**
 * F085 Phase 4+5 — Brake Routes
 * POST /api/brake/checkin    — handle user check-in response
 * GET  /api/brake/state      — debug: view current brake state
 * GET  /api/brake/settings   — read user brake settings
 * PUT  /api/brake/settings   — update user brake settings
 */

import type { BrakeCheckinRequest, BrakeSettings } from '@agent-studio/shared';
import type { FastifyPluginAsync } from 'fastify';
import type { ActivityTracker } from '../domains/health/ActivityTracker.js';
import { resolveUserId } from '../utils/request-identity.js';

export interface BrakeRoutesOptions {
  activityTracker: ActivityTracker;
}

export const brakeRoutes: FastifyPluginAsync<BrakeRoutesOptions> = async (app, opts) => {
  const { activityTracker } = opts;

  app.post<{ Body: BrakeCheckinRequest }>('/api/brake/checkin', async (request, reply) => {
    const userId = resolveUserId(request);
    if (!userId) {
      reply.status(401);
      return { error: 'Identity required' };
    }

    const body = request.body as BrakeCheckinRequest;
    if (!body?.choice || !['rest', 'wrap_up', 'continue'].includes(body.choice)) {
      reply.status(400);
      return { error: 'Invalid choice. Must be rest, wrap_up, or continue.' };
    }
    if (body.choice === 'continue' && !body.reason?.trim()) {
      reply.status(400);
      return { error: 'Reason required when choosing continue.' };
    }

    const result = activityTracker.handleCheckin(userId, body.choice, body.reason);
    return result;
  });

  app.get('/api/brake/state', async (request) => {
    const userId = resolveUserId(request, { defaultUserId: 'default-user' });
    return activityTracker.getState(userId ?? 'default-user');
  });

  app.get('/api/brake/settings', async (request) => {
    const userId = resolveUserId(request, { defaultUserId: 'default-user' });
    return activityTracker.getSettings(userId ?? 'default-user');
  });

  app.put<{ Body: Partial<BrakeSettings> }>('/api/brake/settings', async (request, reply) => {
    const userId = resolveUserId(request);
    if (!userId) {
      reply.status(401);
      return { error: 'Identity required' };
    }
    const result = activityTracker.updateSettings(userId, request.body ?? {});
    if ('error' in result) {
      reply.status(400);
      return result;
    }
    return result;
  });
};
