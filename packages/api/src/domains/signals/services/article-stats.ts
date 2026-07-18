import type { SignalArticle } from '@agent-studio/shared';

export interface SignalArticleStats {
  readonly todayCount: number;
  readonly weekCount: number;
  readonly unreadCount: number;
  readonly byTier: Record<string, number>;
  readonly bySource: Record<string, number>;
}

export function computeSignalArticleStats(articles: readonly SignalArticle[], now: Date): SignalArticleStats {
  const byTier: Record<string, number> = {};
  const bySource: Record<string, number> = {};

  let todayCount = 0;
  let weekCount = 0;
  let unreadCount = 0;

  const nowMs = now.getTime();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - 6);

  for (const article of articles) {
    const fetchedMs = Date.parse(article.fetchedAt);
    if (Number.isNaN(fetchedMs)) {
      continue;
    }

    byTier[String(article.tier)] = (byTier[String(article.tier)] ?? 0) + 1;
    bySource[article.source] = (bySource[article.source] ?? 0) + 1;

    if (article.status === 'inbox') {
      unreadCount += 1;
    }

    if (fetchedMs >= weekStart.getTime() && fetchedMs <= nowMs) {
      weekCount += 1;
    }

    if (fetchedMs >= todayStart.getTime() && fetchedMs <= nowMs) {
      todayCount += 1;
    }
  }

  return {
    todayCount,
    weekCount,
    unreadCount,
    byTier,
    bySource,
  };
}
