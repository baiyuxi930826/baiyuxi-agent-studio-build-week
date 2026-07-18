import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export interface SignalPaths {
  readonly rootDir: string;
  readonly configDir: string;
  readonly libraryDir: string;
  readonly inboxDir: string;
  readonly logsDir: string;
  readonly sourcesFile: string;
}

const DEFAULT_SIGNAL_ROOT_DIR = join(homedir(), '.agent-studio', 'signals');

function normalizeRootDir(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export function resolveSignalPaths(rootOverride?: string): SignalPaths {
  const rootDir = resolve(
    normalizeRootDir(rootOverride) ?? normalizeRootDir(process.env.SIGNALS_ROOT_DIR) ?? DEFAULT_SIGNAL_ROOT_DIR,
  );

  const configDir = join(rootDir, 'config');

  return {
    rootDir,
    configDir,
    libraryDir: join(rootDir, 'library'),
    inboxDir: join(rootDir, 'inbox'),
    logsDir: join(rootDir, 'logs'),
    sourcesFile: join(configDir, 'sources.yaml'),
  };
}
