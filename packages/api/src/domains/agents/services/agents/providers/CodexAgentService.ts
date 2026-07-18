/**
 * Codex Agent Service
 * 使用 Codex CLI 子进程调用Owen（验证与审查） (Codex)
 *
 * CLI 调用方式:
 *   codex exec --json --sandbox danger-full-access --add-dir .git --config approval_policy="on-request" "prompt"
 *   codex exec resume SESSION_ID --json --config approval_policy="on-request" "prompt"
 *
 * NDJSON 事件格式:
 *   thread.started  → session_init (含 thread_id)
 *   item.started (command_execution) → tool_use
 *   item.completed (agent_message) → text
 *   item.completed (command_execution) → tool_result
 *   item.completed (file_change) → tool_use
 *   turn.started / turn.completed / 其余 item 事件 → 跳过
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type AgentId, createAgentId } from '@agent-studio/shared';
import { getAgentContextWindowConfig, getAgentEffort } from '../../../../../config/agent-config-loader.js';
import { getAgentModel } from '../../../../../config/agent-models.js';
import { getCodexApprovalPolicy, getCodexSandboxMode } from '../../../../../config/codex-cli.js';
import { getContextWindowFallback } from '../../../../../config/context-window-sizes.js';
import { estimateCostFromTokens } from '../../../../../config/model-pricing.js';
import { createModuleLogger } from '../../../../../infrastructure/logger.js';
import { formatCliExitError } from '../../../../../utils/cli-format.js';
import { formatCliNotFoundError, resolveCliCommand } from '../../../../../utils/cli-resolve.js';
import { isCliError, isCliTimeout, isLivenessWarning, spawnCli } from '../../../../../utils/cli-spawn.js';
import type { SpawnFn } from '../../../../../utils/cli-types.js';
import { sanitizeCliStderr } from '../../../../../utils/sanitize-cli-stderr.js';
import { AuditEventTypes, getEventAuditLog } from '../../orchestration/EventAuditLog.js';
import { CliRawArchive } from '../../session/CliRawArchive.js';
import type { AgentMessage, AgentService, AgentServiceOptions, MessageMetadata, TokenUsage } from '../../types.js';
import type { AuditLogSink, RawArchiveSink } from '../providers/codex-audit-hooks.js';
import { extractCommandExecutionLifecycle, sanitizeRawEvent } from '../providers/codex-audit-hooks.js';
import { type CodexStreamState, transformCodexEvent } from '../providers/codex-event-transform.js';
import { scanAndPublishCodexImages } from '../providers/codex-image-scanner.js';
import {
  type CodexSessionContextSnapshotResolver,
  createCodexSessionContextSnapshotResolver,
} from '../providers/codex-session-context-snapshot.js';
import { extractImagePaths } from '../providers/image-paths.js';
import { compileL0ViaSubprocess } from './l0-compiler.js';

const log = createModuleLogger('codex-agent');

/** Redact a custom base URL for diagnostic logging — expose protocol+host only. */
function redactUrlForLog(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return '[invalid-url]';
  }
}

/**
 * Options for constructing CodexAgentService (dependency injection)
 * F32-b: agentId and model are constructor parameters
 */
interface CodexAgentServiceOptions {
  /** F32-b: agentId for this instance (default: 'codex') */
  agentId?: AgentId;
  /** F32-b: model override (default: resolved via getAgentModel) */
  model?: string;
  /** Inject a custom spawn function (for testing) */
  spawnFn?: SpawnFn;
  /** Test seam — replaces the real L0 compiler subprocess (Task 3a). */
  l0CompilerFn?: typeof compileL0ViaSubprocess;
  /** Inject audit log sink (for testing) */
  auditLog?: AuditLogSink;
  /** Inject raw archive sink (for testing) */
  rawArchive?: RawArchiveSink;
  /** Inject session context resolver (for testing) */
  contextSnapshotResolver?: CodexSessionContextSnapshotResolver;
  /** Override executable name/path for Codex-family CLIs. */
  cliCommand?: string;
  /** Test seam for direct Responses fallback when a custom provider breaks Codex CLI streaming. */
  directResponsesFetch?: DirectResponsesFetch;
}

type CodexAuthMode = 'oauth' | 'api_key' | 'auto';
type CodexApiKeyTransport = 'cli' | 'responses';

type DirectResponsesFetch = (
  input: string,
  init: {
    method: 'POST';
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  statusText?: string;
  body?: ReadableStream<Uint8Array> | null;
  text: () => Promise<string>;
}>;

interface DirectResponsesFallbackChunk {
  text?: string;
  usage?: TokenUsage;
}

function getCodexAuthMode(callbackEnv?: Record<string, string>): CodexAuthMode {
  const raw = callbackEnv?.CODEX_AUTH_MODE?.trim().toLowerCase();
  if (raw === 'api_key' || raw === 'auto' || raw === 'oauth') return raw;
  return 'oauth';
}

function getCodexApiKeyTransport(
  callbackEnv?: Record<string, string>,
  accountEnv?: Record<string, string>,
): CodexApiKeyTransport {
  const raw =
    callbackEnv?.AGENT_CODEX_API_KEY_TRANSPORT ??
    accountEnv?.AGENT_CODEX_API_KEY_TRANSPORT ??
    process.env.AGENT_CODEX_API_KEY_TRANSPORT;
  const normalized = raw?.trim().toLowerCase();
  if (normalized === 'cli' || normalized === 'codex' || normalized === 'codex_cli') return 'cli';
  return 'responses';
}

function applyAuthMode(env: Record<string, string>, authMode: CodexAuthMode): Record<string, string | null> {
  if (authMode !== 'oauth') return env;

  // OAuth-first default: explicitly delete key-based credentials from child env.
  // spawnCli interprets `null` as "remove this key from inherited process.env".
  return {
    ...env,
    OPENAI_API_KEY: null,
    OPENAI_BASE_URL: null,
    OPENAI_API_BASE: null,
    OPENAI_ORG_ID: null,
    OPENAI_ORGANIZATION: null,
  };
}

function sanitizeCodexChildEnv(env: Record<string, string | null>): Record<string, string | null> {
  return {
    ...env,
    // Prevent ambient user-shell or Codex Desktop env from silently overriding
    // this invocation's explicit provider config.
    OPENAI_BASE_URL: env.OPENAI_BASE_URL ?? null,
    OPENAI_API_BASE: env.OPENAI_API_BASE ?? null,
    LOCAL_API_KEY: null,
  };
}

function resolveCodexCliCommandOverride(): string | undefined {
  const raw = process.env.AGENT_CODEX_CLI_COMMAND?.trim();
  return raw || undefined;
}

const MAX_RECENT_STREAM_ERRORS = 5;
const MAX_STREAM_ERROR_LENGTH = 240;

function collectCodexStreamError(event: unknown, recentErrors: string[]): void {
  if (typeof event !== 'object' || event === null) return;
  const record = event as Record<string, unknown>;
  if (record.type !== 'error') return;
  const raw = record.message;
  if (typeof raw !== 'string') return;

  const msg = sanitizeCliStderr(raw.trim()).slice(0, MAX_STREAM_ERROR_LENGTH);
  if (!msg) return;

  const last = recentErrors[recentErrors.length - 1];
  if (last === msg) return;

  recentErrors.push(msg);
  if (recentErrors.length > MAX_RECENT_STREAM_ERRORS) {
    recentErrors.shift();
  }
}

function withRecentDiagnostics(base: string, recentErrors: string[]): string {
  if (recentErrors.length === 0) return base;
  const lines = recentErrors.map((line) => `- ${line}`);
  return `${base}\n最近流错误:\n${lines.join('\n')}`;
}

function shouldUseDirectResponsesFallback(
  event: {
    exitCode: number | null;
    signal?: string | null;
    message?: string;
    reasonCode?: string;
    cliDiagnostics?: { reasonCode?: string; safeExcerpt?: string };
  },
  recentErrors: string[],
): boolean {
  const reasonCode = event.reasonCode ?? event.cliDiagnostics?.reasonCode;
  if (event.exitCode !== 1 || event.signal != null || reasonCode !== 'network_error') return false;
  const diagnosticText = [event.message, event.cliDiagnostics?.safeExcerpt, ...recentErrors]
    .filter((value): value is string => Boolean(value))
    .join('\n');
  return /stream disconnected before completion|stream closed before response\.completed/i.test(diagnosticText);
}

function isCodexResponsesStreamReconnectProgress(event: unknown): boolean {
  if (typeof event !== 'object' || event === null) return false;
  const record = event as Record<string, unknown>;
  if (record.type !== 'error' || typeof record.message !== 'string') return false;

  const message = record.message.trim();
  return (
    message.startsWith('Reconnecting...') &&
    /stream disconnected before completion|stream closed before response\.completed/i.test(message)
  );
}

function buildResponsesUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  return /\/v1$/i.test(trimmed) ? `${trimmed}/responses` : `${trimmed}/v1/responses`;
}

