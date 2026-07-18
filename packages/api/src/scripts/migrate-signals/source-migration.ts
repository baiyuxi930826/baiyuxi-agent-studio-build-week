import { readFile } from 'node:fs/promises';
import type {
  SignalCategory,
  SignalFetchMethod,
  SignalScheduleFrequency,
  SignalSource,
  SignalSourceConfig,
  SignalTier,
} from '@agent-studio/shared';
import { SignalSourceConfigSchema } from '@agent-studio/shared';
import { parse as parseYaml } from 'yaml';
import { DEFAULT_SIGNAL_SOURCES } from '../../domains/signals/config/default-sources.js';
import type { LegacyArticle } from './legacy-article-parser.js';
import { asRecord, exists, normalizeUrl, pickString, slugify } from './shared.js';

export interface LegacySourceMigration {
  readonly sources: readonly SignalSource[];
  readonly aliasToId: ReadonlyMap<string, string>;
}

function parseTierBucket(key: string): SignalTier | undefined {
  const match = key.match(/tier[_-]?(\d)/i);
  if (!match) return undefined;
  const tier = Number(match[1]);
  return tier >= 1 && tier <= 4 ? (tier as SignalTier) : undefined;
}

function toAgentegory(value: string | undefined): SignalCategory {
  const normalized = (value ?? '').toLowerCase();
  if (normalized.includes('preprint')) return 'papers';
  if (normalized.includes('research')) return 'research';
  if (normalized.includes('engineering')) return 'engineering';
  if (normalized.includes('aggregator') || normalized.includes('platform')) return 'community';
  if (normalized.includes('company') || normalized.includes('official')) return 'official';
  return 'other';
}

function toFetchMethod(value: string | undefined): SignalFetchMethod {
  const normalized = (value ?? '').toLowerCase();
  if (normalized === 'rss') return 'rss';
  if (normalized === 'api') return 'api';
  return 'webpage';
}

function toSchedule(value: string | undefined): SignalScheduleFrequency {
  const normalized = (value ?? '').toLowerCase();
  if (normalized === 'hourly') return 'hourly';
  if (normalized === 'weekly') return 'weekly';
  if (normalized === 'manual') return 'manual';
  return 'daily';
}

function loadBaseConfig(rawText: string | null): SignalSourceConfig {
  if (!rawText || rawText.trim().length === 0) {
    return DEFAULT_SIGNAL_SOURCES;
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(rawText);
  } catch (error) {
    throw new Error(`Invalid signal sources config: ${(error as Error).message}`);
  }

  const result = SignalSourceConfigSchema.safeParse(parsed);
  if (!result.success) {
    const detail = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid signal sources config: ${detail}`);
  }

  return result.data as SignalSourceConfig;
}

export async function readTargetSourceConfig(targetSourcesFile: string): Promise<SignalSourceConfig> {
  if (!(await exists(targetSourcesFile))) {
    return DEFAULT_SIGNAL_SOURCES;
  }

  const text = await readFile(targetSourcesFile, 'utf-8');
  return loadBaseConfig(text);
}

function withUniqueId(id: string, used: Set<string>): string {
  if (!used.has(id)) return id;

  let index = 1;
  while (used.has(`${id}-${index}`)) {
    index += 1;
  }

  return `${id}-${index}`;
}

export async function parseLegacySources(legacySourcesFile: string): Promise<LegacySourceMigration> {
  if (!(await exists(legacySourcesFile))) {
    return { sources: [], aliasToId: new Map() };
  }

  const parsed = parseYaml(await readFile(legacySourcesFile, 'utf-8'));
  const root = asRecord(parsed);
  if (!root) {
    return { sources: [], aliasToId: new Map() };
  }

  const sources: SignalSource[] = [];
  const aliasToId = new Map<string, string>();

  for (const [bucketKey, bucketValue] of Object.entries(root)) {
    const tier = parseTierBucket(bucketKey) ?? 3;
    const sourcesById = asRecord(bucketValue);
    if (!sourcesById) continue;

    for (const [legacySourceId, sourceValue] of Object.entries(sourcesById)) {
      const sourceRecord = asRecord(sourceValue);
      const feeds = Array.isArray(sourceRecord?.feeds) ? sourceRecord.feeds : [];
      if (feeds.length === 0) continue;

      const baseName = pickString(sourceRecord ?? {}, ['name']) ?? legacySourceId;
      const category = toAgentegory(pickString(sourceRecord ?? {}, ['type']));

      feeds.forEach((feedValue, index) => {
        const feed = asRecord(feedValue);
        const url = pickString(feed ?? {}, ['url']);
        if (!url) return;

        const feedName = pickString(feed ?? {}, ['name']) ?? `feed-${index + 1}`;
        const hasSingleFeed = feeds.length === 1;
        const sourceId = slugify(hasSingleFeed ? legacySourceId : `${legacySourceId}-${feedName}`);

        sources.push({
          id: sourceId,
          name: hasSingleFeed ? baseName : `${baseName} / ${feedName}`,
          url,
          tier,
          category,
          enabled: true,
          fetch: {
            method: toFetchMethod(pickString(feed ?? {}, ['type'])),
          },
          schedule: {
            frequency: toSchedule(pickString(feed ?? {}, ['check_frequency'])),
          },
        });

        aliasToId.set(slugify(sourceId), sourceId);

        if (hasSingleFeed) {
          aliasToId.set(slugify(legacySourceId), sourceId);
          aliasToId.set(slugify(baseName), sourceId);
          return;
        }

        aliasToId.set(slugify(`${legacySourceId}-${feedName}`), sourceId);
        aliasToId.set(slugify(`${baseName}-${feedName}`), sourceId);
      });
    }
  }

  return { sources, aliasToId };
}

export function mergeSources(
  base: SignalSourceConfig,
  incoming: readonly SignalSource[],
): { readonly config: SignalSourceConfig; readonly idRemap: Map<string, string> } {
  const merged: SignalSource[] = [...base.sources];
  const idRemap = new Map<string, string>();
  const usedIds = new Set(merged.map((source) => source.id));
  const byUrl = new Map(merged.map((source) => [normalizeUrl(source.url), source.id]));

  for (const source of incoming) {
    const existingByUrl = byUrl.get(normalizeUrl(source.url));
    if (existingByUrl) {
      idRemap.set(source.id, existingByUrl);
      continue;
    }

    const nextId = withUniqueId(source.id, usedIds);
    usedIds.add(nextId);
    byUrl.set(normalizeUrl(source.url), nextId);
    idRemap.set(source.id, nextId);
    merged.push({
      ...source,
      id: nextId,
    });
  }

  return {
    config: SignalSourceConfigSchema.parse({
      version: 1,
      sources: merged,
    }) as SignalSourceConfig,
    idRemap,
  };
}

export function createFallbackSource(article: LegacyArticle, current: SignalSourceConfig): SignalSource {
  const baseId = slugify(`legacy-${article.sourceLabel ?? article.folderName}`);
  const usedIds = new Set(current.sources.map((source) => source.id));
  const id = withUniqueId(baseId, usedIds);

  let sourceUrl = article.url;
  try {
    const parsed = new URL(article.url);
    sourceUrl = `${parsed.protocol}//${parsed.host}`;
  } catch {
    sourceUrl = article.url;
  }

  return {
    id,
    name: article.sourceLabel ?? article.folderName,
    url: sourceUrl,
    tier: article.tier ?? 3,
    category: 'other',
    enabled: false,
    fetch: {
      method: 'webpage',
    },
    schedule: {
      frequency: 'manual',
    },
  };
}
