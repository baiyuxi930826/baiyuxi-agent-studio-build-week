import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SignalPaths } from '../config/signal-paths.js';

export interface InboxRecord {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly source: string;
  readonly tier: number;
  readonly fetchedAt: string;
  readonly filePath: string;
}

export interface ReadInboxRecordsOptions {
  readonly maxRecords?: number | undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function pickString(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value !== 'string') continue;
    const normalized = value.trim();
    if (normalized.length > 0) {
      return normalized;
    }
  }
  return undefined;
}

function normalizeDateString(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }
  return normalized;
}

function normalizeMaxRecords(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : undefined;
}

function takeLatestRecords(records: readonly InboxRecord[], maxRecords: number | undefined): readonly InboxRecord[] {
  if (maxRecords === undefined || records.length <= maxRecords) {
    return records;
  }
  return records.slice(-maxRecords);
}

async function readSingleInboxFile(filePath: string): Promise<readonly InboxRecord[]> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    const records: InboxRecord[] = [];
    for (const item of parsed) {
      const record = asRecord(item);
      if (!record) continue;

      const id = pickString(record, ['id']);
      const title = pickString(record, ['title']);
      const url = pickString(record, ['url']);
      const source = pickString(record, ['source']);
      const fetchedAt = pickString(record, ['fetchedAt']);
      const filePathValue = pickString(record, ['filePath']);
      const tierValue = record.tier;

      if (!id || !title || !url || !source || !fetchedAt || !filePathValue || typeof tierValue !== 'number') {
        continue;
      }

      records.push({
        id,
        title,
        url,
        source,
        tier: tierValue,
        fetchedAt,
        filePath: filePathValue,
      });
    }

    return records;
  } catch {
    return [];
  }
}

export async function readInboxRecords(
  paths: SignalPaths,
  date: string | undefined,
  options: ReadInboxRecordsOptions = {},
): Promise<readonly InboxRecord[]> {
  const explicitDate = normalizeDateString(date);
  const maxRecords = normalizeMaxRecords(options.maxRecords);
  if (explicitDate) {
    const records = await readSingleInboxFile(join(paths.inboxDir, `${explicitDate}.json`));
    return takeLatestRecords(records, maxRecords);
  }

  let inboxFiles: readonly string[] = [];
  try {
    inboxFiles = (await readdir(paths.inboxDir))
      .filter((file) => file.endsWith('.json'))
      .sort()
      .reverse();
  } catch {
    inboxFiles = [];
  }

  const allRecords: InboxRecord[] = [];
  for (const inboxFile of inboxFiles) {
    if (maxRecords !== undefined && allRecords.length >= maxRecords) {
      break;
    }
    const records = await readSingleInboxFile(join(paths.inboxDir, inboxFile));
    if (maxRecords === undefined) {
      allRecords.push(...records);
      continue;
    }

    const remaining = maxRecords - allRecords.length;
    if (remaining <= 0) {
      break;
    }
    allRecords.push(...takeLatestRecords(records, remaining));
  }

  return allRecords;
}