function extractResponseText(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.output_text === 'string' && record.output_text.trim()) return record.output_text;

  const chunks: string[] = [];
  const output = Array.isArray(record.output) ? record.output : [];
  for (const item of output) {
    if (typeof item !== 'object' || item === null) continue;
    const content = Array.isArray((item as Record<string, unknown>).content)
      ? ((item as Record<string, unknown>).content as unknown[])
      : [];
    for (const part of content) {
      if (typeof part !== 'object' || part === null) continue;
      const text = (part as Record<string, unknown>).text;
      if (typeof text === 'string' && text) chunks.push(text);
    }
  }
  const text = chunks.join('');
  return text.trim() ? text : null;
}

function extractResponseUsage(value: unknown): TokenUsage | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const usage = (value as Record<string, unknown>).usage;
  if (typeof usage !== 'object' || usage === null) return undefined;
  const u = usage as Record<string, unknown>;
  const out: TokenUsage = {};
  if (typeof u.input_tokens === 'number') {
    out.inputTokens = u.input_tokens;
    out.lastTurnInputTokens = u.input_tokens;
  }
  if (typeof u.output_tokens === 'number') out.outputTokens = u.output_tokens;
  if (typeof u.total_tokens === 'number') out.totalTokens = u.total_tokens;
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseSseDataFrame(frame: string): string | null {
  const dataLines: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  return dataLines.length > 0 ? dataLines.join('\n') : null;
}

function extractResponsesStreamDelta(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.type !== 'response.output_text.delta') return null;
  const delta = record.delta ?? record.text;
  return typeof delta === 'string' && delta.length > 0 ? delta : null;
}

function extractResponsesStreamUsage(value: unknown): TokenUsage | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  return record.type === 'response.completed' ? extractResponseUsage(record.response) : undefined;
}

function extractResponsesStreamError(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.type !== 'error' && record.type !== 'response.failed') return null;

  const error = record.error;
  if (typeof error === 'object' && error !== null) {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === 'string' && message.trim()) return message;
  }

  const message = record.message;
  return typeof message === 'string' && message.trim() ? message : 'Responses fallback stream failed';
}

function hasNonSuppressibleCodexExitOneDiagnostics(
  event: {
    message?: string;
    cliDiagnostics?: { publicSummary?: string; safeExcerpt?: string };
  },
  recentErrors: string[],
): boolean {
  const diagnosticText = [
    event.message,
    event.cliDiagnostics?.publicSummary,
    event.cliDiagnostics?.safeExcerpt,
    ...recentErrors,
  ]
    .filter((value): value is string => Boolean(value))
    .join('\n');

  return /remote compaction failed|compact_error/i.test(diagnosticText);
}

function toTomlString(value: string): string {
  const escaped = value.replace(/[\u0000-\u001f\u007f"\\]/g, (char) => {
    switch (char) {
      case '\\':
        return '\\\\';
      case '"':
        return '\\"';
      case '\b':
        return '\\b';
      case '\t':
        return '\\t';
      case '\n':
        return '\\n';
      case '\f':
        return '\\f';
      case '\r':
        return '\\r';
      default:
        return `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`;
    }
  });
  return `"${escaped}"`;
}

/**
 * F203 Phase C — `--config` keys the system controls. User cliConfigArgs
 * cannot override these. Currently `developer_instructions` carries the
 * compiled L0 (identity / 家规 invariant). Adding here without updating
 * the F203 spec is a P1 — silent system-config drop hides L0 from the agent.
 * (砚砚 review 2026-05-16 BLOCKING finding.)
 */
const RESERVED_SYSTEM_CONFIG_KEYS: ReadonlySet<string> = new Set(['developer_instructions']);

/**
 * Strip `--config <key=value>` / `-c <key=value>` pairs from a pre-split
 * cliConfigArgs array when `key` is reserved. The downstream `dedup()`
 * would otherwise skip the system push for any key already in
 * userConfigKeys — silently dropping the L0 the moment a user adds the
 * same key. `-c` is the documented short alias of `--config` per
 * `codex exec --help` so both forms must be intercepted (云端 Codex
 * P1-cloud-2, 2026-05-16).
 */
function stripReservedSystemConfigs(args: string[], agentId: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if ((a === '--config' || a === '-c') && i + 1 < args.length) {
      const key = args[i + 1].split('=')[0];
      if (key && RESERVED_SYSTEM_CONFIG_KEYS.has(key)) {
        log.warn({ agentId, key, form: a }, 'cliConfigArgs override of reserved system config key dropped');
        i++; // also skip the value pair
        continue;
      }
    }
    out.push(a);
  }
  return out;
}

/**
 * F041/F043 root fix:
 * Ensure Codex subprocess always receives agent-studio MCP server config
 * based on the current thread working directory.
 */
// F193 Phase C: split-only. Legacy `agent-studio` (all-in-one via
// registerFullToolset) is no longer auto-provisioned because it exposes
// tool surfaces now hosted directly by split servers — keeping both would
// duplicate split tool surfaces in Codex sessions (cloud round 6 P1).
const AGENT_STUDIO_MCP_SERVER_ENTRIES = [
  ['agent-studio-collab', 'collab.js'],
  ['agent-studio-memory', 'memory.js'],
  ['agent-studio-signals', 'signals.js'],
  ['agent-studio-limb', 'limb.js'],
  ['agent-studio-finance', 'finance.js'],
] as const;
const AGENT_STUDIO_MCP_CALLBACK_ENV_KEYS = [
  'AGENT_STUDIO_API_URL',
  'AGENT_STUDIO_INVOCATION_ID',
  'AGENT_STUDIO_CALLBACK_TOKEN',
  'AGENT_STUDIO_THREAD_ID',
  'AGENT_STUDIO_USER_ID',
  'AGENT_STUDIO_AGENT_ID',
  'AGENT_STUDIO_SIGNAL_USER',
] as const;

