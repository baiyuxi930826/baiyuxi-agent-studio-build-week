/**
 * Tool Usage Counter — F150 (#339)
 * Fire-and-forget Redis INCR for tool_use events + aggregation reader.
 */

import type { RedisClient } from '@agent-studio/shared/utils';
import { createModuleLogger } from '../../../../infrastructure/logger.js';
import { TOOL_USAGE_SCAN_ALL, TOOL_USAGE_TTL_SECONDS, toolUsageKey } from '../stores/redis-keys/tool-usage-keys.js';
import { classifyTool, type ToolCategory } from './classify.js';

const log = createModuleLogger('tool-usage');

/** A single counter entry parsed from Redis. */
export interface ToolUsageEntry {
  date: string;
  agentId: string;
  category: ToolCategory;
  toolName: string;
  count: number;
}

/** Aggregated report returned by the API. */
export interface ToolUsageReport {
  period: { from: string; to: string };
  summary: {
    totalCalls: number;
    byAgentegory: Record<ToolCategory, number>;
  };
  topTools: Array<{ name: string; category: ToolCategory; count: number; mcpServer?: string }>;
  daily: Array<{
    date: string;
    native: number;
    mcp: number;
    skill: number;
  }>;
  byAgent: Record<string, Record<ToolCategory, number>>;
}

export class ToolUsageCounter {
  constructor(
    private readonly redis: RedisClient,
    private readonly archiver?: { loadArchive(excludeDates?: Set<string>): Promise<ToolUsageEntry[]> },
  ) {}

  /** Resolve ioredis keyPrefix (SCAN doesn't auto-apply it) */
  private get keyPrefix(): string {
    return (this.redis as { options?: { keyPrefix?: string } }).options?.keyPrefix ?? '';
  }

  /** Strip keyPrefix from a raw SCAN key for use with normal commands (which auto-prefix) */
  private stripPrefix(rawKey: string): string {
    const p = this.keyPrefix;
    return p && rawKey.startsWith(p) ? rawKey.slice(p.length) : rawKey;
  }

  /**
   * Record a tool_use event. Fire-and-forget — errors are logged, never thrown.
   */
  recordToolUse(agentId: string, toolName: string, toolInput?: Record<string, unknown>): void {
    const classification = classifyTool(toolName, toolInput);
    const date = toDateString(Date.now());
    const key = toolUsageKey(date, agentId, classification.category, classification.toolName);

    this.redis
      .incr(key)
      .then((val) => {
        // Set TTL only on first increment (val === 1)
        if (val === 1) {
          if (TOOL_USAGE_TTL_SECONDS > 0) this.redis.expire(key, TOOL_USAGE_TTL_SECONDS).catch(noop);
        }
      })
      .catch((err) => {
        log.warn({ err, key }, 'Failed to increment tool usage counter');
      });
  }

