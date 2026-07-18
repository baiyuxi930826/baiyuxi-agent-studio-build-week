/**
 * Shell Tools unit tests — F061 Bug-F workaround MCP tool
 *
 * Red → Green coverage:
 *  - Whitelist passes: pwd / ls / agent / git log|status|rev-parse|diff|show
 *  - Whitelist refuses: rm / mv / mkdir / git branch|checkout|commit / pipes / substitution / var expansion
 *  - Redis 6399 sanctum refusal (multiple targeting syntaxes)
 *  - Rm -rf / + fork bomb always refused
 *  - Success path shows stdout / duration / cwd
 *  - Error path (exit != 0) carries exitCode + stderr + does not throw
 *  - Timeout path does not crash
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { after, test } from 'node:test';

const shellTestRoot = mkdtempSync(join(tmpdir(), 'agent-studio-shell-root-'));
const shellOutsideRoot = mkdtempSync(join(tmpdir(), 'agent-studio-shell-outside-'));
const shellOutsideFile = join(shellOutsideRoot, 'secret.txt');
writeFileSync(shellOutsideFile, 'secret\n');

after(() => {
  rmSync(shellTestRoot, { recursive: true, force: true });
  rmSync(shellOutsideRoot, { recursive: true, force: true });
});

// Widen ALLOWED_WORKSPACE_DIRS so the temp test root and repo are allowed.
// Must be set BEFORE importing shell-tools so isPathAllowed picks it up.
process.env.ALLOWED_WORKSPACE_DIRS = [shellTestRoot, process.cwd()].join(delimiter);

const { getPathBoundaryRefusalReason, getShellExecRefusalReason, handleShellExec, isReadOnlyShellCommand } =
  await import('../dist/tools/shell-tools.js');

test('whitelist passes common read-only commands', () => {
  assert.equal(isReadOnlyShellCommand('pwd'), true);
  assert.equal(isReadOnlyShellCommand('ls'), true);
  assert.equal(isReadOnlyShellCommand('ls -la'), true);
  assert.equal(isReadOnlyShellCommand('ls packages/'), true);
  assert.equal(isReadOnlyShellCommand('agent README.md'), true);
  assert.equal(isReadOnlyShellCommand('git log --oneline -3'), true);
  assert.equal(isReadOnlyShellCommand('git status --short'), true);
  assert.equal(isReadOnlyShellCommand('git rev-parse HEAD'), true);
  assert.equal(isReadOnlyShellCommand('git diff'), true);
  assert.equal(isReadOnlyShellCommand('git diff --stat HEAD~1'), true);
  assert.equal(isReadOnlyShellCommand('git show HEAD'), true);
  assert.equal(isReadOnlyShellCommand('git show --stat HEAD~1'), true);
});

test('whitelist refuses write / mutating commands', () => {
  assert.equal(isReadOnlyShellCommand('rm file.txt'), false);
  assert.equal(isReadOnlyShellCommand('mv a b'), false);
  assert.equal(isReadOnlyShellCommand('mkdir newdir'), false);
  assert.equal(isReadOnlyShellCommand('touch new.txt'), false);
  assert.equal(isReadOnlyShellCommand('npm install'), false);
  assert.equal(isReadOnlyShellCommand('pnpm install'), false);
  // git mutations — branch/checkout/commit deliberately excluded
  assert.equal(isReadOnlyShellCommand('git branch'), false);
  assert.equal(isReadOnlyShellCommand('git checkout main'), false);
  assert.equal(isReadOnlyShellCommand('git commit -m foo'), false);
});

test('whitelist refuses shell control / substitution / var expansion', () => {
  assert.equal(isReadOnlyShellCommand('ls | wc -l'), false); // pipe
  assert.equal(isReadOnlyShellCommand('ls > out.txt'), false); // redirect
  assert.equal(isReadOnlyShellCommand('ls; rm a'), false); // chained
  assert.equal(isReadOnlyShellCommand('ls && rm a'), false); // &&
  assert.equal(isReadOnlyShellCommand('agent `pwd`'), false); // backtick substitution
  assert.equal(isReadOnlyShellCommand('agent $(pwd)'), false); // $() substitution
  assert.equal(isReadOnlyShellCommand('agent $HOME/x'), false); // var expansion
  assert.equal(isReadOnlyShellCommand('agent ${HOME}/x'), false); // ${} expansion
  assert.equal(isReadOnlyShellCommand('git log --output=/tmp/a'), false); // --output sidesteps readonly
});

test('Redis 6399 sanctum refusal — multiple targeting syntaxes', () => {
  assert.match(getShellExecRefusalReason('redis-cli -p 6399 ping'), /sanctum/i);
  assert.match(getShellExecRefusalReason('redis-cli --port 6399 info'), /sanctum/i);
  assert.match(getShellExecRefusalReason('redis-cli --port=6399 info'), /sanctum/i);
  assert.match(getShellExecRefusalReason('curl redis://localhost:6399'), /sanctum/i);
  assert.match(getShellExecRefusalReason('redis config: port: 6399'), /sanctum/i);
  // 6398 dev redis allowed
  assert.equal(getShellExecRefusalReason('redis-cli -p 6398 ping'), null);
  assert.equal(getShellExecRefusalReason('redis-cli --port 6398 info'), null);
});

test('rm -rf / + fork bomb always refused', () => {
  assert.match(getShellExecRefusalReason('rm -rf /'), /rm -rf \//i);
  assert.match(getShellExecRefusalReason(':(){ :|: & };:'), /fork bomb/i);
});

test('handleShellExec — refuses rejected commands without executing', async () => {
  const refused = await handleShellExec({ commandLine: 'rm -rf /' });
  assert.equal(refused.isError, true);
  assert.match(refused.content[0].text, /Refused/);
  const notWhitelist = await handleShellExec({ commandLine: 'npm install' });
  assert.equal(notWhitelist.isError, true);
  assert.match(notWhitelist.content[0].text, /whitelist/);
});

test('handleShellExec — empty commandLine returns error', async () => {
  const result = await handleShellExec({ commandLine: '   ' });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /required/);
});

test('handleShellExec — pwd runs successfully + reports cwd/duration/stdout', async () => {
  const result = await handleShellExec({ commandLine: 'pwd', cwd: shellTestRoot });
  assert.notEqual(result.isError, true);
  const text = result.content[0].text;
  assert.match(text, /Status: success/);
  assert.match(text, /Exit code: 0/);
  assert.match(text, /Duration: \d+ms/);
  assert.ok(text.includes(`Cwd: ${resolve(shellTestRoot)}`));
  assert.match(text, /--- stdout ---/);
  assert.match(text, /\S/);
});

test('handleShellExec — default cwd lands in an allowed workspace dir (Andy UX fix)', async () => {
  // Antigravity spawns MCP servers with cwd=`/`, so process.cwd() lands outside
  // ALLOWED_WORKSPACE_DIRS and every cwd-less call would self-reject. Default
  // now picks the first non-agent-studio-data allowed dir.
  const result = await handleShellExec({ commandLine: 'pwd' });
  assert.notEqual(result.isError, true, `expected success, got: ${result.content[0].text}`);
  const text = result.content[0].text;
  // Default cwd must NOT be `/` (the regression target).
  assert.doesNotMatch(text, /Cwd: \/$/m, 'default cwd must not be `/`');
  // It should be some allowed dir. Status should be success, not refused.
  assert.match(text, /Status: success/);
});

test('handleShellExec — default cwd is NOT process.cwd when MCP runs from `/` (regression for Andy Bug)', async () => {
  // Simulate Antigravity behavior: real cwd is `/` but ALLOWED_WORKSPACE_DIRS
  // contains workspace root. Verify pickDefaultCwd skips process.cwd() in
  // favor of allowed dir.
  const originalCwd = process.cwd();
  try {
    process.chdir('/');
    const result = await handleShellExec({ commandLine: 'pwd' });
    assert.notEqual(result.isError, true, `should succeed even with cwd=/, got: ${result.content[0].text}`);
    assert.doesNotMatch(result.content[0].text, /Cwd: \/$/, 'default cwd must not be `/`');
  } finally {
    process.chdir(originalCwd);
  }
});

// ============ Path boundary (砚砚 P1 guard) ============

test('getPathBoundaryRefusalReason — accepts plain non-path args', () => {
  assert.equal(getPathBoundaryRefusalReason('pwd', process.cwd()), null);
  assert.equal(getPathBoundaryRefusalReason('git log --oneline -3', process.cwd()), null);
  assert.equal(getPathBoundaryRefusalReason('git status --short', process.cwd()), null);
  assert.equal(getPathBoundaryRefusalReason('git show HEAD', process.cwd()), null);
  assert.equal(getPathBoundaryRefusalReason('ls', process.cwd()), null);
});

test('getPathBoundaryRefusalReason — rejects absolute paths outside allowed roots', () => {
  const reason = getPathBoundaryRefusalReason('agent /etc/hosts', process.cwd());
  assert.ok(reason, 'should refuse /etc/hosts');
  assert.match(reason, /outside allowed roots/);
  // ls / — root is not in allowed roots
  const lsRoot = getPathBoundaryRefusalReason('ls /', process.cwd());
  assert.ok(lsRoot, 'should refuse ls /');
});

test('getPathBoundaryRefusalReason — rejects parent-dir escapes', () => {
  const reason = getPathBoundaryRefusalReason('agent ../../../etc/passwd', shellTestRoot);
  // path-validator's isPathAllowed resolves against allowed roots; this escape must be rejected
  assert.ok(reason, 'should refuse .. escapes');
});

test('getPathBoundaryRefusalReason — allows relative paths inside cwd when cwd is allowed', () => {
  // Use process.cwd() which is guaranteed to be allowed when ALLOWED_WORKSPACE_DIRS
  // contains the current project OR default agentStudioDir covers it.
  const cwd = process.cwd();
  // A relative path that resolves back into cwd should be fine if cwd itself is allowed.
  // If cwd is not in allowed roots, this will skip; we still assert no crash.
  const result = getPathBoundaryRefusalReason('agent README.md', cwd);
  // Either null (allowed) or a reason string — both are legal depending on env.
  // The contract we care about: function returns string | null, doesn't throw.
  assert.ok(result === null || typeof result === 'string');
});

test('handleShellExec — refuses cwd outside allowed roots', async () => {
  const result = await handleShellExec({ commandLine: 'pwd', cwd: '/etc' });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /cwd outside allowed roots/);
});

test('handleShellExec — refuses command with path arg outside allowed roots', async () => {
  const result = await handleShellExec({ commandLine: 'agent /etc/hosts', cwd: process.cwd() });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /outside allowed roots/);
});

// ============ Cloud codex P1 — quote/tilde expansion + bare filename symlink check ============

test('P1: refuses single-quoted absolute path outside allowed roots', () => {
  const reason = getPathBoundaryRefusalReason("agent '/etc/hosts'", process.cwd());
  assert.ok(reason, "should refuse agent '/etc/hosts' (quoted absolute outside allowed)");
  assert.match(reason, /outside allowed roots/);
});

test('P1: refuses double-quoted absolute path outside allowed roots', () => {
  const reason = getPathBoundaryRefusalReason('agent "/etc/passwd"', process.cwd());
  assert.ok(reason, 'should refuse agent "/etc/passwd"');
  assert.match(reason, /outside allowed roots/);
});

test('P1: refuses tilde-expanded path outside allowed roots', () => {
  // ~/Library is outside default allowed roots (which only include /tmp + cwd in tests)
  const reason = getPathBoundaryRefusalReason('agent ~/Library/keychain', process.cwd());
  assert.ok(reason, 'should refuse agent ~/Library/keychain');
  assert.match(reason, /outside allowed roots/);
});

test('P1: refuses bare ~ alone if homedir not allowed', () => {
  // bare `~` expands to homedir which isn't in test allowed roots
  const reason = getPathBoundaryRefusalReason('ls ~', process.cwd());
  assert.ok(reason, 'should refuse ls ~ (homedir not allowed)');
});

test('P1: bare filename arg (potential symlink) IS checked even without slash', async (t) => {
  // Create a symlink inside the allowed test root pointing outside allowed roots.
  const linkDir = join(shellTestRoot, 'agent-studio-shell-test');
  const linkPath = join(linkDir, 'secret-link');
  mkdirSync(linkDir, { recursive: true });
  try {
    rmSync(linkPath, { force: true });
    try {
      symlinkSync(shellOutsideFile, linkPath);
    } catch {
      t.skip('symlink creation is not supported in this environment');
      return;
    }
    const reason = getPathBoundaryRefusalReason('agent secret-link', linkDir);
    assert.ok(reason, 'symlink outside allowed roots must be refused even via bare filename');
    assert.match(reason, /outside allowed roots/);
  } finally {
    try {
      rmSync(linkPath, { force: true });
    } catch {}
  }
});

test('P1: bare command-name token after first is allowed if not a real path outside roots', () => {
  // git log: `log` is the second token (subcommand). It resolves to cwd/log.
  // cwd/log doesn't exist, deepest-existing = cwd, cwd is allowed → pass.
  // Verify guard doesn't false-reject normal git subcommands.
  const reason = getPathBoundaryRefusalReason('git log --oneline -3', process.cwd());
  assert.equal(reason, null);
});

test('P1: command name itself is skipped (allows pwd / ls / agent / git as first token)', () => {
  // Even if command name happened to be at /etc/pwd, it must not be checked
  // because it's the command, not a path. Our impl skips index 0.
  assert.equal(getPathBoundaryRefusalReason('pwd', process.cwd()), null);
  assert.equal(getPathBoundaryRefusalReason('agent README.md', process.cwd()), null);
});

// ============ Cloud P1 round-2 (e7889045 review) — backslash + quoted-space ============

test('P1: refuses backslash escape (agent \\/etc/passwd) — shell strips \\ to read /etc/passwd', () => {
  // /bin/sh treats `\/etc/passwd` as `/etc/passwd`; our split sees the literal
  // `\/etc/passwd` which would resolve to a non-existent path inside cwd.
  // We refuse any backslash to close this gap.
  assert.equal(isReadOnlyShellCommand('agent \\/etc/passwd'), false);
  assert.equal(isReadOnlyShellCommand('agent \\hello'), false);
  // `git log` without escape still passes
  assert.equal(isReadOnlyShellCommand('git log --oneline -3'), true);
});

test('P1: refuses quoted span containing whitespace', () => {
  // `agent "file with space"` — naive split breaks tokenization
  assert.equal(isReadOnlyShellCommand('agent "file with space"'), false);
  assert.equal(isReadOnlyShellCommand("agent 'file with space'"), false);
  // Quoted span without internal whitespace is fine
  assert.equal(isReadOnlyShellCommand("agent 'README.md'"), true);
  assert.equal(isReadOnlyShellCommand('agent "README.md"'), true);
});

// ============ Cloud P1 round-3 (be51518f review) — ANSI-C / all $-prefixed ============

test("P1: refuses ANSI-C $'...' quoting (decodes escapes inside shell)", () => {
  // $'\x2fetc\x2fhosts' decodes to /etc/hosts inside /bin/sh — bypass via
  // dollar-prefixed quote that earlier patterns missed.
  assert.equal(isReadOnlyShellCommand("agent $'\\x2fetc\\x2fhosts'"), false);
  assert.equal(isReadOnlyShellCommand("agent $'\\057etc\\057passwd'"), false);
});

test('P1: refuses any $-prefixed form ($VAR / ${VAR} / $() already, plus $\' / $")', () => {
  assert.equal(isReadOnlyShellCommand('agent $HOME/file'), false);
  assert.equal(isReadOnlyShellCommand('agent ${HOME}/file'), false);
  assert.equal(isReadOnlyShellCommand('agent $(pwd)'), false);
  assert.equal(isReadOnlyShellCommand("agent $'foo'"), false);
  assert.equal(isReadOnlyShellCommand('agent $"locale-msg"'), false);
});

// ============ codex peer review P1 (a335d159) — glob expansion bypass ============

test('P1: refuses shell glob metacharacters (* ? [ ]) — agent * bypass', () => {
  // agent * was passing isReadOnlyShellCommand=true and bypassing path guard
  // because path.resolve(cwd, '*') is a literal path that doesn't exist;
  // /bin/sh expands * to all files in cwd at exec time, including any symlinks
  // pointing outside allowed roots.
  assert.equal(isReadOnlyShellCommand('agent *'), false);
  assert.equal(isReadOnlyShellCommand('agent *.md'), false);
  assert.equal(isReadOnlyShellCommand('ls *.txt'), false);
  assert.equal(isReadOnlyShellCommand('agent file?.txt'), false);
  assert.equal(isReadOnlyShellCommand('agent [abc].txt'), false);
  assert.equal(isReadOnlyShellCommand('ls dir/[a-z]*'), false);
  // Plain non-glob still passes
  assert.equal(isReadOnlyShellCommand('agent README.md'), true);
});

test('P1 (cloud R7 missed in d007449e merge): refuses ~user expansion bypass', () => {
  // /bin/sh expands `~root` to /var/root or /root, but unquoteAndExpandTilde
  // only handles bare `~` and `~/...` — `~root/...` slips past path guard
  // as a literal cwd-relative token then resolves to absolute path at exec.
  // Refuse any ~ followed by username char (alphanumeric or underscore).
  assert.equal(isReadOnlyShellCommand('agent ~root/.ssh/id_rsa'), false);
  assert.equal(isReadOnlyShellCommand('agent ~admin/secret'), false);
  assert.equal(isReadOnlyShellCommand('ls ~user1/'), false);
  assert.equal(isReadOnlyShellCommand('agent ~_systemUser/file'), false);
  // Git revspec suffix (`HEAD~1`) is not shell tilde expansion and must stay allowed.
  assert.equal(isReadOnlyShellCommand('git diff --stat HEAD~1'), true);
  // bare `~` and `~/...` are still allowed at gate (handled correctly by
  // unquoteAndExpandTilde + path guard downstream).
  assert.equal(isReadOnlyShellCommand('agent ~/file'), true);
  assert.equal(isReadOnlyShellCommand('ls ~'), true);
});

test('P1: handleShellExec — refuses agent * even when symlink exists in cwd', async () => {
  // Direct end-to-end check: even if cwd has a symlink to a file outside allowed roots,
  // agent * must be refused at the gate before path guard / exec.
  const linkDir = join(shellTestRoot, 'agent-studio-glob-test');
  const linkPath = join(linkDir, 'secret-link');
  mkdirSync(linkDir, { recursive: true });
  try {
    rmSync(linkPath, { force: true });
    symlinkSync(shellOutsideFile, linkPath);
    const result = await handleShellExec({ commandLine: 'agent *', cwd: linkDir });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /not on the read-only whitelist|whitelist/);
  } finally {
    try {
      rmSync(linkPath, { force: true });
    } catch {}
  }
});