function resolveAllowedWorkspaceDirsForMcp(workingDirectory?: string): string {
  const explicitAllowed = process.env.ALLOWED_WORKSPACE_DIRS?.trim();
  if (explicitAllowed) return explicitAllowed;
  const threadWorkspace = workingDirectory?.trim();
  if (threadWorkspace) return resolve(threadWorkspace);
  const explicitWorkspace = process.env.AGENT_STUDIO_WORKSPACE_ROOT?.trim();
  if (explicitWorkspace) return explicitWorkspace;
  return process.cwd();
}

function pushAgentStudioMcpEnvConfig(
  args: string[],
  serverName: string,
  allowedWorkspaceDirs: string,
  callbackEnv?: Record<string, string>,
): void {
  args.push('--config', `mcp_servers.${serverName}.env.ALLOWED_WORKSPACE_DIRS=${toTomlString(allowedWorkspaceDirs)}`);

  for (const key of AGENT_STUDIO_MCP_CALLBACK_ENV_KEYS) {
    const value = callbackEnv?.[key];
    if (!value) continue;
    args.push('--config', `mcp_servers.${serverName}.env.${key}=${toTomlString(value)}`);
  }
}

function buildAgentStudioMcpConfigArgs(workingDirectory?: string, callbackEnv?: Record<string, string>): string[] {
  const fileDir = dirname(fileURLToPath(import.meta.url));
  // The thread workingDirectory is the user's project/workspace. Agent Studio MCP
  // binaries are runtime-owned, so resolving from workingDirectory can pick a
  // fork checkout with incomplete node_modules and silently drop all MCP tools.
  const candidateRoots = [
    process.env.AGENT_STUDIO_RUNTIME_ROOT?.trim(),
    process.cwd(),
    // file path: packages/api/src/domains/agents/services/agents/providers/CodexAgentService.ts
    // repo root = dirname(fileURLToPath(import.meta.url)) up to .../agent-studio
    resolve(fileDir, '../../../../../../../..'),
  ].filter((root): root is string => !!root);

  let mcpDistDir: string | undefined;
  for (const root of candidateRoots) {
    const candidate = resolve(root, 'packages/mcp-server/dist');
    if (existsSync(resolve(candidate, 'index.js'))) {
      mcpDistDir = candidate;
      break;
    }
  }
  if (!mcpDistDir) return [];

  const args: string[] = [];
  const allowedWorkspaceDirs = resolveAllowedWorkspaceDirsForMcp(workingDirectory);

  // F213 (2026-05-26, post 砚砚 review P2 fix): L4 per-invocation dummy disabled
  // override for the legacy `agent-studio` server. L5 startup cleanup
  // (`mcp-config-adapters.ts` writers + `deprecated-managed-servers.ts` registry)
  // only writes to `<projectRoot>/.codex/config.toml`, so legacy entries in
  // user-level (`~/.codex/config.toml`), `$CODEX_HOME/config.toml`, or system
  // (`/etc/codex/config.toml`) config files survive cleanup. Without this L4
  // override, codex would load those surviving legacy entries with no
  // callback env → fail closed.
  //
  // Dummy disabled form (echo + legacy-shim + enabled=false) verified by 砚砚
  // strict-npm-Codex reproducer: passes config parse (complete transport
  // definition, not partial) + codex skips server startup (enabled=false).
  // Per-invocation `--config` is the highest priority override, beating any
  // legacy entry from any source. This is L4's runtime safety net for the
  // case L5 cleanup cannot prove ownership.
  //
  // See ADR-036 amendment 2026-05-26 + `docs/features/F213-stale-mcp-config-cleanup.md`
  // + `docs/discussions/2026-05-26-codex-mcp-legacy-deprecation/README.md` §6.2.
  args.push(
    '--config',
    'mcp_servers.agent-studio.command="echo"',
    '--config',
    `mcp_servers.agent-studio.args=[${toTomlString('legacy-shim')}]`,
    '--config',
    'mcp_servers.agent-studio.enabled=false',
  );

  for (const [serverName, entrypoint] of AGENT_STUDIO_MCP_SERVER_ENTRIES) {
    const serverPath = resolve(mcpDistDir, entrypoint);
    if (!existsSync(serverPath)) continue;

    args.push(
      '--config',
      `mcp_servers.${serverName}.command="node"`,
      '--config',
      `mcp_servers.${serverName}.args=[${toTomlString(serverPath)}]`,
      '--config',
      `mcp_servers.${serverName}.enabled=true`,
      '--config',
      `mcp_servers.${serverName}.default_tools_approval_mode="approve"`,
    );

    pushAgentStudioMcpEnvConfig(args, serverName, allowedWorkspaceDirs, callbackEnv);
  }

  return args;
}

export function isGitRepositoryPath(workingDirectory: string): boolean {
  let current = resolve(workingDirectory);
  while (true) {
    if (existsSync(join(current, '.git'))) {
      return true;
    }

    const root = parse(current).root;
    if (current === root) {
      return false;
    }

    const parent = dirname(current);
    if (parent === current) {
      return false;
    }
    current = parent;
  }
}

function buildGitRepoArgs(workingDirectory?: string): string[] {
  const repoCheckDir = workingDirectory ?? process.cwd();
  return isGitRepositoryPath(repoCheckDir) ? [] : ['--skip-git-repo-check'];
}

function shouldInjectCustomModelCatalog(model: string): boolean {
  return /^grok-/i.test(model);
}

function resolveCodexContextWindowConfig(
  agentId: string,
  model: string,
): { contextWindow: number; autoCompactTokenLimit: number } | undefined {
  const configured = getAgentContextWindowConfig(agentId);
  if (configured) return configured;

  const fallback = getContextWindowFallback(model);
  if (!fallback) return undefined;
  return {
    contextWindow: fallback,
    autoCompactTokenLimit: Math.floor(fallback * 0.88),
  };
}

function buildCustomCodexModelCatalogJson(model: string, contextWindow: number): string {
  return JSON.stringify({
    fetched_at: new Date(0).toISOString(),
    models: [
      {
        slug: model,
        display_name: model,
        description: 'Custom OpenAI-compatible model',
        default_reasoning_level: 'medium',
        supported_reasoning_levels: [
          { effort: 'low', description: 'Fast responses with lighter reasoning' },
          { effort: 'medium', description: 'Balanced reasoning depth' },
          { effort: 'high', description: 'Greater reasoning depth for complex problems' },
          { effort: 'xhigh', description: 'Extra high reasoning depth for complex problems' },
        ],
        shell_type: 'shell_command',
        visibility: 'list',
        supported_in_api: true,
        priority: 1,
        additional_speed_tiers: [],
        service_tiers: [],
        availability_nux: null,
        upgrade: null,
        base_instructions: 'You are Codex, a coding agent. Follow the developer instructions and the user request.',
        model_messages: {
          instructions_template:
            'You are Codex, a coding agent. Follow the developer instructions and the user request.\n\n{{ personality }}',
          instructions_variables: {
            personality_default: '',
            personality_friendly: '',
            personality_pragmatic: '',
          },
        },
        supports_reasoning_summaries: true,
        default_reasoning_summary: 'none',
        support_verbosity: true,
        default_verbosity: 'low',
        apply_patch_tool_type: 'freeform',
        web_search_tool_type: 'text_and_image',
        truncation_policy: { mode: 'tokens', limit: 10_000 },
        supports_parallel_tool_calls: true,
        supports_image_detail_original: true,
        context_window: contextWindow,
        max_context_window: contextWindow,
        effective_context_window_percent: 95,
        experimental_supported_tools: [],
        input_modalities: ['text', 'image'],
        supports_search_tool: true,
      },
    ],
  });
}

