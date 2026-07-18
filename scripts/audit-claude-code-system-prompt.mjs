#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, posix as pathPosix, resolve } from 'node:path';

export const ANCHORS_CLAUDE = [
  { id: 'doing-tasks', label: 'Doing tasks', pattern: /#\s*Doing tasks/i, functional: false },
  {
    id: 'parallel-tools',
    label: 'Parallel tool use',
    pattern: /independent.*multiple tools|multiple tools.*single response/i,
    functional: true,
  },
  {
    id: 'destructive-safety',
    label: 'Destructive operation safety',
    pattern: /destructive operations|safer alternative/i,
    functional: true,
  },
  {
    id: 'simple-system-prompt',
    label: 'Simple system prompt mode',
    pattern: /CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT/i,
    functional: true,
  },
  { id: 'using-tools', label: 'Using tools', pattern: /#\s*Using your tools/i, functional: false },
];

export const ANCHORS_CODEX = [
  {
    id: 'developer-instructions',
    label: 'Developer instructions',
    pattern: /developer_instructions/i,
    functional: true,
  },
  { id: 'base-instructions', label: 'Base instructions', pattern: /base_instructions/i, functional: true },
  { id: 'sandbox-mode', label: 'Sandbox mode', pattern: /sandbox_mode/i, functional: true },
  { id: 'approval-policy', label: 'Approval policy', pattern: /approval_policy/i, functional: true },
];

const IDENTITY_PATTERNS_CLAUDE = [
  /You are Claude Code,\s*Anthropic's official CLI for Claude\./g,
  /You are a Claude agent,\s*built on Anthropic's Claude Agent SDK\./g,
];

export const IDENTITY_PATTERNS_CODEX = [/You are Codex,[^.]*\./g, /You are a coding agent running in the Codex CLI\./g];

function unique(values) {
  return [...new Set(values)];
}

export function extractSections(stringsOutput, anchors = ANCHORS_CLAUDE, identityPatterns = IDENTITY_PATTERNS_CLAUDE) {
  const identityLines = [];
  for (const pattern of identityPatterns) {
    for (const match of stringsOutput.matchAll(pattern)) {
      if (match[0]) identityLines.push(match[0].trim());
    }
  }

  const sections = [];
  const seen = new Set();
  for (const line of stringsOutput.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    for (const anchor of anchors) {
      if (seen.has(anchor.id)) continue;
      if (!anchor.pattern.test(trimmed)) continue;
      seen.add(anchor.id);
      sections.push({
        id: anchor.id,
        label: anchor.label,
        functional: Boolean(anchor.functional),
        matchedLine: trimmed,
      });
    }
  }

  return { identityLines: unique(identityLines), sections };
}

function knownAnchorIds() {
  return new Set([...ANCHORS_CLAUDE, ...ANCHORS_CODEX].map((anchor) => anchor.id));
}

function parseArchivedAnchorIds(markdown) {
  const known = knownAnchorIds();
  const ids = [];
  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(/^\s*-\s+([a-z0-9]+(?:-[a-z0-9]+)*)\b/);
    if (match && known.has(match[1])) ids.push(match[1]);
  }
  return unique(ids);
}

export function diffSections(prevDocMarkdown, current) {
  const prev = new Set(parseArchivedAnchorIds(prevDocMarkdown));
  const cur = new Set(current.sections.map((section) => section.id));
  return {
    added: [...cur].filter((id) => !prev.has(id)),
    removed: [...prev].filter((id) => !cur.has(id)),
  };
}

export function parseCliVersion(output, cli) {
  const match = output.match(/\b(\d+\.\d+\.\d+)\b/);
  if (!match) throw new Error(`Unable to parse ${cli} version from: ${output.trim()}`);
  return match[1];
}

function compareSemver(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

export function latestArchivedVersion(cli, files) {
  const prefix = cli === 'codex' ? 'codex-system-prompt-v' : 'cc-system-prompt-v';
  const versions = files
    .map((file) => basename(file))
    .map((file) =>
      file.match(new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+\\.\\d+\\.\\d+)\\.md$`)),
    )
    .filter(Boolean)
    .map((match) => match[1]);
  if (versions.length === 0) return null;
  return versions.sort(compareSemver).at(-1) ?? null;
}

export function formatMarkdown(extraction, { cli, version }) {
  const titleCli = cli === 'codex' ? 'Codex' : 'Claude Code';
  const identity = extraction.identityLines.map((line) => `- ${line}`).join('\n') || '- <none captured>';
  const sectionList = extraction.sections
    .map((section) => {
      const marker = section.functional ? ' - functional' : '';
      return `- ${section.id} - ${section.label}${marker}`;
    })
    .join('\n');
  return [
    '---',
    'feature_ids: [F203]',
    'doc_kind: audit',
    `cli: ${cli}`,
    `version: ${version}`,
    '---',
    '',
    `# ${titleCli} v${version} System Prompt Audit`,
    '',
    '## Identity',
    identity,
    '',
    '## Section List',
    sectionList || '- <none>',
    '',
  ].join('\n');
}

export function targetTriple(platform = process.platform, arch = process.arch) {
  if (platform === 'darwin' && arch === 'arm64') return 'aarch64-apple-darwin';
  if (platform === 'darwin' && arch === 'x64') return 'x86_64-apple-darwin';
  if (platform === 'linux' && arch === 'x64') return 'x86_64-unknown-linux-musl';
  if (platform === 'linux' && arch === 'arm64') return 'aarch64-unknown-linux-musl';
  if (platform === 'win32' && arch === 'x64') return 'x86_64-pc-windows-msvc';
  return null;
}

function codexPlatformPackage(triple) {
  const map = {
    'aarch64-apple-darwin': '@openai/codex-darwin-arm64',
    'x86_64-apple-darwin': '@openai/codex-darwin-x64',
    'x86_64-unknown-linux-musl': '@openai/codex-linux-x64',
    'aarch64-unknown-linux-musl': '@openai/codex-linux-arm64',
    'x86_64-pc-windows-msvc': '@openai/codex-windows-x64',
  };
  return map[triple] ?? null;
}

function pushCodexVendorCandidates(candidates, pkgDir, triple) {
  candidates.push(pathPosix.join(pkgDir, 'vendor', triple, 'bin', 'codex'));
  candidates.push(pathPosix.join(pkgDir, 'vendor', triple, 'codex', 'codex'));
}

export function codexNativeBinaryCandidates(launcherPath, triple, resolvePlatformPackage) {
  const pkgName = codexPlatformPackage(triple);
  if (!pkgName) return [];

  const normalizedLauncher = launcherPath.replace(/\\/g, '/');
  const pkgRoot = pathPosix.dirname(pathPosix.dirname(normalizedLauncher));
  const candidates = [];
  const resolver = resolvePlatformPackage;
  const resolvedPkgDir = resolver ? resolver(pkgName, launcherPath) : null;
  if (resolvedPkgDir) pushCodexVendorCandidates(candidates, resolvedPkgDir.replace(/\\/g, '/'), triple);

  pushCodexVendorCandidates(candidates, pathPosix.join(pkgRoot, 'node_modules', pkgName), triple);
  pushCodexVendorCandidates(candidates, pathPosix.join(pathPosix.dirname(pkgRoot), pkgName), triple);
  pushCodexVendorCandidates(candidates, pkgRoot, triple);
  return unique(candidates);
}

function commandOutput(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function readCliStrings(cli) {
  const versionOut = commandOutput(cli, ['--version']);
  const version = parseCliVersion(versionOut, cli);
  const which = process.platform === 'win32' ? 'where' : 'which';
  const cliPath = commandOutput(which, [cli]).split(/\r?\n/).find(Boolean);
  if (!cliPath) throw new Error(`Unable to locate ${cli}`);
  const stringsOut = commandOutput('strings', [cliPath]);
  return { version, stringsOut };
}

function main() {
  const args = process.argv.slice(2);
  const cli = args.includes('--cli') ? args[args.indexOf('--cli') + 1] : 'claude';
  const emit = args.includes('--emit');
  const diffIndex = args.indexOf('--diff');
  const outIndex = args.indexOf('--out');
  const { version, stringsOut } = readCliStrings(cli);
  const extraction = extractSections(
    stringsOut,
    cli === 'codex' ? ANCHORS_CODEX : ANCHORS_CLAUDE,
    cli === 'codex' ? IDENTITY_PATTERNS_CODEX : IDENTITY_PATTERNS_CLAUDE,
  );

  if (diffIndex >= 0) {
    const prevPath = args[diffIndex + 1];
    const previous = readFileSync(prevPath, 'utf8');
    const diff = diffSections(previous, extraction);
    console.log(JSON.stringify(diff, null, 2));
    process.exit(diff.added.length || diff.removed.length ? 1 : 0);
  }

  if (emit) {
    const markdown = formatMarkdown(extraction, { cli, version });
    if (outIndex >= 0) {
      writeFileSync(resolve(args[outIndex + 1]), markdown);
    } else {
      process.stdout.write(markdown);
    }
    return;
  }

  const auditsDir = resolve('docs/audits');
  const files = existsSync(auditsDir) ? readdirSync(auditsDir) : [];
  console.log(`${cli} ${version}; latest archived=${latestArchivedVersion(cli, files) ?? 'none'}`);
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  main();
}
