#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const testHome = mkdtempSync(join(tmpdir(), 'agent-studio-test-home-'));
const realHome = process.env.HOME ?? process.env.USERPROFILE ?? '';
const pathEnvKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';

function pathEntries() {
  return (process.env[pathEnvKey] ?? '').split(delimiter).filter(Boolean);
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
    return !/\\(System32|WindowsApps)\\bash\.exe$/i.test(candidate);
  });
}

const env = {
  ...process.env,
  HOME: testHome,
  AGENT_STUDIO_TEST_SANDBOX: process.env.AGENT_STUDIO_TEST_SANDBOX ?? '1',
  AGENT_STUDIO_TEST_REAL_HOME: process.env.AGENT_STUDIO_TEST_REAL_HOME ?? realHome,
  AGENT_STUDIO_DISABLE_SHARED_STATE_PREFLIGHT: '1',
  NODE_ENV: 'test',
};

delete env.AGENT_STUDIO_RUNTIME_ROOT;
delete env.AGENT_STUDIO_MCP_SERVER_PATH;
delete env.AGENT_STUDIO_WORKSPACE_ROOT;
delete env.DEFAULT_CAT_ID;

if (process.platform === 'win32') {
  const bash = resolveWindowsBash();
  if (bash) {
    const gitRoot = bash.replace(/\\usr\\bin\\bash\.exe$/i, '').replace(/\\bin\\bash\.exe$/i, '');
    const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT ?? 'C:\\Windows';
    const gitPathEntries = [
      dirname(bash),
      `${gitRoot}\\cmd`,
      `${gitRoot}\\bin`,
      `${systemRoot}\\System32`,
      `${systemRoot}`,
      dirname(process.execPath),
    ].filter((entry) => existsSync(entry));
    for (const key of Object.keys(env)) {
      if (key.toLowerCase() === 'path' && key !== pathEnvKey) {
        delete env[key];
      }
    }
    env.BASH = bash;
    env[pathEnvKey] = `${gitPathEntries.join(delimiter)}${delimiter}${env[pathEnvKey] ?? ''}`;
  }
}

const requestedTests = process.argv.slice(2);
const testTargets = requestedTests.length > 0 ? requestedTests : ['test/**/*.test.js'];

function escapeCmdArg(arg) {
  if (!/[\s"&|<>^%!\\()]/.test(arg)) return arg;
  let crtEscaped = '';
  let backslashes = 0;
  for (const ch of arg) {
    if (ch === '\\') {
      backslashes++;
    } else if (ch === '"') {
      crtEscaped += `${'\\'.repeat(backslashes * 2)}\\"`;
      backslashes = 0;
    } else {
      crtEscaped += '\\'.repeat(backslashes) + ch;
      backslashes = 0;
    }
  }
  crtEscaped += '\\'.repeat(backslashes * 2);
  let escaped = crtEscaped.replace(/%/g, '%%');
  escaped = escaped.replace(/([&|<>^!()])/g, '^$1');
  return `"${escaped}"`;
}

const nodeTestArgs = [
  '--import',
  pathToFileURL(resolve('test/helpers/setup-agent-registry.js')).href,
  '--test',
  '--test-concurrency=1',
  '--test-timeout=60000',
  ...testTargets,
];

const result =
  process.platform === 'win32'
    ? spawnSync([process.execPath, ...nodeTestArgs].map(escapeCmdArg).join(' '), {
        stdio: 'inherit',
        env,
        shell: true,
      })
    : spawnSync(process.execPath, nodeTestArgs, {
        stdio: 'inherit',
        env,
      });

rmSync(testHome, { recursive: true, force: true });

if (result.signal) {
  process.kill(process.pid, result.signal);
} else {
  process.exit(result.status ?? 1);
}
