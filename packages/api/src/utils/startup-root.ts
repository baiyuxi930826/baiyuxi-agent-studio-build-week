/**
 * Shared startup project root resolver.
 *
 * Walks upward from the given starting directory (or this module's directory)
 * looking for `agent-studio-skills/manifest.yaml` to find the monorepo root.
 * Used by multiple F228 route files that need a consistent project root.
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function resolveStartupProjectRoot(startDir: string = __dirname): string {
  let dir = startDir;
  while (dir !== dirname(dir)) {
    const candidate = join(dir, 'agent-studio-skills', 'manifest.yaml');
    if (existsSync(candidate)) return dir;
    dir = dirname(dir);
  }
  return process.cwd();
}
