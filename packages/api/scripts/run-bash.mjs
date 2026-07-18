#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter } from 'node:path';

const command = process.argv.slice(2).join(' ');

if (!command) {
  console.error('Usage: node scripts/run-bash.mjs <bash command>');
  process.exit(1);
}

function pathEntries() {
  return (process.env.PATH ?? '').split(delimiter).filter(Boolean);
}

function resolveWindowsBash() {
  const candidates = [
    process.env.BASH,
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\usr\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    ...pathEntries().map((entry) => `${entry.replace(/[\\/]$/, '')}\\bash.exe`),
  ].filter(Boolean);

  return candidates.find((candidate) => {
    if (!existsSync(candidate)) return false;
    // System32/WindowsApps bash.exe is the WSL launcher. It can exist even when
    // no distro has /bin/bash, which makes npm scripts fail before tests run.
    return !/\\(System32|WindowsApps)\\bash\.exe$/i.test(candidate);
  });
}

const bash = process.platform === 'win32' ? resolveWindowsBash() : 'bash';

if (!bash) {
  console.error('Unable to find a usable bash executable. Install Git for Windows or set BASH to bash.exe.');
  process.exit(1);
}

const result = spawnSync(bash, ['-lc', command], {
  stdio: 'inherit',
  env: process.env,
});

if (result.signal) {
  process.kill(process.pid, result.signal);
} else {
  process.exit(result.status ?? 1);
}
