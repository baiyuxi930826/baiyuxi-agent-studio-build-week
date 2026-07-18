import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const WEB_SRC = path.resolve(__dirname, '..');

const REDUNDANT_PATTERNS = [
  /border-studio[\w-]* dark:border-gray-\d+/,
  /text-studio-(?:secondary|muted) dark:text-gray-\d+/,
  /bg-studio-surface(?:-elevated|-sunken)? dark:bg-gray-\d+/,
];

function collectSourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const fullPath = path.join(root, entry);
    const parts = fullPath.split(path.sep);
    if (parts.includes('node_modules') || parts.includes('__tests__')) continue;
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      files.push(fullPath);
    }
  }
  return files;
}

function collectDarkLines(): string[] {
  return collectSourceFiles(WEB_SRC).flatMap((filePath) => {
    const relativePath = path.relative(WEB_SRC, filePath);
    return readFileSync(filePath, 'utf-8')
      .split('\n')
      .flatMap((line, index) => (line.includes('dark:') ? [`${relativePath}:${index + 1}:${line}`] : []));
  });
}

describe('color token audit', () => {
  it('no redundant dark: overrides on semantic token classes', () => {
    const violations: string[] = [];
    for (const line of collectDarkLines()) {
      if (REDUNDANT_PATTERNS.some((pat) => pat.test(line))) {
        violations.push(line);
      }
    }

    expect(violations, `Found ${violations.length} redundant dark: overrides:\n${violations.join('\n')}`).toHaveLength(
      0,
    );
  });

  it('remaining dark: usages are within expected count', () => {
    const count = collectDarkLines().length;
    expect(count).toBeLessThanOrEqual(50);
  });
});
