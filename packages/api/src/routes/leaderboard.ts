/**
 * F075 — Leaderboard API routes
 */

import type { LeaderboardRange } from '@agent-studio/shared';
import type { FastifyPluginAsync } from 'fastify';
import type { AchievementStore } from '../domains/leaderboard/achievement-store.js';
import type { GameStore } from '../domains/leaderboard/game-store.js';
import { getLeaderboardStats } from '../domains/leaderboard/leaderboard-service.js';
import { resolveUserId } from '../utils/request-identity.js';

export interface LeaderboardRoutesOptions {
  messageStore: {
    getRecent(limit?: number, userId?: string): unknown[] | Promise<unknown[]>;
  };
  gameStore?: GameStore;
  achievementStore?: AchievementStore;
}

export const leaderboardRoutes: FastifyPluginAsync<LeaderboardRoutesOptions> = async (app, opts) => {
  app.get<{ Querystring: { range?: string } }>('/api/leaderboard/stats', async (req, reply) => {
    const range = (req.query.range ?? 'all') as LeaderboardRange;
    if (!['all', '7d', '30d'].includes(range)) {
      return reply.status(400).send({ error: 'Invalid range. Use: all, 7d, 30d' });
    }

    const userId = resolveUserId(req) ?? undefined;
    const stats = await getLeaderboardStats(
      {
        getRecent: async (limit) =>
          (await opts.messageStore.getRecent(
            limit,
            userId,
          )) as unknown as import('../domains/leaderboard/mention-stats.js').MessageLike[],
      },
      range,
      {
        ...(opts.gameStore ? { gameStore: opts.gameStore } : {}),
        ...(opts.achievementStore ? { achievementStore: opts.achievementStore } : {}),
        ...(userId ? { userId } : {}),
      },
    );
    return stats;
  });
};
