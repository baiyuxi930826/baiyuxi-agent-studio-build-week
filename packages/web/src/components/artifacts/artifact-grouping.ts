/**
 * F232 Phase B — Grouping logic for global artifacts.
 *
 * Pure functions: bucket artifacts into groups by time / thread / agent.
 * Design spec: docs/designs/F232-phase-b-design-spec.md §2.1–2.4
 */
import type { GlobalArtifactDTO } from '@agent-studio/shared';

export type GroupingMode = 'none' | 'time' | 'thread' | 'agent';

export interface ArtifactGroup {
  /** Stable identity key for React key + collapse state (threadId / agentId / time label).
   *  Distinct from `label` — two groups may share a display label but never share an id. */
  id: string;
  /** Group header label (e.g. "今天", "F232 产物面板", "宪宪") */
  label: string;
  /** Number of items in this group */
  count: number;
  /** The artifacts in this group, in original order */
  items: GlobalArtifactDTO[];
}

// --- Time grouping ---

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function timeBucket(createdAt: number, now: number): string {
  const todayStart = startOfDay(now);
  const yesterdayStart = todayStart - 86_400_000;
  // "This week" = last 7 days from today start
  const weekStart = todayStart - 6 * 86_400_000;

  if (createdAt >= todayStart) return '今天';
  if (createdAt >= yesterdayStart) return '昨天';
  if (createdAt >= weekStart) return '本周';
  return '更早';
}

const TIME_ORDER = ['今天', '昨天', '本周', '更早'];

export function groupByTime(artifacts: GlobalArtifactDTO[], now?: number): ArtifactGroup[] {
  const ts = now ?? Date.now();
  const buckets = new Map<string, GlobalArtifactDTO[]>();

  for (const a of artifacts) {
    const key = timeBucket(a.createdAt, ts);
    const list = buckets.get(key);
    if (list) list.push(a);
    else buckets.set(key, [a]);
  }

  return TIME_ORDER.filter((k) => buckets.has(k)).map((k) => {
    const items = buckets.get(k)!;
    return { id: k, label: k, count: items.length, items };
  });
}

// --- Thread grouping ---

export function groupByThread(artifacts: GlobalArtifactDTO[]): ArtifactGroup[] {
  const buckets = new Map<string, { threadId: string; title: string; items: GlobalArtifactDTO[] }>();

  for (const a of artifacts) {
    const key = a.threadId;
    const existing = buckets.get(key);
    if (existing) {
      existing.items.push(a);
    } else {
      buckets.set(key, { threadId: key, title: a.threadTitle || key, items: [a] });
    }
  }

  // Sort by first item's createdAt (most recent thread first)
  return Array.from(buckets.values())
    .sort((a, b) => (b.items[0]?.createdAt ?? 0) - (a.items[0]?.createdAt ?? 0))
    .map((b) => ({ id: b.threadId, label: b.title, count: b.items.length, items: b.items }));
}

// --- Agent grouping ---

export function groupByAgent(
  artifacts: GlobalArtifactDTO[],
  resolveNickname: (agentId: string) => string | undefined,
): ArtifactGroup[] {
  const buckets = new Map<string, { label: string; items: GlobalArtifactDTO[] }>();

  for (const a of artifacts) {
    const key = a.agentId ?? '—';
    const existing = buckets.get(key);
    if (existing) {
      existing.items.push(a);
    } else {
      const nickname = a.agentId ? resolveNickname(a.agentId) : undefined;
      buckets.set(key, { label: nickname ?? key, items: [a] });
    }
  }

  // Sort by item count descending (most prolific agent first)
  return Array.from(buckets.entries())
    .sort(([, a], [, b]) => b.items.length - a.items.length)
    .map(([agentId, b]) => ({ id: agentId, label: b.label, count: b.items.length, items: b.items }));
}

// --- Dispatcher ---

export function groupArtifacts(
  artifacts: GlobalArtifactDTO[],
  mode: GroupingMode,
  resolveNickname: (agentId: string) => string | undefined,
  now?: number,
): ArtifactGroup[] {
  switch (mode) {
    case 'time':
      return groupByTime(artifacts, now);
    case 'thread':
      return groupByThread(artifacts);
    case 'agent':
      return groupByAgent(artifacts, resolveNickname);
    case 'none':
      return [{ id: '__flat', label: '', count: artifacts.length, items: artifacts }];
  }
}
