import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

const [cmd, ...args] = process.argv.slice(2);

if (!cmd) {
  console.error('Usage: node scripts/run-with-node-env-test.mjs <cmd> [...args]');
  process.exit(1);
}

function resolveCommand(command) {
  if (process.platform !== 'win32') return command;
  if (/[\\/]/.test(command)) return command;
  const entries = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  const names = /\.[a-z0-9]+$/i.test(command)
    ? [command]
    : [`${command}.cmd`, `${command}.exe`, `${command}.bat`, command];
  for (const entry of entries) {
    for (const name of names) {
      const candidate = join(entry, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return command;
}

function quoteCmdArg(value) {
  if (!/[ \t&()^|<>"]/g.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function spawnCommand(command, commandArgs, options) {
  const resolved = resolveCommand(command);
  if (process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(resolved)) {
    const comspec = process.env.ComSpec || 'cmd.exe';
    return spawn(comspec, ['/d', '/c', [resolved, ...commandArgs].map(quoteCmdArg).join(' ')], {
      ...options,
      windowsVerbatimArguments: true,
    });
  }
  return spawn(resolved, commandArgs, options);
}

const child = spawnCommand(cmd, args, {
  stdio: 'inherit',
  windowsHide: true,
  env: {
    ...process.env,
    NODE_ENV: 'test',
  },
});

child.on('error', (error) => {
  console.error('[run-with-node-env-test] command failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
