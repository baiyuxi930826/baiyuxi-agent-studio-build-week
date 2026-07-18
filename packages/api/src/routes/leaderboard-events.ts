/**
 * F075 Phase C — Event ingestion route
 * POST /api/leaderboard/events — accepts LeaderboardEvent, routes to stores.
 */
import type { LeaderboardEvent } from '@agent-studio/shared';
import type { FastifyPluginAsync } from 'fastify';
import type { AchievementStore } from '../domains/leaderboard/achievement-store.js';
import type { GameStore } from '../domains/leaderboard/game-store.js';
import { resolveUserId } from '../utils/request-identity.js';

const VALID_SOURCES = new Set(['bootcamp', 'chat', 'git', 'game', 'system', 'manual']);
const DEDUP_MAX = 10_000;

export interface LeaderboardEventsOptions {
  gameStore: GameStore;
  achievementStore: AchievementStore;
}

export const leaderboardEventsRoutes: FastifyPluginAsync<LeaderboardEventsOptions> = async (app, opts) => {
  const seen = new Set<string>();

  app.post<{ Body: LeaderboardEvent }>('/api/leaderboard/events', async (req, reply) => {
    const event = req.body;

    if (!event?.eventId || !event.agentId || !event.eventType) {
      return reply.status(400).send({ error: 'Missing required fields: eventId, agentId, eventType' });
    }
    if (!VALID_SOURCES.has(event.source)) {
      return reply.status(400).send({ error: `Invalid source. Use: ${[...VALID_SOURCES].join(', ')}` });
    }

    // Auth first — reject before touching dedup state
    const userId = resolveUserId(req);
    if (!userId) {
      return reply.status(401).send({ error: 'Authentication required' });
    }

    // Dedup by eventId (capped to prevent unbounded growth)
    if (seen.has(event.eventId)) {
      return { status: 'duplicate' as const };
    }
    if (seen.size >= DEDUP_MAX) seen.clear();
    seen.add(event.eventId);

    // Route to stores based on eventType
    if (event.eventType === 'game-result' && event.source === 'game') {
      const payload = event.payload as { game?: string; result?: string; detail?: string };
      if (payload.game && payload.result) {
        opts.gameStore.append({
          game: payload.game,
          agentId: event.agentId,
          result: payload.result as 'win' | 'lose' | 'mvp' | 'shame',
          ...(payload.detail ? { detail: payload.detail } : {}),
          timestamp: Date.parse(event.timestamp) || Date.now(),
        });
      }
    } else if (event.eventType === 'achievement_unlocked') {
      const payload = event.payload as { achievementId?: string };
      if (payload.achievementId) {
        opts.achievementStore.unlock(userId, payload.achievementId);
      }
    }

    return { status: 'ok' as const };
  });
};
