import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { resolveSignalPaths } from '../domains/signals/config/sources-loader.js';
import { SignalArticleQueryService } from '../domains/signals/services/article-query-service.js';
import { CollectionService } from '../domains/signals/services/collection-service.js';
import { StudyMetaService } from '../domains/signals/services/study-meta-service.js';
import { resolveUserId } from '../utils/request-identity.js';

const createBodySchema = z.object({
  name: z.string().min(1).max(100),
  articleIds: z.array(z.string()).optional(),
});

const updateBodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  articleIds: z.array(z.string()).optional(),
});

/**
 * Sync studyMeta.collections for affected articles.
 * addCollection/removeCollection are idempotent, so partial failure
 * followed by retry converges to the correct state.
 */
async function syncStudyMetaCollections(
  studyMeta: StudyMetaService,
  articleQuery: SignalArticleQueryService,
  collectionId: string,
  oldArticleIds: readonly string[],
  newArticleIds: readonly string[],
): Promise<void> {
  const added = newArticleIds.filter((id) => !oldArticleIds.includes(id));
  const removed = oldArticleIds.filter((id) => !newArticleIds.includes(id));
  for (const articleId of added) {
    const article = await articleQuery.getArticleById(articleId);
    if (article) await studyMeta.addCollection(articleId, article.filePath, collectionId);
  }
  for (const articleId of removed) {
    const article = await articleQuery.getArticleById(articleId);
    if (article) await studyMeta.removeCollection(articleId, article.filePath, collectionId);
  }
}

export const signalCollectionRoutes: FastifyPluginAsync = async (app) => {
  const collections = new CollectionService();
  const studyMeta = new StudyMetaService();
  const paths = resolveSignalPaths();
  const articleQuery = new SignalArticleQueryService({ paths });

  app.get('/api/signals/collections', async (request, reply) => {
    const userId = resolveUserId(request);
    if (!userId) {
      reply.status(401);
      return { error: 'Identity required' };
    }
    const list = await collections.list();
    return { collections: list };
  });

  app.get('/api/signals/collections/:id', async (request, reply) => {
    const userId = resolveUserId(request);
    if (!userId) {
      reply.status(401);
      return { error: 'Identity required' };
    }
    const params = request.params as { id?: string };
    if (!params.id) {
      reply.status(400);
      return { error: 'Collection id required' };
    }
    const col = await collections.get(params.id);
    if (!col) {
      reply.status(404);
      return { error: 'Collection not found' };
    }
    return { collection: col };
  });

  app.post('/api/signals/collections', async (request, reply) => {
    const userId = resolveUserId(request);
    if (!userId) {
      reply.status(401);
      return { error: 'Identity required' };
    }
    const parsed = createBodySchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: 'Invalid body', details: parsed.error.issues };
    }

    const requestedArticleIds = parsed.data.articleIds ?? [];

    // Create with empty articleIds first (to get ID), then sync meta,
    // then update with real articleIds. If sync fails, collection has
    // empty articleIds (clean) and error propagates — no dirty state.
    const shell = await collections.create(parsed.data.name, []);
    if (requestedArticleIds.length > 0) {
      await syncStudyMetaCollections(studyMeta, articleQuery, shell.id, [], requestedArticleIds);
      const col = await collections.update(shell.id, { articleIds: requestedArticleIds });
      reply.status(201);
      return { collection: col };
    }
    reply.status(201);
    return { collection: shell };
  });

  app.patch('/api/signals/collections/:id', async (request, reply) => {
    const userId = resolveUserId(request);
    if (!userId) {
      reply.status(401);
      return { error: 'Identity required' };
    }
    const params = request.params as { id?: string };
    if (!params.id) {
      reply.status(400);
      return { error: 'Collection id required' };
    }
    const parsed = updateBodySchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: 'Invalid body', details: parsed.error.issues };
    }
    const existing = await collections.get(params.id);
    if (!existing) {
      reply.status(404);
      return { error: 'Collection not found' };
    }

    // Sync studyMeta BEFORE writing collection file.
    // If sync fails, collection file retains old articleIds → retry
    // recomputes correct diff.
    if (parsed.data.articleIds) {
      await syncStudyMetaCollections(
        studyMeta,
        articleQuery,
        params.id,
        [...existing.articleIds],
        [...parsed.data.articleIds],
      );
    }

    const col = await collections.update(params.id, parsed.data);
    if (!col) {
      reply.status(404);
      return { error: 'Collection not found' };
    }
    return { collection: col };
  });

  app.delete('/api/signals/collections/:id', async (request, reply) => {
    const userId = resolveUserId(request);
    if (!userId) {
      reply.status(401);
      return { error: 'Identity required' };
    }
    const params = request.params as { id?: string };
    if (!params.id) {
      reply.status(400);
      return { error: 'Collection id required' };
    }
    const existing = await collections.get(params.id);
    if (!existing) {
      reply.status(404);
      return { error: 'Collection not found' };
    }

    // Sync meta BEFORE deleting collection file.
    // If sync fails, collection file still exists → retry works.
    if (existing.articleIds.length > 0) {
      await syncStudyMetaCollections(studyMeta, articleQuery, params.id, [...existing.articleIds], []);
    }

    const removed = await collections.remove(params.id);
    if (!removed) {
      reply.status(404);
      return { error: 'Collection not found' };
    }
    return { ok: true };
  });
};
