import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveSignalPaths } from '../config/sources-loader.js';
import { StudyMetaService } from './study-meta-service.js';

export interface MigrationResult {
  readonly scanned: number;
  readonly migrated: number;
  readonly skipped: number;
  readonly errors: readonly string[];
}

/**
 * Scans for article .md files that lack a sidecar meta.json
 * and creates empty meta.json files for them.
 *
 * This ensures all articles have a consistent sidecar structure
 * for the new Study Mode features.
 */
export async function migrateToSidecarFormat(): Promise<MigrationResult> {
  const paths = resolveSignalPaths();
  const studyMeta = new StudyMetaService();
  let scanned = 0;
  let migrated = 0;
  let skipped = 0;
  const errors: string[] = [];

  async function scanDir(dir: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const info = await stat(fullPath);

      if (info.isDirectory()) {
        await scanDir(fullPath);
        continue;
      }

      if (!entry.endsWith('.md')) continue;
      scanned++;

      // Check if sidecar already exists
      const sidecarDir = fullPath.replace(/\.md$/, '');
      try {
        await stat(join(sidecarDir, 'meta.json'));
        skipped++;
      } catch {
        // No meta.json — create empty one
        try {
          const articleId = entry.replace(/\.md$/, '');
          await studyMeta.writeMeta(fullPath, {
            articleId,
            threads: [],
            artifacts: [],
            collections: [],
          });
          migrated++;
        } catch (err) {
          errors.push(`${fullPath}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }

  await scanDir(paths.libraryDir);

  return { scanned, migrated, skipped, errors };
}