  /**
   * Read aggregated tool usage for a date range.
   * Pass days=0 for all-time (Redis + archive).
   */
  async aggregate(days: number, filters?: { agentId?: string; category?: ToolCategory }): Promise<ToolUsageReport> {
    const allTime = days <= 0;
    // Redis always scanned (up to 90 days of hot data)
    const redisEntries = allTime ? await this.scanAll() : await this.scanDays(days);

    // For all-time, merge Redis (authoritative) + archive at entry-level granularity.
    // Same-day keys can expire at different times, so date-level dedup would lose data.
    let entries: ToolUsageEntry[];
    if (allTime && this.archiver) {
      const redisKeys = new Set(redisEntries.map((e) => `${e.date}:${e.agentId}:${e.category}:${e.toolName}`));
      const archived = await this.archiver.loadArchive();
      const deduped = archived.filter((e) => !redisKeys.has(`${e.date}:${e.agentId}:${e.category}:${e.toolName}`));
      entries = [...deduped, ...redisEntries];
    } else {
      entries = redisEntries;
    }

    const now = new Date();
    const to = toDateString(now.getTime());
    let from: string;
    if (allTime && entries.length > 0) {
      from = entries.reduce((min, e) => (e.date < min ? e.date : min), entries[0].date);
    } else {
      const fromDate = new Date(now);
      fromDate.setDate(fromDate.getDate() - (allTime ? 90 : days) + 1);
      from = toDateString(fromDate.getTime());
    }

    // Apply filters
    const filtered = entries.filter((e) => {
      if (filters?.agentId && e.agentId !== filters.agentId) return false;
      if (filters?.category && e.category !== filters.category) return false;
      return true;
    });

    // Summary
    const byAgentegory: Record<ToolCategory, number> = { native: 0, mcp: 0, skill: 0 };
    let totalCalls = 0;
    for (const e of filtered) {
      byAgentegory[e.category] += e.count;
      totalCalls += e.count;
    }

    // Top tools (aggregate by category:toolName to avoid cross-category collision)
    const toolTotals = new Map<string, { name: string; category: ToolCategory; count: number }>();
    for (const e of filtered) {
      const aggKey = `${e.category}:${e.toolName}`;
      const existing = toolTotals.get(aggKey);
      if (existing) {
        existing.count += e.count;
      } else {
        toolTotals.set(aggKey, { name: e.toolName, category: e.category, count: e.count });
      }
    }
    const topTools = [...toolTotals.values()].sort((a, b) => b.count - a.count).slice(0, 20);

    // Daily breakdown
    const dailyMap = new Map<string, Record<ToolCategory, number>>();
    for (const e of filtered) {
      const day = dailyMap.get(e.date) ?? { native: 0, mcp: 0, skill: 0 };
      day[e.category] += e.count;
      dailyMap.set(e.date, day);
    }
    const daily = [...dailyMap.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, agents]) => ({ date, ...agents }));

    // By agent
    const byAgent: Record<string, Record<ToolCategory, number>> = {};
    for (const e of filtered) {
      if (!byAgent[e.agentId]) byAgent[e.agentId] = { native: 0, mcp: 0, skill: 0 };
      byAgent[e.agentId][e.category] += e.count;
    }

    return { period: { from, to }, summary: { totalCalls, byAgentegory }, topTools, daily, byAgent };
  }

  /**
   * Single-pass SCAN of all tool-stats:* keys + client-side date filtering.
   * Avoids O(days * total_keys) by scanning the keyspace only once.
   */
  private async scanDays(days: number): Promise<ToolUsageEntry[]> {
    const now = new Date();
    const validDates = new Set<string>();
    for (let i = 0; i < days; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      validDates.add(toDateString(d.getTime()));
    }

    // SCAN doesn't auto-apply ioredis keyPrefix — prepend manually
    const scanPattern = `${this.keyPrefix}${TOOL_USAGE_SCAN_ALL}`;

    const entries: ToolUsageEntry[] = [];
    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', scanPattern, 'COUNT', 500);
      cursor = nextCursor;

      if (keys.length > 0) {
        // MGET auto-applies keyPrefix, so strip it from raw SCAN keys
        const strippedKeys = keys.map((k) => this.stripPrefix(k));
        const values = await this.redis.mget(...strippedKeys);
        for (let k = 0; k < keys.length; k++) {
          // Parse using stripped key (tool-stats:{date}:{agentId}:...)
          const parsed = parseToolUsageKey(strippedKeys[k], values[k]);
          if (parsed && validDates.has(parsed.date)) {
            entries.push(parsed);
          }
        }
      }
    } while (cursor !== '0');

    return entries;
  }

  /** Scan all Redis keys without date filtering (for all-time queries). */
  private async scanAll(): Promise<ToolUsageEntry[]> {
    const scanPattern = `${this.keyPrefix}${TOOL_USAGE_SCAN_ALL}`;
    const entries: ToolUsageEntry[] = [];
    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', scanPattern, 'COUNT', 500);
      cursor = nextCursor;
      if (keys.length > 0) {
        const strippedKeys = keys.map((k) => this.stripPrefix(k));
        const values = await this.redis.mget(...strippedKeys);
        for (let k = 0; k < keys.length; k++) {
          const parsed = parseToolUsageKey(strippedKeys[k], values[k]);
          if (parsed) entries.push(parsed);
        }
      }
    } while (cursor !== '0');
    return entries;
  }

  /**
   * Fetch all current Redis entries (for bulk archive operations).
   * Caller filters by date to avoid per-date full SCANs.
   */
  async fetchAllEntries(): Promise<ToolUsageEntry[]> {
    return this.scanAll();
  }
}

/** Parse a tool-stats Redis key + value into a ToolUsageEntry. */
function parseToolUsageKey(key: string, value: string | null): ToolUsageEntry | null {
  if (!value) return null;
  // key format: tool-stats:{date}:{agentId}:{category}:{toolName}
  const parts = key.split(':');
  // parts[0] = 'tool-stats', parts[1] = date, parts[2] = agentId, parts[3] = category, parts[4+] = toolName
  if (parts.length < 5) return null;
  const date = parts[1];
  const agentId = parts[2];
  const category = parts[3] as ToolCategory;
  // toolName may contain colons (unlikely but safe)
  const toolName = parts.slice(4).join(':');
  const count = parseInt(value, 10);
  if (!Number.isFinite(count)) return null;
  return { date, agentId, category, toolName, count };
}

function toDateString(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

function noop(): void {}
