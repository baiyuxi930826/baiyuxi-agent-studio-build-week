import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, parse } from 'node:path';
import type { SignalArticle, SignalArticleStatus, SignalSource } from '@agent-studio/shared';
import { SignalArticleSchema } from '@agent-studio/shared';
import type { SignalPaths } from '../config/signal-paths.js';
import { resolveSignalPaths } from '../config/signal-paths.js';
import type { RawArticle } from '../fetchers/types.js';
import { createSignalArticleId } from './deduplication.js';

interface InboxRecord {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly source: string;
  readonly tier: number;
  readonly fetchedAt: string;
  readonly filePath: string;
}

export interface SignalRedisIndexClient {
  hset(key: string, data: Record<string, string | number>): Promise<number>;
  zadd(key: string, score: string | number, member: string): Promise<number>;
  sadd(key: string, member: string): Promise<number>;
}

export interface ArticleStoreServiceOptions {
  readonly paths?: SignalPaths | undefined;
  readonly redis?: SignalRedisIndexClient | undefined;
}

export interface StoreArticleInput {
  readonly source: SignalSource;
  readonly article: RawArticle;
  readonly articleId?: string | undefined;
  readonly fetchedAt?: string | undefined;
  readonly status?: SignalArticleStatus | undefined;
  readonly tags?: readonly string[] | undefined;
}

function toIsoDateKey(value: string): string {
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  const trimmed = value.trim();
  return trimmed.length >= 10 ? trimmed.slice(0, 10) : new Date().toISOString().slice(0, 10);
}

function toEpochMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

function escapeYamlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function slugifyTitle(title: string): string {
  const normalized = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);

  return normalized.length > 0 ? normalized : 'untitled';
}

function toMarkdown(article: SignalArticle, body: string): string {
  const tagsText = article.tags.length > 0 ? article.tags.map((tag) => `"${escapeYamlString(tag)}"`).join(', ') : '';

  return [
    '---',
    `id: ${article.id}`,
    `title: "${escapeYamlString(article.title)}"`,
    `url: ${article.url}`,
    `source: ${article.source}`,
    `tier: ${article.tier}`,
    `publishedAt: ${article.publishedAt}`,
    `fetchedAt: ${article.fetchedAt}`,
    `status: ${article.status}`,
    `tags: [${tagsText}]`,
    ...(article.summary ? [`summary: "${escapeYamlString(article.summary)}"`] : []),
    '---',
    '',
    `# ${article.title}`,
    '',
    body,
    '',
  ].join('\n');
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveUniqueMarkdownPath(initialPath: string): Promise<string> {
  if (!(await fileExists(initialPath))) {
    return initialPath;
  }

  const parsed = parse(initialPath);
  let index = 1;

  while (true) {
    const candidate = join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`);
    if (!(await fileExists(candidate))) {
      return candidate;
    }
    index += 1;
  }
}

async function readInboxFile(inboxPath: string): Promise<InboxRecord[]> {
  try {
    const raw = await readFile(inboxPath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error(`inbox file is not an array: ${inboxPath}`);
    }
    return parsed as InboxRecord[];
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

export class ArticleStoreService {
  private readonly paths: SignalPaths;
  private readonly redis: SignalRedisIndexClient | undefined;

  constructor(options: ArticleStoreServiceOptions = {}) {
    this.paths = options.paths ?? resolveSignalPaths();
    this.redis = options.redis;
  }

  async store(input: StoreArticleInput): Promise<SignalArticle> {
    const fetchedAt = input.fetchedAt ?? new Date().toISOString();
    const articleId = input.articleId ?? createSignalArticleId(input.article.url);
    const status = input.status ?? 'inbox';
    const tags = input.tags ?? [];

    const publishedDateKey = toIsoDateKey(input.article.publishedAt);
    const fetchedDateKey = toIsoDateKey(fetchedAt);
    const slug = slugifyTitle(input.article.title);
    const sourceDir = join(this.paths.libraryDir, input.source.id);

    await mkdir(sourceDir, { recursive: true });
    await mkdir(this.paths.inboxDir, { recursive: true });

    const markdownPath = await resolveUniqueMarkdownPath(join(sourceDir, `${publishedDateKey}-${slug}.md`));

    const articleRecord = SignalArticleSchema.parse({
      id: articleId,
      url: input.article.url,
      title: input.article.title,
      source: input.source.id,
      tier: input.source.tier,
      publishedAt: input.article.publishedAt,
      fetchedAt,
      status,
      tags: Array.from(tags),
      ...(input.article.summary ? { summary: input.article.summary } : {}),
      filePath: markdownPath,
    }) as SignalArticle;

    const markdownContent = toMarkdown(articleRecord, input.article.content ?? input.article.summary ?? '');
    await writeFile(markdownPath, markdownContent, 'utf-8');

    const inboxPath = join(this.paths.inboxDir, `${fetchedDateKey}.json`);
    const existingInbox = await readInboxFile(inboxPath);
    const nextInbox: InboxRecord[] = [
      ...existingInbox.filter((item) => item.id !== articleRecord.id),
      {
        id: articleRecord.id,
        title: articleRecord.title,
        url: articleRecord.url,
        source: articleRecord.source,
        tier: articleRecord.tier,
        fetchedAt: articleRecord.fetchedAt,
        filePath: articleRecord.filePath,
      },
    ];
    await writeFile(inboxPath, `${JSON.stringify(nextInbox, null, 2)}\n`, 'utf-8');

    if (this.redis) {
      const fetchedAtEpochMs = toEpochMs(articleRecord.fetchedAt);

      await this.redis.hset(`signal:article:${articleRecord.id}`, {
        id: articleRecord.id,
        url: articleRecord.url,
        title: articleRecord.title,
        source: articleRecord.source,
        tier: articleRecord.tier,
        publishedAt: articleRecord.publishedAt,
        fetchedAt: articleRecord.fetchedAt,
        status: articleRecord.status,
        tags: JSON.stringify(articleRecord.tags),
        summary: articleRecord.summary ?? '',
        filePath: articleRecord.filePath,
      });
      await this.redis.zadd('signal:inbox', fetchedAtEpochMs, articleRecord.id);
      await this.redis.zadd(`signal:by-source:${articleRecord.source}`, fetchedAtEpochMs, articleRecord.id);
      await this.redis.sadd(`signal:by-date:${fetchedDateKey}`, articleRecord.id);
    }

    return articleRecord;
  }
}
