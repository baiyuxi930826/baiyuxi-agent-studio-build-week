import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SignalPaths } from '../config/signal-paths.js';

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asInboxUrlRecord(value: unknown): { readonly url: string } | null {
  const record = asRecord(value);
  if (!record) return null;

  const maybeUrl = (record as { url?: unknown }).url;
  if (typeof maybeUrl !== 'string') return null;

  return { url: maybeUrl };
}

async function listInboxFiles(paths: SignalPaths): Promise<readonly string[]> {
  try {
    const files = await readdir(paths.inboxDir);
    return files.filter((file) => file.endsWith('.json'));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

function parseInboxUrls(payload: unknown): readonly string[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  const urls: string[] = [];
  for (const item of payload) {
    const record = asInboxUrlRecord(item);
    if (!record) continue;
    const url = record.url.trim();
    if (url.length > 0) {
      urls.push(url);
    }
  }
  return urls;
}

async function loadUrlsFromInboxFile(inboxFilePath: string): Promise<readonly string[]> {
  try {
    const raw = await readFile(inboxFilePath, 'utf-8');
    const payload = JSON.parse(raw) as unknown;
    return parseInboxUrls(payload);
  } catch {
    return [];
  }
}

export async function loadKnownUrlsFromInbox(paths: SignalPaths): Promise<readonly string[]> {
  const files = await listInboxFiles(paths);
  const knownUrls = new Set<string>();

  for (const file of files) {
    const urls = await loadUrlsFromInboxFile(join(paths.inboxDir, file));
    for (const url of urls) {
      knownUrls.add(url);
    }
  }

  return Array.from(knownUrls);
}
