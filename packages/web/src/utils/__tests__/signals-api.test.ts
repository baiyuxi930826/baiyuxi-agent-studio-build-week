import type { SignalArticle, SignalSource } from '@agent-studio/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchSignalSources,
  fetchSignalsInbox,
  searchSignals,
  triggerSourceFetch,
  updateSignalSource,
} from '../signals-api';

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
}));

vi.mock('@/utils/api-client', () => ({
  apiFetch: (...args: unknown[]) => mocks.apiFetch(...args),
}));

const sampleArticle: SignalArticle = {
  id: 'signal_1',
  url: 'https://example.com/post',
  title: 'Sample Post',
  source: 'anthropic-news',
  tier: 1,
  publishedAt: '2026-02-19T08:00:00.000Z',
  fetchedAt: '2026-02-19T08:01:00.000Z',
  status: 'inbox',
  tags: [],
  filePath: '/tmp/signal_1.md',
};

const sampleSource: SignalSource = {
  id: 'anthropic-news',
  name: 'Anthropic Newsroom',
  url: 'https://www.anthropic.com/news',
  tier: 1,
  category: 'official',
  enabled: true,
  fetch: { method: 'webpage' },
  schedule: { frequency: 'daily' },
};

describe('signals-api', () => {
  beforeEach(() => {
    mocks.apiFetch.mockReset();
  });

  it('fetchSignalsInbox uses default limit and returns items', async () => {
    mocks.apiFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ items: [sampleArticle] }),
    });

    const items = await fetchSignalsInbox();

    expect(mocks.apiFetch).toHaveBeenCalledWith('/api/signals/inbox?limit=20');
    expect(items).toEqual([sampleArticle]);
  });

  it('searchSignals encodes query and forwards optional filters', async () => {
    mocks.apiFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ total: 1, items: [sampleArticle] }),
    });

    await searchSignals('claude 5', {
      limit: 10,
      status: 'read',
      source: 'anthropic-news',
      tier: 1,
      dateFrom: '2026-02-01',
      dateTo: '2026-02-28',
    });

    expect(mocks.apiFetch).toHaveBeenCalledWith(
      '/api/signals/search?q=claude+5&limit=10&status=read&source=anthropic-news&tier=1&dateFrom=2026-02-01&dateTo=2026-02-28',
    );
  });

  it('fetchSignalSources returns source list', async () => {
    mocks.apiFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ sources: [sampleSource] }),
    });

    const sources = await fetchSignalSources();

    expect(mocks.apiFetch).toHaveBeenCalledWith('/api/signals/sources');
    expect(sources).toEqual([sampleSource]);
  });

  it('updateSignalSource sends PATCH request with enabled payload', async () => {
    mocks.apiFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ source: { ...sampleSource, enabled: false } }),
    });

    const updated = await updateSignalSource('anthropic-news', false);

    expect(mocks.apiFetch).toHaveBeenCalledWith('/api/signals/sources/anthropic-news', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    expect(updated.enabled).toBe(false);
  });

  it('triggerSourceFetch sends POST and returns summary', async () => {
    const summary = {
      fetchedArticles: 5,
      newArticles: 3,
      storedArticles: 3,
      duplicateArticles: 2,
      errors: [],
    };
    mocks.apiFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ summary }),
    });

    const result = await triggerSourceFetch('anthropic-news');

    expect(mocks.apiFetch).toHaveBeenCalledWith('/api/signals/sources/anthropic-news/fetch', {
      method: 'POST',
    });
    expect(result.summary).toEqual(summary);
  });

  it('triggerSourceFetch encodes special characters in sourceId', async () => {
    mocks.apiFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          summary: { fetchedArticles: 0, newArticles: 0, storedArticles: 0, duplicateArticles: 0, errors: [] },
        }),
    });

    await triggerSourceFetch('source/with spaces');

    expect(mocks.apiFetch).toHaveBeenCalledWith('/api/signals/sources/source%2Fwith%20spaces/fetch', {
      method: 'POST',
    });
  });

  it('triggerSourceFetch throws on server error', async () => {
    mocks.apiFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: () => Promise.resolve({ error: 'Fetch failed' }),
    });

    await expect(triggerSourceFetch('bad-source')).rejects.toThrow('Fetch failed');
  });

  it('fetchSignalsInbox throws API message when request fails', async () => {
    mocks.apiFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: 'Invalid query' }),
    });

    await expect(fetchSignalsInbox()).rejects.toThrow('Invalid query');
  });
});
