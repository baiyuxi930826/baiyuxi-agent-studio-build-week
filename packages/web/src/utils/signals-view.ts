import type {
  SignalArticle,
  SignalArticleStatus,
  SignalCategory,
  SignalSource,
  SignalTier,
} from '@agent-studio/shared';

export type SignalArticleStatusFilter = SignalArticleStatus | 'all';
export type SignalArticleTierFilter = `${SignalTier}` | 'all';

export interface SignalArticleFilters {
  readonly query: string;
  readonly status: SignalArticleStatusFilter;
  readonly source: string | 'all';
  readonly tier: SignalArticleTierFilter;
}

export interface SignalSourceGroup {
  readonly tier: SignalTier;
  readonly category: SignalCategory;
  readonly sources: readonly SignalSource[];
}

const categoryOrder: readonly SignalCategory[] = [
  'official',
  'papers',
  'research',
  'engineering',
  'community',
  'other',
];

export function filterSignalArticles(
  items: readonly SignalArticle[],
  filters: SignalArticleFilters,
): readonly SignalArticle[] {
  const query = filters.query.trim().toLowerCase();

  return items
    .filter((item) => (filters.status === 'all' ? true : item.status === filters.status))
    .filter((item) => (filters.source === 'all' ? true : item.source === filters.source))
    .filter((item) => (filters.tier === 'all' ? true : String(item.tier) === filters.tier))
    .filter((item) => {
      if (query.length === 0) {
        return true;
      }
      const haystack = [item.title, item.source, item.url, item.summary ?? '', ...item.tags].join(' ').toLowerCase();
      return haystack.includes(query);
    })
    .sort((left, right) => Date.parse(right.fetchedAt) - Date.parse(left.fetchedAt));
}

export function groupSignalSourcesByTierAndCategory(sources: readonly SignalSource[]): readonly SignalSourceGroup[] {
  const map = new Map<string, SignalSourceGroup>();

  for (const source of sources) {
    const key = `${source.tier}:${source.category}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        tier: source.tier,
        category: source.category,
        sources: [source],
      });
      continue;
    }
    map.set(key, {
      ...existing,
      sources: [...existing.sources, source],
    });
  }

  return Array.from(map.values())
    .map((group) => ({
      ...group,
      sources: [...group.sources].sort((left, right) => left.name.localeCompare(right.name)),
    }))
    .sort((left, right) => {
      if (left.tier !== right.tier) {
        return left.tier - right.tier;
      }
      return categoryOrder.indexOf(left.category) - categoryOrder.indexOf(right.category);
    });
}
