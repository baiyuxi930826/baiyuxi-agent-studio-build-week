import type { SignalSource } from '@agent-studio/shared';

export interface RawArticle {
  readonly url: string;
  readonly title: string;
  readonly publishedAt: string;
  readonly summary?: string | undefined;
  readonly content?: string | undefined;
}

export type FetchErrorCode = 'UNSUPPORTED_SOURCE' | 'RSS_FETCH_FAILED' | 'API_FETCH_FAILED' | 'WEBPAGE_FETCH_FAILED';

export interface FetchError {
  readonly code: FetchErrorCode;
  readonly message: string;
  readonly sourceId: string;
}

export interface FetchResult {
  readonly articles: readonly RawArticle[];
  readonly errors: readonly FetchError[];
  readonly metadata: {
    readonly fetchedAt: string;
    readonly duration: number;
    readonly source: string;
  };
}

export interface Fetcher {
  canHandle(source: SignalSource): boolean;
  fetch(source: SignalSource): Promise<FetchResult>;
}
