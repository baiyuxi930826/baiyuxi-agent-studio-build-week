import type { SignalSource } from '@agent-studio/shared';
import Parser from 'rss-parser';
import type { FetchError, Fetcher, FetchResult, RawArticle } from './types.js';

interface RssItem {
  readonly title?: string | undefined;
  readonly link?: string | undefined;
  readonly guid?: string | undefined;
  readonly pubDate?: string | undefined;
  readonly isoDate?: string | undefined;
  readonly contentSnippet?: string | undefined;
  readonly content?: string | undefined;
}

interface RssFeed {
  readonly items?: readonly RssItem[] | undefined;
}

interface RssParserLike {
  parseURL(url: string): Promise<RssFeed>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function isSupportedHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function toRawArticle(item: RssItem): RawArticle | null {
  const normalizedLink = item.link?.trim();
  const normalizedGuid = item.guid?.trim();
  const url = [normalizedLink, normalizedGuid].find((candidate) => {
    if (!candidate) return false;
    return isSupportedHttpUrl(candidate);
  });
  const title = item.title?.trim();
  if (!url || !title) return null;

  return {
    url,
    title,
    publishedAt: item.isoDate ?? item.pubDate ?? nowIso(),
    summary: item.contentSnippet?.trim() || undefined,
    content: item.content?.trim() || undefined,
  };
}

function unsupportedSourceError(source: SignalSource): FetchError {
  return {
    code: 'UNSUPPORTED_SOURCE',
    message: `source "${source.id}" is not an RSS source`,
    sourceId: source.id,
  };
}

export class RssFetcher implements Fetcher {
  private readonly parser: RssParserLike;

  constructor(parser?: RssParserLike) {
    this.parser = parser ?? new Parser();
  }

  canHandle(source: SignalSource): boolean {
    return source.fetch.method === 'rss';
  }

  async fetch(source: SignalSource): Promise<FetchResult> {
    const start = Date.now();
    const fetchedAt = nowIso();

    if (!this.canHandle(source)) {
      return {
        articles: [],
        errors: [unsupportedSourceError(source)],
        metadata: {
          fetchedAt,
          duration: Date.now() - start,
          source: source.id,
        },
      };
    }

    try {
      const feed = await this.parser.parseURL(source.url);
      const articles = (feed.items ?? []).map(toRawArticle).filter((item): item is RawArticle => item !== null);

      return {
        articles,
        errors: [],
        metadata: {
          fetchedAt,
          duration: Date.now() - start,
          source: source.id,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        articles: [],
        errors: [
          {
            code: 'RSS_FETCH_FAILED',
            message,
            sourceId: source.id,
          },
        ],
        metadata: {
          fetchedAt,
          duration: Date.now() - start,
          source: source.id,
        },
      };
    }
  }
}
