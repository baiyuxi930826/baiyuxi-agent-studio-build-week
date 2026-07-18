import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveSignalPaths } from '../config/sources-loader.js';

export interface StudyCollection {
  readonly id: string;
  readonly name: string;
  readonly articleIds: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

function collectionsDir(): string {
  const paths = resolveSignalPaths();
  return join(paths.libraryDir, '..', 'collections');
}

function collectionPath(id: string): string {
  return join(collectionsDir(), `${id}.json`);
}

export class CollectionService {
  async ensureDir(): Promise<void> {
    await mkdir(collectionsDir(), { recursive: true });
  }

  async list(): Promise<readonly StudyCollection[]> {
    await this.ensureDir();
    const dir = collectionsDir();
    const files = await readdir(dir);
    const results: StudyCollection[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = await readFile(join(dir, file), 'utf-8');
        results.push(JSON.parse(raw) as StudyCollection);
      } catch {
        // skip invalid files
      }
    }
    return results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string): Promise<StudyCollection | null> {
    try {
      const raw = await readFile(collectionPath(id), 'utf-8');
      return JSON.parse(raw) as StudyCollection;
    } catch {
      return null;
    }
  }

  async create(name: string, articleIds: readonly string[] = []): Promise<StudyCollection> {
    await this.ensureDir();
    const now = new Date().toISOString();
    const id = `col-${Date.now()}`;
    const collection: StudyCollection = { id, name, articleIds, createdAt: now, updatedAt: now };
    await writeFile(collectionPath(id), JSON.stringify(collection, null, 2), 'utf-8');
    return collection;
  }

  async update(
    id: string,
    patch: { name?: string | undefined; articleIds?: readonly string[] | undefined },
  ): Promise<StudyCollection | null> {
    const existing = await this.get(id);
    if (!existing) return null;
    const updated: StudyCollection = {
      ...existing,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.articleIds !== undefined ? { articleIds: patch.articleIds } : {}),
      updatedAt: new Date().toISOString(),
    };
    await writeFile(collectionPath(id), JSON.stringify(updated, null, 2), 'utf-8');
    return updated;
  }

  async remove(id: string): Promise<boolean> {
    try {
      await unlink(collectionPath(id));
      return true;
    } catch {
      return false;
    }
  }
}
