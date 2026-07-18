import type { SignalArticle, SignalSource } from '@agent-studio/shared';
import { describe, expect, it } from 'vitest';
import { filterSignalArticles, groupSignalSourcesByTierAndCategory, type SignalArticleFilters } from '../signals-view';

const baseArticles: readonly SignalArticle[] = [
  {
    id: 'a1',
    url: 'https://example.com/1',
    title: 'Claude 5 roadmap',
    source: 'anthropic-news',
    tier: 1,
    publishedAt: '2026-02-19T08:00:00.000Z',
    fetchedAt: '2026-02-19T08:01:00.000Z',
    status: 'inbox',
    tags: ['roadmap'],
    summary: 'Launch notes',
    filePath: '/tmp/a1.md',
  },
  {
    id: 'a2',
    url: 'https://example.com/2',
    title: 'Open model evals',
    source: 'open-models',
    tier: 2,
    publishedAt: '2026-02-18T08:00:00.000Z',
    fetchedAt: '2026-02-18T08:01:00.000Z',
    status: 'read',
    tags: ['evals'],
    filePath: '/tmp/a2.md',
  },
];

const baseSources: readonly SignalSource[] = [
  {
    id: 'anthropic-news',
    name: 'Anthropic',
    url: 'https://www.anthropic.com/news',
    tier: 1,
    category: 'official',
    enabled: true,
    fetch: { method: 'webpage' },
    schedule: { frequency: 'daily' },
  },
  {
    id: 'open-models',
    name: 'Open Models',
    url: 'https://example.com/open-models',
    tier: 2,
    category: 'research',
    enabled: false,
    fetch: { method: 'rss' },
    schedule: { frequency: 'daily' },
  },
];

function withFilters(overrides: Partial<SignalArticleFilters>): SignalArticleFilters {
  return {
    query: '',
    status: 'all',
    source: 'all',
    tier: 'all',
    ...overrides,
  };
}

describe('signals-view', () => {
  it('filters articles by query across title/source/summary', () => {
    const filtered = filterSignalArticles(baseArticles, withFilters({ query: 'launch' }));
    expect(filtered.map((item) => item.id)).toEqual(['a1']);
  });

  it('filters articles by status/source/tier', () => {
    const filtered = filterSignalArticles(
      baseArticles,
      withFilters({ status: 'read', source: 'open-models', tier: '2' }),
    );
    expect(filtered.map((item) => item.id)).toEqual(['a2']);
  });

  it('sorts filtered articles by fetchedAt descending', () => {
    const filtered = filterSignalArticles(baseArticles, withFilters({}));
    expect(filtered.map((item) => item.id)).toEqual(['a1', 'a2']);
  });

  it('groups sources by tier and category', () => {
    const grouped = groupSignalSourcesByTierAndCategory(baseSources);
    expect(grouped).toHaveLength(2);
    expect(grouped[0]?.tier).toBe(1);
    expect(grouped[0]?.category).toBe('official');
    expect(grouped[0]?.sources.map((source) => source.id)).toEqual(['anthropic-news']);
  });
});
