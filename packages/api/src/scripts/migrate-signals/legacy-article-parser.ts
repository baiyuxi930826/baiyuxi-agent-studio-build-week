import { readdir, readFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import type { SignalArticleStatus, SignalTier } from '@agent-studio/shared';
import { parse as parseYaml } from 'yaml';
import { asRecord, exists, normalizeDate, pickNumber, pickString } from './shared.js';

export interface LegacyArticle {
  readonly filePath: string;
  readonly folderName: string;
  readonly id?: string | undefined;
  readonly title: string;
  readonly url: string;
  readonly sourceLabel?: string | undefined;
  readonly tier?: SignalTier | undefined;
  readonly publishedAt: string;
  readonly fetchedAt: string;
  readonly status: SignalArticleStatus;
  readonly tags: readonly string[];
  readonly summary?: string | undefined;
  readonly content: string;
}

export interface ParseLegacyArticlesOptions {
  readonly onSkipMalformed?: ((input: { readonly filePath: string; readonly reason: string }) => void) | undefined;
}

function normalizeStatus(value: string | undefined): SignalArticleStatus {
  const normalized = (value ?? '').toLowerCase();
  if (normalized === 'read') return 'read';
  if (normalized === 'archived') return 'archived';
  if (normalized === 'starred') return 'starred';
  return 'inbox';
}

function splitFrontmatter(rawMarkdown: string): {
  readonly frontmatter: Record<string, unknown>;
  readonly content: string;
} {
  const normalized = rawMarkdown.replace(/\r\n/g, '\n');
  const hasFrontmatterOpening = normalized.startsWith('---\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) {
    if (hasFrontmatterOpening) {
      throw new Error('unterminated frontmatter');
    }
    return { frontmatter: {}, content: normalized.trim() };
  }

  return {
    frontmatter: asRecord(parseYaml(match[1] ?? '')) ?? {},
    content: normalized.slice(match[0].length).trim(),
  };
}

function extractDatePrefixFromFilename(filePath: string): string | undefined {
  const name = basename(filePath, '.md');
  const hyphenated = name.match(/^(\d{4}-\d{2}-\d{2})(?:$|[-_])/);
  if (hyphenated) return hyphenated[1];

  const compact = name.match(/^(\d{8})(?:$|[-_])/);
  if (compact) return compact[1];

  return undefined;
}

async function collectMarkdownFiles(root: string): Promise<string[]> {
  if (!(await exists(root))) return [];

  const queue = [root];
  const files: string[] = [];

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) continue;

    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
      } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') {
        files.push(fullPath);
      }
    }
  }

  return files;
}

export async function parseLegacyArticles(
  libraryDir: string,
  options: ParseLegacyArticlesOptions = {},
): Promise<LegacyArticle[]> {
  const files = await collectMarkdownFiles(libraryDir);
  const fallbackNow = new Date().toISOString();
  const articles: LegacyArticle[] = [];

  for (const filePath of files) {
    try {
      const folderName = basename(resolve(filePath, '..'));
      const raw = await readFile(filePath, 'utf-8');
      const { frontmatter, content } = splitFrontmatter(raw);

      const url = pickString(frontmatter, ['url', 'link']);
      if (!url) continue;

      const title = pickString(frontmatter, ['title']) ?? basename(filePath, '.md');
      const publishedAt = normalizeDate(
        pickString(frontmatter, ['publishedAt', 'published', 'date']),
        normalizeDate(extractDatePrefixFromFilename(filePath), fallbackNow),
      );
      const fetchedAt = normalizeDate(pickString(frontmatter, ['fetchedAt', 'captured']), publishedAt);
      const tierNumber = pickNumber(frontmatter, 'tier');
      const tagsValue = frontmatter.tags;

      articles.push({
        filePath,
        folderName,
        id: pickString(frontmatter, ['id']),
        title,
        url,
        sourceLabel: pickString(frontmatter, ['source']),
        ...(tierNumber && tierNumber >= 1 && tierNumber <= 4 ? { tier: tierNumber as SignalTier } : {}),
        publishedAt,
        fetchedAt,
        status: normalizeStatus(pickString(frontmatter, ['status'])),
        tags: Array.isArray(tagsValue) ? tagsValue.filter((v) => typeof v === 'string').map((v) => v.trim()) : [],
        summary: pickString(frontmatter, ['summary']),
        content,
      });
    } catch (error) {
      options.onSkipMalformed?.({
        filePath,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return articles;
}