function writeCustomCodexModelCatalogFile(
  model: string,
  contextWindow: number,
): {
  args: string[];
  tempDir: string;
} {
  const tempDir = mkdtempSync(join(tmpdir(), 'codex-model-catalog-'));
  const catalogPath = join(tempDir, 'model-catalog.json');
  writeFileSync(catalogPath, buildCustomCodexModelCatalogJson(model, contextWindow));
  return {
    args: ['--config', `model_catalog_json=${toTomlString(catalogPath)}`],
    tempDir,
  };
}

/**
 * Service for invoking Codex via CLI subprocess.
 * Uses ChatGPT Plus/Pro subscription instead of API key.
 */
export class CodexAgentService implements AgentService {
  readonly agentId: AgentId;
  private readonly spawnFn: SpawnFn | undefined;
  private readonly model: string;
  private readonly auditLog: AuditLogSink;
  private readonly rawArchive: RawArchiveSink;
  private readonly contextSnapshotResolver: CodexSessionContextSnapshotResolver;
  private readonly cliCommand: string;
  private readonly directResponsesFetch: DirectResponsesFetch;
  /** F203 Phase C: compiles per-agent L0 → OpenAI developer role (-c). */
  private readonly l0CompilerFn: typeof compileL0ViaSubprocess;

  constructor(options?: CodexAgentServiceOptions) {
    this.agentId = options?.agentId ?? createAgentId('codex');
    this.spawnFn = options?.spawnFn;
    this.l0CompilerFn = options?.l0CompilerFn ?? compileL0ViaSubprocess;
    this.model = options?.model ?? getAgentModel(this.agentId as string);
    this.auditLog = options?.auditLog ?? getEventAuditLog();
    this.rawArchive = options?.rawArchive ?? new CliRawArchive();
    this.contextSnapshotResolver = options?.contextSnapshotResolver ?? createCodexSessionContextSnapshotResolver();
    this.cliCommand = options?.cliCommand ?? resolveCodexCliCommandOverride() ?? 'codex';
    this.directResponsesFetch = options?.directResponsesFetch ?? fetch;
  }

  /** F203 Phase C — this service injects L0 via `-c developer_instructions=` (Task 4). */
  injectsL0Natively(): boolean {
    return true;
  }

  /**
   * F177 Phase H (KD-13) — codex-family runs via `codex exec --json`, which does
   * NOT dispatch ~/.codex/hooks.json Stop hooks (H0 spike 2026-06-11), so the
   * Claude Code F177-G routing guard never fires for codex/gpt52. The serial
   * route layer applies a server-side remedial guard instead. Covers all
   * CodexAgentService instances (codex GPT-5.5 + gpt52 GPT-5.4).
   *
   * NOTE: do NOT derive this from injectsL0Natively() — codex injects L0
   * natively yet still needs the guard, so the two capabilities are orthogonal.
   */
  needsServerRoutingGuard(): boolean {
    return true;
  }

  private async *invokeDirectResponsesFallback(args: {
    baseUrl: string;
    apiKey: string;
    model: string;
    prompt: string;
    developerInstructions?: string;
    signal?: AbortSignal;
  }): AsyncGenerator<DirectResponsesFallbackChunk, void, undefined> {
    const requestBody = {
      model: args.model,
      input: args.prompt,
      ...(args.developerInstructions?.trim() ? { instructions: args.developerInstructions } : {}),
      stream: true,
      store: false,
    };
    const response = await this.directResponsesFetch(buildResponsesUrl(args.baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      ...(args.signal ? { signal: args.signal } : {}),
    });

    if (!response.ok) {
      throw new Error(
        `Responses fallback failed with HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`,
      );
    }

    if (!response.body) {
      const raw = await response.text();
      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        throw new Error('Responses fallback returned invalid JSON');
      }

      const text = extractResponseText(json);
      if (!text) throw new Error('Responses fallback returned no text');
      yield { text };
      const usage = extractResponseUsage(json);
      if (usage) yield { usage };
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let sawText = false;
    let finalUsage: TokenUsage | undefined;

    const consumeFrame = function* (frame: string): Generator<DirectResponsesFallbackChunk> {
      const data = parseSseDataFrame(frame);
      if (!data || data === '[DONE]') return;

      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        return;
      }

      const error = extractResponsesStreamError(parsed);
      if (error) throw new Error(error);

      const delta = extractResponsesStreamDelta(parsed);
      if (delta) {
        sawText = true;
        yield { text: delta };
      }

      const usage = extractResponsesStreamUsage(parsed);
      if (usage) finalUsage = usage;
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

      let frameEnd = buffer.indexOf('\n\n');
      while (frameEnd >= 0) {
        const frame = buffer.slice(0, frameEnd);
        buffer = buffer.slice(frameEnd + 2);
        yield* consumeFrame(frame);
        frameEnd = buffer.indexOf('\n\n');
      }
    }

    buffer += decoder.decode().replace(/\r\n/g, '\n');
    if (buffer.trim()) {
      yield* consumeFrame(buffer);
    }

