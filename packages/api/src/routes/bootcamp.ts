import type { FastifyPluginAsync } from 'fastify';
import { runEnvironmentCheck } from '../domains/agents/services/bootcamp/env-check.js';
import { DEFAULT_THREAD_ID, type IThreadStore } from '../domains/agents/services/stores/ports/ThreadStore.js';
import { resolveUserId } from '../utils/request-identity.js';

interface BootcampRoutesOptions {
  threadStore: IThreadStore;
}

export const bootcampRoutes: FastifyPluginAsync<BootcampRoutesOptions> = async (app, opts) => {
  const { threadStore } = opts;

  app.get('/api/bootcamp/env-check', async (request, reply) => {
    const userId = resolveUserId(request);
    if (!userId) {
      reply.status(401);
      return { error: 'Identity required' };
    }
    return runEnvironmentCheck();
  });

  /** Find the user's bootcamp thread (most recent if multiple exist) */
  app.get('/api/bootcamp/thread', async (request, reply) => {
    const userId = resolveUserId(request);
    if (!userId) {
      reply.status(401);
      return { error: 'Identity required' };
    }
    const threads = await threadStore.list(userId);
    const bootcampThreads = threads
      .filter((t) => t.bootcampState && t.id !== DEFAULT_THREAD_ID)
      .sort((a, b) => (b.bootcampState?.startedAt ?? 0) - (a.bootcampState?.startedAt ?? 0));
    const t = bootcampThreads[0];
    if (!t) {
      return { thread: null };
    }
    return {
      thread: {
        id: t.id,
        title: t.title,
        phase: t.bootcampState?.phase,
        completedAt: t.bootcampState?.completedAt,
        startedAt: t.bootcampState?.startedAt,
      },
    };
  });

  /** List all bootcamp threads for the user (F106: multi-bootcamp support) */
  app.get('/api/bootcamp/threads', async (request, reply) => {
    const userId = resolveUserId(request);
    if (!userId) {
      reply.status(401);
      return { error: 'Identity required' };
    }
    const allThreads = await threadStore.list(userId);
    const bootcampThreads = allThreads
      .filter((t) => t.bootcampState && t.id !== DEFAULT_THREAD_ID)
      .sort((a, b) => (b.bootcampState?.startedAt ?? 0) - (a.bootcampState?.startedAt ?? 0));
    return {
      threads: bootcampThreads.map((t) => ({
        id: t.id,
        title: t.title,
        phase: t.bootcampState?.phase,
        completedAt: t.bootcampState?.completedAt,
        startedAt: t.bootcampState?.startedAt,
        selectedTaskId: t.bootcampState?.selectedTaskId,
      })),
    };
  });
};
