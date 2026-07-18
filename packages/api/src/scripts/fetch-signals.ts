import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SignalFetchSchedulerSummary } from '../domains/signals/services/fetch-scheduler.js';
import { runSignalFetchScheduler } from '../domains/signals/services/fetch-scheduler.js';

export interface FetchSignalsCliArgs {
  readonly dryRun: boolean;
  readonly sourceId?: string | undefined;
  readonly help: boolean;
}

export interface FetchSignalsCliIo {
  log(message: string): void;
  error(message: string): void;
}

const USAGE_LINES = [
  'Usage: pnpm --filter @agent-studio/api run fetch-signals -- [options]',
  '',
  'Options:',
  '  --dry-run            run fetch pipeline without writing articles or notifications',
  '  --source <sourceId>  fetch only one source id',
  '  --help               print this help',
];

export function parseFetchSignalsArgs(argv: readonly string[]): FetchSignalsCliArgs {
  let dryRun = false;
  let sourceId: string | undefined;
  let help = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }

    if (arg === '--') {
      continue;
    }

    if (arg === '--source') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('--source requires a value');
      }
      sourceId = value;
      i += 1;
      continue;
    }

    throw new Error(`unknown argument: ${arg}`);
  }

  return {
    dryRun,
    ...(sourceId ? { sourceId } : {}),
    help,
  };
}

export function formatFetchSignalsSummary(summary: SignalFetchSchedulerSummary): string {
  const notificationErrors = summary.notifications
    ? Number(summary.notifications.email.status === 'error') + Number(summary.notifications.inApp.status === 'error')
    : 0;

  return [
    `[signals] fetch completed`,
    `dryRun=${summary.dryRun}`,
    `processed=${summary.processedSources}`,
    `skipped=${summary.skippedSources}`,
    `fetched=${summary.fetchedArticles}`,
    `new=${summary.newArticles}`,
    `stored=${summary.storedArticles}`,
    `duplicates=${summary.duplicateArticles}`,
    `errors=${summary.errors.length}`,
    `notificationErrors=${notificationErrors}`,
  ].join(' ');
}

export function toFetchSignalsExitCode(summary: SignalFetchSchedulerSummary): number {
  const hasNotificationError =
    summary.notifications?.email.status === 'error' || summary.notifications?.inApp.status === 'error';
  return summary.errors.length > 0 || hasNotificationError ? 1 : 0;
}

function usage(): string {
  return USAGE_LINES.join('\n');
}

export async function runFetchSignalsCli(
  argv: readonly string[] = process.argv.slice(2),
  io: FetchSignalsCliIo = console,
): Promise<number> {
  let parsed: FetchSignalsCliArgs;

  try {
    parsed = parseFetchSignalsArgs(argv);
  } catch (error) {
    io.error(error instanceof Error ? error.message : String(error));
    io.error('');
    io.error(usage());
    return 1;
  }

  if (parsed.help) {
    io.log(usage());
    return 0;
  }

  try {
    const summary = await runSignalFetchScheduler({
      dryRun: parsed.dryRun,
      sourceId: parsed.sourceId,
    });
    io.log(formatFetchSignalsSummary(summary));

    if (summary.errors.length > 0) {
      for (const error of summary.errors) {
        io.error(`[signals] ${error.code} source=${error.sourceId} message=${error.message}`);
      }
    }

    if (summary.notifications?.email.status === 'error') {
      io.error(`[signals] EMAIL_NOTIFY_FAILED message=${summary.notifications.email.error ?? 'unknown error'}`);
    }

    if (summary.notifications?.inApp.status === 'error') {
      io.error(`[signals] IN_APP_NOTIFY_FAILED message=${summary.notifications.inApp.error ?? 'unknown error'}`);
    }

    return toFetchSignalsExitCode(summary);
  } catch (error) {
    io.error(`[signals] fetch failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

async function main(): Promise<void> {
  const code = await runFetchSignalsCli(process.argv.slice(2), console);
  if (code !== 0) {
    process.exitCode = code;
  }
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (entryPath.length > 0 && entryPath === fileURLToPath(import.meta.url)) {
  main();
}
