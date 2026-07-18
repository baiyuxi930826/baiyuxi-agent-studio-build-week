/**
 * In-memory implementation of per-thread key-value memory store.
 * Part of F3-lite feature for Phase 4.0.
 */

import type { MemoryEntry, MemoryInput } from '@agent-studio/shared';

/** Maximum keys per thread to prevent memory bloat */
export const MAX_KEYS_PER_THREAD = 50;

/**
 * Interface for memory store implementations.
 */
export interface IMemoryStore {
  /** Write or overwrite a memory entry */
  set(input: MemoryInput): MemoryEntry | Promise<MemoryEntry>;

  /** Get a single entry by key */
  get(threadId: string, key: string): MemoryEntry | null | Promise<MemoryEntry | null>;

  /** List all entries for a thread */
  list(threadId: string): MemoryEntry[] | Promise<MemoryEntry[]>;

  /** Delete a single entry */
  delete(threadId: string, key: string): boolean | Promise<boolean>;

  /** Delete all entries for a thread (cascade delete support) */
  deleteThread(threadId: string): number | Promise<number>;
}

/**
 * In-memory implementation of IMemoryStore.
 * Uses Map<threadId, Map<key, MemoryEntry>>.
 */
export class MemoryStore implements IMemoryStore {
  private data = new Map<string, Map<string, MemoryEntry>>();

  set(input: MemoryInput): MemoryEntry {
    let threadMap = this.data.get(input.threadId);
    if (!threadMap) {
      threadMap = new Map();
      this.data.set(input.threadId, threadMap);
    }

    // Check capacity before adding new key
    if (!threadMap.has(input.key) && threadMap.size >= MAX_KEYS_PER_THREAD) {
      // Evict oldest entry
      const oldest = this.findOldestKey(threadMap);
      if (oldest) {
        threadMap.delete(oldest);
      }
    }

    const entry: MemoryEntry = {
      key: input.key,
      value: input.value,
      threadId: input.threadId,
      updatedBy: input.updatedBy,
      updatedAt: Date.now(),
    };

    threadMap.set(input.key, entry);
    return entry;
  }

  get(threadId: string, key: string): MemoryEntry | null {
    const threadMap = this.data.get(threadId);
    if (!threadMap) return null;
    return threadMap.get(key) ?? null;
  }

  list(threadId: string): MemoryEntry[] {
    const threadMap = this.data.get(threadId);
    if (!threadMap) return [];
    return Array.from(threadMap.values());
  }

  delete(threadId: string, key: string): boolean {
    const threadMap = this.data.get(threadId);
    if (!threadMap) return false;
    return threadMap.delete(key);
  }

  /** Delete all entries for a thread. Returns count of deleted entries. */
  deleteThread(threadId: string): number {
    const threadMap = this.data.get(threadId);
    if (!threadMap) return 0;
    const count = threadMap.size;
    this.data.delete(threadId);
    return count;
  }

  private findOldestKey(threadMap: Map<string, MemoryEntry>): string | null {
    let oldest: { key: string; time: number } | null = null;
    for (const [key, entry] of threadMap) {
      if (!oldest || entry.updatedAt < oldest.time) {
        oldest = { key, time: entry.updatedAt };
      }
    }
    return oldest?.key ?? null;
  }
}