    if (!sawText) {
      throw new Error('Responses fallback returned no text');
    }
    if (finalUsage) {
      yield { usage: finalUsage };
    }
  }

  /**
   * F203 Phase C: compile per-agent L0 → `-c developer_instructions=` argv
   * (S4-verified, 砚砚 62b9255e2 — enters the OpenAI `developer` role,
   * additive, NOT replacing Codex's base instructions; per-invocation argv,
   * NOT ~/.codex/config.toml which would race @codex/@gpt52/@spark).
   * fail-closed: on compile failure return an error descriptor (caller yields
   * error + done + return, mirroring the CLI-not-found path) — a missing L0
   * = a agent with no identity/家规, strictly worse than a failed invocation.
   */
  private async compileDeveloperInstructionsArgs(
    cliModel: string,
  ): Promise<{ args: string[]; instructions: string } | { error: string; metadata: MessageMetadata }> {
    try {
      const compiledL0 = await this.l0CompilerFn({ agentId: this.agentId as string });
      return { args: ['--config', `developer_instructions=${toTomlString(compiledL0)}`], instructions: compiledL0 };
    } catch (err) {
      return {
        error: `L0 compile failed for ${this.agentId as string}: ${(err as Error).message}`,
        metadata: { provider: 'openai', model: cliModel },
      };
    }
  }

  async *invoke(prompt: string, options?: AgentServiceOptions): AsyncIterable<AgentMessage> {
    // Codex CLI has no system prompt flag; prepend identity to prompt text
    const effectivePrompt = options?.systemPrompt ? `${options.systemPrompt}\n\n${prompt}` : prompt;
    const effectiveModel = options?.callbackEnv?.AGENT_STUDIO_OPENAI_MODEL_OVERRIDE ?? this.model;
    const imagePaths = extractImagePaths(options?.contentBlocks, options?.uploadDir);
    const imageArgs = imagePaths.flatMap((path) => ['--image', path]);

    const sandboxMode = getCodexSandboxMode();
    const approvalPolicy = getCodexApprovalPolicy();
    const effortLevel = getAgentEffort(this.agentId as string, undefined, 'openai');
    const reasoningArgs = ['--config', `model_reasoning_effort="${effortLevel}"`];
    const approvalArgs = ['--config', `approval_policy="${approvalPolicy}"`];
    const ctxConfig = resolveCodexContextWindowConfig(this.agentId as string, effectiveModel);
    const contextWindowArgs: string[] = ctxConfig
      ? [
          '--config',
          `model_context_window=${ctxConfig.contextWindow}`,
          '--config',
          `model_auto_compact_token_limit=${ctxConfig.autoCompactTokenLimit}`,
        ]
      : [];
    const agentStudioMcpArgs = buildAgentStudioMcpConfigArgs(options?.workingDirectory, options?.callbackEnv);
    const gitRepoArgs = buildGitRepoArgs(options?.workingDirectory);
    // User-defined CLI args from the member editor (#567) — passed as-is, no implicit wrapping.
    // Each entry is split by whitespace (e.g. "--config model_reasoning_effort=\"low\"").
    // F203 Phase C / 砚砚 P1: strip reserved system config keys (developer_instructions,
    // carries L0) before dedup — otherwise dedup() would skip the system push and the
    // L0 would be silently overridden by any cliConfigArgs entry with the same key.
    const userConfigArgs = stripReservedSystemConfigs(
      (options?.cliConfigArgs ?? []).flatMap((arg) => arg.trim().split(/\s+/)),
      this.agentId as string,
    );
    // Collect user --config / -c keys so system-injected duplicates can be
    // skipped. `-c` is the documented short alias of `--config` per
    // `codex exec --help`; both forms must be recognized here (云端 Codex
    // P1-cloud-2, 2026-05-16).
    const userConfigKeys = new Set<string>();
    const userFlagSet = new Set<string>();
    for (let i = 0; i < userConfigArgs.length; i++) {
      const a = userConfigArgs[i];
      if ((a === '--config' || a === '-c') && i + 1 < userConfigArgs.length) {
        const key = userConfigArgs[i + 1].split('=')[0];
        if (key) userConfigKeys.add(key);
      } else if (a.startsWith('-')) {
        userFlagSet.add(a);
      }
    }

    // Codex CLI deprecated OPENAI_BASE_URL env var.
    // Configure a custom model provider via --config model_providers.*
    // Source: https://github.com/openai/codex codex-rs/core/src/model_provider_info.rs
    //   - env_key: env var name for the API key
    //   - base_url: API endpoint
    //   - wire_api: "responses" (HTTP, the only supported value)
    // Check both callbackEnv and accountEnv — after F171 env separation,
    // user-configured OPENAI_BASE_URL lives in accountEnv, not callbackEnv.
    const customBaseUrl =
      options?.callbackEnv?.OPENAI_BASE_URL ??
      options?.callbackEnv?.OPENAI_API_BASE ??
      options?.accountEnv?.OPENAI_BASE_URL ??
      options?.accountEnv?.OPENAI_API_BASE;
    const customProviderArgs: string[] = customBaseUrl
      ? [
          '--config',
          'model_provider="custom"',
          '--config',
          `model_providers.custom.base_url=${toTomlString(customBaseUrl)}`,
          '--config',
          'model_providers.custom.name="Custom API Key"',
          '--config',
          'model_providers.custom.wire_api="responses"',
          '--config',
          'model_providers.custom.env_key="OPENAI_API_KEY"',
        ]
      : [];
    let customModelCatalogTempDir: string | undefined;
    let customModelCatalogArgs: string[] = [];
    if (customBaseUrl && ctxConfig && shouldInjectCustomModelCatalog(effectiveModel)) {
      const catalog = writeCustomCodexModelCatalogFile(effectiveModel, ctxConfig.contextWindow);
      customModelCatalogArgs = catalog.args;
      customModelCatalogTempDir = catalog.tempDir;
    }

    // Codex CLI sends the model name verbatim to the API (model_info.slug).
    // model_provider="custom" only controls which provider entry (base_url, env_key) to use.
    // The model name is user-configured (no system-added prefix to strip).
    // Use --config model=... instead of --model to bypass the CLI's built-in metadata lookup
    // for custom providers (non-builtin models trigger a cosmetic warning via --model).
    const cliModel = effectiveModel;
    const modelArgs: string[] = !cliModel
      ? []
      : customBaseUrl
        ? ['--config', `model=${toTomlString(cliModel)}`]
        : ['--model', cliModel];

    // F203 Phase C: compile per-agent L0 → OpenAI `developer` role args.
    // fail-closed (generator contract, mirrors the CLI-not-found path below).
    const l0Result = await this.compileDeveloperInstructionsArgs(cliModel);
    if ('error' in l0Result) {
      yield {
        type: 'error' as const,
        agentId: this.agentId,
        error: l0Result.error,
        metadata: l0Result.metadata,
        timestamp: Date.now(),
      };
      yield { type: 'done' as const, agentId: this.agentId, metadata: l0Result.metadata, timestamp: Date.now() };
      return;
    }
    const developerInstructionsArgs = l0Result.args;
    const developerInstructions = l0Result.instructions;

    // resume 子命令不接受 --sandbox（sandbox 在创建时已锁定）
    // --add-dir .git: 允许写入 .git/ 目录（index.lock、objects、refs），解锁 git commit
    // 注意：旧 session resume 时沿用创建时的沙箱参数，不会带 --add-dir。
    // 这是预期行为——新建会话即可获得 .git 写入权限。
    // Incident 2026-05-29 (cross-thread-context-contamination): prompt 正文经 stdin
    // 传入（见下方 cliOpts.stdinInput），绝不进 argv —— 否则 `ps -o command=` /
    // /proc/<pid>/cmdline 会把完整对话历史（含跨 thread/智能体/用户内容）暴露给任何
    // 并发进程。'--' 结束选项解析，'-' 让 codex 从 stdin 读取 PROMPT。
    const promptArgs = ['--', '-'];

    // Dedup: skip system --config/--flag pairs that the user explicitly overrides (#567).
    const dedup = (src: string[]): string[] => {
      const out: string[] = [];
      for (let i = 0; i < src.length; i++) {
        if (src[i] === '--config' && i + 1 < src.length) {
          const key = src[i + 1].split('=')[0];
          if (userConfigKeys.has(key)) {
            i++;
            continue;
          }
        } else if (src[i].startsWith('-') && userFlagSet.has(src[i])) {
          if (i + 1 < src.length && !src[i + 1].startsWith('-')) i++;
          continue;
        }
        out.push(src[i]);
      }
      return out;
    };

    const args: string[] = options?.sessionId
      ? [
          'exec',
          'resume',
          options.sessionId,
          '--json',
          ...dedup(modelArgs),
          ...dedup(reasoningArgs),
          ...dedup(contextWindowArgs),
          ...dedup(customModelCatalogArgs),
          ...dedup(approvalArgs),
          ...dedup(developerInstructionsArgs),
          ...dedup(customProviderArgs),
          ...userConfigArgs,
          ...gitRepoArgs,
          ...agentStudioMcpArgs,
          ...imageArgs,
          ...promptArgs,
        ]
      : [
          'exec',
          '--json',
          ...dedup(modelArgs),
          ...dedup(reasoningArgs),
          ...dedup(contextWindowArgs),
          ...dedup(customModelCatalogArgs),
          '--sandbox',
          sandboxMode,
          '--add-dir',
          '.git',
          ...dedup(approvalArgs),
          ...dedup(developerInstructionsArgs),
          ...dedup(customProviderArgs),
          ...userConfigArgs,
          ...gitRepoArgs,
          ...agentStudioMcpArgs,
          ...imageArgs,
          ...promptArgs,
        ];

    const metadata: MessageMetadata = { provider: 'openai', model: cliModel };
    const auditContext = options?.auditContext;
    const recentStreamErrors: string[] = [];

    try {
      // HOME isolation: only for API Key mode.
      // OAuth mode needs real HOME (~/.codex/auth.json for token refresh).
      // API Key mode must AVOID real HOME — stale OAuth token refresh will fail
      // and abort the CLI before it reaches the custom provider config.
      const authMode = getCodexAuthMode(options?.callbackEnv);
      const rawEnv = { ...(options?.callbackEnv ?? {}) };
      // Strip deprecated OPENAI_BASE_URL — now handled via --config model_providers
      if (customBaseUrl) {
        delete rawEnv.OPENAI_BASE_URL;
        delete rawEnv.OPENAI_API_BASE;
      }
      // For API Key mode: use temp HOME to prevent OAuth token refresh interference.
      // On Windows, Rust/codex uses USERPROFILE (not HOME) for config directory.
      if (authMode === 'api_key' && customBaseUrl) {
        const { mkdtempSync } = await import('node:fs');
        const { tmpdir } = await import('node:os');
        const isolatedHome = mkdtempSync(`${tmpdir()}/codex-apikey-`);
        rawEnv.HOME = isolatedHome;
        if (process.platform === 'win32') {
          rawEnv.USERPROFILE = isolatedHome;
        }
      }
      const homeIsolated = authMode === 'api_key' && !!customBaseUrl;
      const codexEnv = sanitizeCodexChildEnv(applyAuthMode(rawEnv, authMode));

      // Diagnostic logging: critical env state for debugging CLI startup failures
      log.info(
        {
          agentId: this.agentId,
          authMode,
          homeIsolated,
          isolatedHome: homeIsolated ? rawEnv.HOME : undefined,
          customBaseUrl: customBaseUrl ? redactUrlForLog(customBaseUrl) : null,
          sandboxMode,
          hasOpenaiKey: !!codexEnv.OPENAI_API_KEY,
          hasOpenaiKeyAfterAuth: codexEnv.OPENAI_API_KEY !== null && codexEnv.OPENAI_API_KEY !== undefined,
          envKeysCallbackEnv: Object.keys(options?.callbackEnv ?? {}),
          envKeysAccountEnv: Object.keys(options?.accountEnv ?? {}),
          cwd: options?.workingDirectory ?? null,
          platform: process.platform,
        },
        '[codex-diag] Auth + env setup',
      );

      // F171: Account env vars applied LAST — user overrides provider-injected values.
      // Strip OPENAI_BASE_URL/OPENAI_API_BASE if already consumed via --config model_providers
      // to prevent the deprecated env var from conflicting with the CLI config.
      if (options?.accountEnv) {
        for (const [k, v] of Object.entries(options.accountEnv)) {
          if (k === 'LOCAL_API_KEY') continue;
          if (customBaseUrl && (k === 'OPENAI_BASE_URL' || k === 'OPENAI_API_BASE')) continue;
          codexEnv[k] = v;
        }
      }
      const directFallbackApiKey = typeof codexEnv.OPENAI_API_KEY === 'string' ? codexEnv.OPENAI_API_KEY : undefined;
      const apiKeyTransport = getCodexApiKeyTransport(options?.callbackEnv, options?.accountEnv);

      if (
        apiKeyTransport === 'responses' &&
        authMode === 'api_key' &&
        customBaseUrl &&
        directFallbackApiKey &&
        imagePaths.length === 0 &&
        !options?.workingDirectory
      ) {
        try {
          const directMetadata: MessageMetadata = {
            ...metadata,
            diagnostics: {
              ...(metadata.diagnostics ?? {}),
              directResponsesTransport: true,
              transportReason: 'configured_api_key_custom_provider',
            },
          };

          log.info(
            {
              agentId: this.agentId,
              invocationId: options?.invocationId ?? null,
              customBaseUrl: redactUrlForLog(customBaseUrl),
              model: cliModel,
            },
            '[codex-diag] Using direct Responses transport for custom API-key provider',
          );

          for await (const direct of this.invokeDirectResponsesFallback({
            baseUrl: customBaseUrl,
            apiKey: directFallbackApiKey,
            model: cliModel,
            prompt: effectivePrompt,
            developerInstructions,
            ...(options?.signal ? { signal: options.signal } : {}),
          })) {
            if (direct.usage) {
              metadata.usage = direct.usage;
              directMetadata.usage = direct.usage;
            }
            if (direct.text) {
              yield {
                type: 'text',
                agentId: this.agentId,
                content: direct.text,
                textMode: 'append',
                metadata: directMetadata,
                timestamp: Date.now(),
              };
            }
          }

          yield { type: 'done', agentId: this.agentId, metadata: directMetadata, timestamp: Date.now() };
          return;
        } catch (directErr) {
          log.warn(
            {
              agentId: this.agentId,
              invocationId: options?.invocationId ?? null,
              err: directErr instanceof Error ? directErr.message : String(directErr),
            },
            '[codex-diag] Direct Responses transport failed; falling back to Codex CLI',
          );
        }
      }

      const semanticCompletionController = new AbortController();

      const codexCommand =
        this.spawnFn || options?.spawnCliOverride ? this.cliCommand : resolveCliCommand(this.cliCommand);
      if (!codexCommand) {
        yield {
          type: 'error' as const,
          agentId: this.agentId,
          error: formatCliNotFoundError(this.cliCommand),
          metadata,
          timestamp: Date.now(),
        };
        yield { type: 'done' as const, agentId: this.agentId, metadata, timestamp: Date.now() };
        return;
      }

      // Diagnostic: log full invocation params at info level for troubleshooting
      log.info(
        {
          agentId: this.agentId,
          command: codexCommand,
          model: cliModel,
          originalModel: effectiveModel,
          customBaseUrl: customBaseUrl ? redactUrlForLog(customBaseUrl) : null,
          sessionId: options?.sessionId ?? null,
          invocationId: options?.invocationId ?? null,
          cwd: options?.workingDirectory ?? null,
          authMode,
          argCount: args.length,
          // Log flag names + --config keys (no values) for debugging
          cliFlags: args.filter((a) => a.startsWith('-')),
          cliConfigKeys: args.map((a, i) => (args[i - 1] === '--config' ? a.split('=')[0] : null)).filter(Boolean),
        },
        '[codex-diag] Invoking Codex CLI',
      );

      const cliOpts = {
        command: codexCommand,
        args,
        // Incident 2026-05-29 (cross-thread-context-contamination): prompt 正文经 stdin
        // 传入，不进 argv —— 防 `ps -o command=` / /proc/<pid>/cmdline 跨进程泄露。
        stdinInput: effectivePrompt,
        ...(options?.workingDirectory ? { cwd: options.workingDirectory } : {}),
        env: codexEnv,
        ...(options?.signal ? { signal: options.signal } : {}),
        ...(options?.invocationId ? { invocationId: options.invocationId } : {}),
        ...(options?.cliSessionId ? { cliSessionId: options.cliSessionId } : {}),
        ...(options?.invocationId && this.rawArchive.getPath
          ? { rawArchivePath: this.rawArchive.getPath(options.invocationId) }
          : {}),
        ...(options?.livenessProbe ? { livenessProbe: options.livenessProbe } : {}),
        ...(options?.parentSpan ? { parentSpan: options.parentSpan } : {}),
        semanticCompletionSignal: semanticCompletionController.signal,
      };
      const events = options?.spawnCliOverride
        ? options.spawnCliOverride(cliOpts)
        : spawnCli(cliOpts, this.spawnFn ? { spawnFn: this.spawnFn } : undefined);

      // Track substantive output (item.completed with text/tool results).
      // Used to suppress Codex CLI 0.98+ false exit-code-1 errors:
      // thread.started alone is NOT substantive (just session init).
      let sawSubstantiveOutput = false;
      const codexStreamState: CodexStreamState = { hadPriorTextTurn: false };

      for await (const event of events) {
        collectCodexStreamError(event, recentStreamErrors);

        if (auditContext) {
          this.rawArchive.append(auditContext.invocationId, sanitizeRawEvent(event)).catch((err) => {
            log.warn(
              {
                threadId: auditContext.threadId,
                invocationId: auditContext.invocationId,
                err,
              },
              '[audit] Codex raw event archive write failed',
            );
          });
        }

        if (isCliTimeout(event)) {
          // F118 AC-C3: Forward timeout diagnostics as system_info before error
          yield {
            type: 'system_info' as const,
            agentId: this.agentId,
            content: JSON.stringify({
              type: 'timeout_diagnostics',
              silenceDurationMs: event.silenceDurationMs,
              processAlive: event.processAlive,
              lastEventType: event.lastEventType,
              firstEventAt: event.firstEventAt,
              lastEventAt: event.lastEventAt,
              cliSessionId: event.cliSessionId,
              invocationId: event.invocationId,
              rawArchivePath: event.rawArchivePath,
            }),
            timestamp: Date.now(),
          };
          yield {
            type: 'error',
            agentId: this.agentId,
            error: `Owen（验证与审查） CLI 响应超时 (${Math.round(event.timeoutMs / 1000)}s${event.firstEventAt == null ? ', 未收到首帧' : ''})`,
            // F212 Phase A (云端 codex P2): timeout cliDiagnostics 也透传到 metadata.
            metadata: event.cliDiagnostics ? { ...metadata, cliDiagnostics: event.cliDiagnostics } : metadata,
            timestamp: Date.now(),
          };
          continue;
        }
        // F118 Phase C: Forward liveness warnings to frontend with agentId
        if (isLivenessWarning(event)) {
          const warningEvent = event as { level?: string; silenceDurationMs?: number };
          log.warn(
            {
              agentId: this.agentId,
              invocationId: options?.invocationId,
              level: warningEvent.level,
              silenceMs: warningEvent.silenceDurationMs,
            },
            '[CodexAgent] liveness warning — CLI may be stuck',
          );
          yield {
            type: 'system_info' as const,
            agentId: this.agentId,
            content: JSON.stringify({ type: 'liveness_warning', ...event }),
            timestamp: Date.now(),
          };
          continue;
        }
        if (isCliError(event)) {
          // Codex CLI 0.98+ returns exit code 1 after successful completion.
          // Suppress the error ONLY if we saw substantive output (item.completed).
          // thread.started alone is NOT enough — that just means session init.
          if (
            event.exitCode === 1 &&
            event.signal === null &&
            sawSubstantiveOutput &&
            !hasNonSuppressibleCodexExitOneDiagnostics(event, recentStreamErrors)
          ) {
            log.warn(
              {},
              `[codex] Codex CLI exited with code 1 after substantive output (suppressing as Codex 0.98+ quirk)`,
            );
            continue;
          }
          if (
            !sawSubstantiveOutput &&
            customBaseUrl &&
            directFallbackApiKey &&
            shouldUseDirectResponsesFallback(event, recentStreamErrors)
          ) {
            try {
              const fallbackMetadata: MessageMetadata = {
                ...metadata,
                diagnostics: {
                  ...(metadata.diagnostics ?? {}),
                  directResponsesFallback: true,
                  fallbackReason: 'codex_cli_responses_stream_disconnect',
                },
              };

              for await (const fallback of this.invokeDirectResponsesFallback({
                baseUrl: customBaseUrl,
                apiKey: directFallbackApiKey,
                model: cliModel,
                prompt: effectivePrompt,
                developerInstructions,
                ...(options?.signal ? { signal: options.signal } : {}),
              })) {
                if (fallback.usage) {
                  metadata.usage = fallback.usage;
                  fallbackMetadata.usage = fallback.usage;
                }
                if (fallback.text) {
                  yield {
                    type: 'text',
                    agentId: this.agentId,
                    content: fallback.text,
                    textMode: 'append',
                    metadata: fallbackMetadata,
                    timestamp: Date.now(),
                  };
                }
              }
              log.warn(
                {
                  agentId: this.agentId,
                  invocationId: options?.invocationId,
                  customBaseUrl: redactUrlForLog(customBaseUrl),
                  model: cliModel,
                },
                '[codex-diag] Codex CLI stream failed; returned direct Responses fallback',
              );
              continue;
            } catch (fallbackErr) {
              log.warn(
                {
                  agentId: this.agentId,
                  invocationId: options?.invocationId,
                  err: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
                },
                '[codex-diag] Direct Responses fallback failed',
              );
            }
          }
          // Diagnostic: log full error details at info level for troubleshooting
          log.info(
            {
              agentId: this.agentId,
              exitCode: event.exitCode,
              signal: event.signal,
              message: event.message,
              reasonCode: event.reasonCode,
              publicSummary: event.cliDiagnostics?.publicSummary,
              safeExcerpt: event.cliDiagnostics?.safeExcerpt,
              debugRef: event.cliDiagnostics?.debugRef,
              sawSubstantiveOutput,
              recentStreamErrors,
            },
            '[codex-diag] CLI error exit — full diagnostics',
          );
          const base = formatCliExitError('Codex CLI', event);
          // F212 Phase A: forward cliDiagnostics on metadata for frontend folded panel (Phase B).
          yield {
            type: 'error',
            agentId: this.agentId,
            error: withRecentDiagnostics(base, recentStreamErrors),
            metadata: event.cliDiagnostics ? { ...metadata, cliDiagnostics: event.cliDiagnostics } : metadata,
            timestamp: Date.now(),
          };
          continue;
        }

        // Track substantive events: item.completed produces text/tool_result/tool_use
        if (typeof event === 'object' && event !== null) {
          const e = event as Record<string, unknown>;
          if (e.type === 'item.completed') {
            sawSubstantiveOutput = true;
          }
        }

        if (auditContext) {
          const lifecycle = extractCommandExecutionLifecycle(event);
          if (lifecycle) {
            const type =
              lifecycle.phase === 'started' ? AuditEventTypes.CLI_TOOL_STARTED : AuditEventTypes.CLI_TOOL_COMPLETED;

            this.auditLog
              .append({
                type,
                threadId: auditContext.threadId,
                data: {
                  invocationId: auditContext.invocationId,
                  userId: auditContext.userId,
                  agentId: auditContext.agentId,
                  tool: 'command_execution',
                  command: lifecycle.command,
                  ...(lifecycle.status ? { status: lifecycle.status } : {}),
                  ...(lifecycle.exitCode !== undefined ? { exitCode: lifecycle.exitCode } : {}),
                },
              })
              .catch((err) => {
                log.warn(
                  {
                    threadId: auditContext.threadId,
                    invocationId: auditContext.invocationId,
                    err,
                  },
                  '[audit] Codex CLI tool lifecycle write failed',
                );
              });
          }
        }

        if (
          !sawSubstantiveOutput &&
          customBaseUrl &&
          directFallbackApiKey &&
          isCodexResponsesStreamReconnectProgress(event)
        ) {
          continue;
        }

        // F8: Capture usage from turn.completed events (not passed through transform)
        if (typeof event === 'object' && event !== null) {
          const raw = event as Record<string, unknown>;
          if (raw.type === 'turn.completed') {
            semanticCompletionController.abort();
            const u = raw.usage as Record<string, unknown> | undefined;
            if (u) {
              const usage: TokenUsage = {};
              if (typeof u.input_tokens === 'number') usage.inputTokens = u.input_tokens;
              if (typeof u.output_tokens === 'number') usage.outputTokens = u.output_tokens;
              if (typeof u.cached_input_tokens === 'number') usage.cacheReadTokens = u.cached_input_tokens;
              // F24-fallback: turn.completed is always available from codex exec --json.
              // Note: Codex session token_count is a more accurate source for context fill;
              // this value may be overwritten by contextSnapshotResolver when available.
              if (typeof u.input_tokens === 'number') usage.lastTurnInputTokens = u.input_tokens;
              metadata.usage = usage;
            }
          }
        }

        const result = transformCodexEvent(event, this.agentId, codexStreamState);
        if (result !== null) {
          if (Array.isArray(result)) {
            for (const msg of result) {
              if (msg.type === 'session_init' && msg.sessionId) {
                metadata.sessionId = msg.sessionId;
              }
              yield { ...msg, metadata };
            }
          } else {
            if (result.type === 'session_init' && result.sessionId) {
              metadata.sessionId = result.sessionId;
            }
            yield { ...result, metadata };
          }
        }
      }

      // Estimate cost from pricing table when CLI doesn't provide costUsd.
      // MUST run BEFORE contextSnapshotResolver — the resolver overwrites
      // metadata.usage.inputTokens/outputTokens with context-fill values for
      // display, but cost estimation needs the original turn.completed totals
      // which reflect cumulative billing (cloud P2 fix).
      // Use metadata.model (= effectiveModel = actual model that ran) rather than
      // getAgentModel() which misses per-invocation overrides (review P1-2).
      if (metadata.usage && metadata.usage.costUsd == null && metadata.model) {
        const inputTokens = metadata.usage.inputTokens ?? metadata.usage.lastTurnInputTokens ?? 0;
        const outputTokens = metadata.usage.outputTokens ?? 0;
        if (inputTokens > 0 || outputTokens > 0) {
          const estimated = estimateCostFromTokens(
            metadata.model,
            inputTokens,
            outputTokens,
            metadata.usage.cacheReadTokens,
          );
          if (estimated != null) {
            metadata.usage.costUsd = estimated;
            metadata.usage.costEstimated = true;
          }
        }
      }

      if (metadata.sessionId) {
        try {
          const snapshot = await this.contextSnapshotResolver(metadata.sessionId);
          if (snapshot) {
            const usage: TokenUsage = metadata.usage ? { ...metadata.usage } : {};
            usage.contextUsedTokens = snapshot.contextUsedTokens;
            usage.contextWindowSize = snapshot.contextWindowTokens;
            usage.lastTurnInputTokens = snapshot.contextUsedTokens;
            // Codex turn.completed usage can be CLI-session cumulative. When
            // token_count is available, prefer last_token_usage for this turn.
            // For Codex, each Agent Studio invocation is one CLI turn, so
            // last_token_usage is the invocation input, not a session total.
            usage.inputTokens = snapshot.contextUsedTokens;

            if (snapshot.contextResetsAtMs != null) {
              usage.contextResetsAtMs = snapshot.contextResetsAtMs;
            }
            if (snapshot.lastCachedInputTokens != null) {
              usage.cacheReadTokens = snapshot.lastCachedInputTokens;
            } else {
              delete usage.cacheReadTokens;
            }
            if (snapshot.lastOutputTokens != null) {
              usage.outputTokens = snapshot.lastOutputTokens;
            } else {
              delete usage.outputTokens;
            }

            metadata.usage = usage;
          }
        } catch (err) {
          log.warn(
            {
              sessionId: metadata.sessionId,
              err,
            },
            '[codex] failed to resolve session context snapshot',
          );
        }
      }

      // F172 Phase B: Scan for generated images and publish to /uploads/
      if (metadata.sessionId) {
        try {
          const published = await scanAndPublishCodexImages({
            codexSessionId: metadata.sessionId,
            uploadDir: options?.uploadDir,
            codexHome: rawEnv.HOME ? join(rawEnv.HOME, '.codex') : undefined,
          });
          for (const img of published) {
            yield {
              type: 'system_info' as const,
              agentId: this.agentId,
              content: JSON.stringify({ type: 'rich_block', block: img.richBlock, provenance: img.provenance }),
              metadata,
              timestamp: Date.now(),
            };
          }
        } catch (err) {
          log.warn({ sessionId: metadata.sessionId, err }, '[F172] codex image scan failed');
        }
      }

      yield { type: 'done', agentId: this.agentId, metadata, timestamp: Date.now() };
    } catch (err) {
      yield {
        type: 'error',
        agentId: this.agentId,
        error: err instanceof Error ? err.message : String(err),
        metadata,
        timestamp: Date.now(),
      };
      // Guarantee done after error so invoke-single-agent can set isFinal correctly
      yield { type: 'done', agentId: this.agentId, metadata, timestamp: Date.now() };
    } finally {
      if (customModelCatalogTempDir) {
        try {
          rmSync(customModelCatalogTempDir, { recursive: true, force: true });
        } catch (err) {
          log.warn(
            {
              agentId: this.agentId,
              dir: customModelCatalogTempDir,
              err: err instanceof Error ? err.message : String(err),
            },
            '[codex-diag] Failed to clean temporary model catalog directory',
          );
        }
      }
    }
  }
}
