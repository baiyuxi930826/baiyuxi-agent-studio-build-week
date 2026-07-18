import type { StudyMeta } from '@agent-studio/shared';
import type { SignalArticleDetail } from './article-query-service.js';
import type { StudyMetaService } from './study-meta-service.js';

/**
 * Evidence pack assembled before a study discussion (R23, Decision #17).
 * "先搜后聊" — search before chat, not magic memory.
 */
export interface EvidencePack {
  readonly articleTitle: string;
  readonly articleContent: string;
  readonly articleNote?: string | undefined;
  readonly linkedThreadIds: readonly string[];
  readonly latestStudyNote?: string | undefined;
}

const MAX_LINKED_THREADS = 3;

export async function assembleEvidencePack(
  article: SignalArticleDetail,
  studyMetaService: StudyMetaService,
): Promise<EvidencePack> {
  const meta: StudyMeta = await studyMetaService.readMeta(article.id, article.filePath);

  const activeThreads = meta.threads
    .filter((t) => !t.stale)
    .sort((a, b) => b.linkedAt.localeCompare(a.linkedAt))
    .slice(0, MAX_LINKED_THREADS);

  const latestNote = meta.artifacts
    .filter((a) => a.kind === 'note' && a.state === 'ready')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  return {
    articleTitle: article.title,
    articleContent: article.content,
    articleNote: article.note,
    linkedThreadIds: activeThreads.map((t) => t.threadId),
    latestStudyNote: latestNote?.filePath,
  };
}
