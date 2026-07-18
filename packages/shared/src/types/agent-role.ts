/**
 * Agent Role & Variant Types
 * Role+Variant 两层 schema：Role 是 Agent 能力通道（Ethan/Owen/Andy/Nora），
 * Variant 是同一能力通道下的不同模型/配置。
 *
 * Phase 3.5: 每 Role 有 1 个 default Variant
 * Phase 4-F: 支持多 Variant（多版本智能体召唤）
 */

import type { AgentColor, AgyProfileConfig, ClientId } from './agent.js';
import type { AgentId } from './ids.js';
import type { VoiceConfig } from './tts.js';

/**
 * Per-agent context budget configuration.
 * Controls how much history/context is sent to each agent.
 */
export interface ContextBudget {
  /** Total prompt token limit (including system prompt + context + user message) */
  readonly maxPromptTokens: number;
  /** Maximum tokens for historical context */
  readonly maxContextTokens: number;
  /** Maximum number of historical messages to include */
  readonly maxMessages: number;
  /** Maximum characters per single message (truncation point) */
  readonly maxContentLengthPerMsg: number;
}

/**
 * CLI invocation config for a variant
 */
import type { CliEffortValue } from '../cli-effort.js';

export interface CliConfig {
  readonly command: string; // 'claude' | 'codex' | 'gemini'
  readonly outputFormat: string; // 'stream-json' | 'json'
  readonly defaultArgs?: readonly string[];
  /**
   * Reasoning effort level — each CLI maps to its own flag:
   *   claude: --effort low|medium|high|max
   *   codex:  --config model_reasoning_effort="low|medium|high|xhigh"
   * Default: 'max' (claude) / 'xhigh' (codex)
   */
  readonly effort?: CliEffortValue;
  readonly contextWindow?: number;
  readonly autoCompactTokenLimit?: number;
}

/**
 * A specific model/config variant within a role.
 * e.g. lead-architect role → opus-4.6 variant, opus-4.5 variant
 *
 * F32-b: Variants can override agentId, displayName, and mentionPatterns
 * to register as independent agents within the same role.
 */
export interface AgentVariant {
  readonly id: string; // 'opus-4.6', 'codex-default'
  /** Override role-level agentId to register as an independent agent (F32-b) */
  readonly agentId?: string;
  /** Override role-level displayName (F32-b) */
  readonly displayName?: string;
  /** F32-b P4: Human-readable label for disambiguation (e.g. "4.5", "Sonnet") */
  readonly variantLabel?: string;
  /** Independent mention patterns for this variant (F32-b).
   *  Default variant inherits role mentionPatterns; non-default variants fallback to @agentId when unspecified. */
  readonly mentionPatterns?: readonly string[];
  /** F127: member-side binding to a concrete account config (built-in or API key). */
  readonly accountRef?: string;
  /** baiyuxi-agent-studio#340 P5: CLI client identity (renamed from `provider`). */
  readonly clientId: ClientId;
  readonly defaultModel: string;
  readonly mcpSupport: boolean;
  readonly cli: CliConfig;
  /** F210 Phase G: optional isolated Antigravity CLI profile binding. */
  readonly agyProfile?: AgyProfileConfig;
  /** F127: explicit CLI args for bridge-style members such as Antigravity. */
  readonly commandArgs?: readonly string[];
  /** Optional per-variant override for roleDescription; falls back to role.roleDescription. */
  readonly roleDescription?: string;
  readonly personality?: string;
  readonly strengths?: readonly string[];
  /** F32-b P4c: Override role-level avatar for this variant */
  readonly avatar?: string;
  /** F32-b P4c: Override role-level color for this variant */
  readonly color?: AgentColor;
  /** Per-agent context budget (optional, falls back to defaults) */
  readonly contextBudget?: ContextBudget;
  /** Optional per-variant override for sessionChain; falls back to role.features.sessionChain. */
  readonly sessionChain?: boolean;
  /** F34: Per-agent TTS voice (optional, falls back to defaults in agent-voices.ts) */
  readonly voiceConfig?: VoiceConfig;
  /** F-Ground-3: Human-readable strengths for teammate roster (overrides role-level) */
  readonly teamStrengths?: string;
  /** F-Ground-3: Caution note. null = explicitly no caution (overrides role). */
  readonly caution?: string | null;
  /** F167 Phase E (KD-20): hard task restrictions — natural-language bans
   *  (e.g. `["禁止写代码"]`). Surfaced to teammates via buildTeammateRoster
   *  and to the agent itself via buildStaticIdentity. Data-driven replacement
   *  for the retired L3 role-gate hardcoded regex. */
  readonly restrictions?: readonly string[];
  /** F127: Extra CLI --config key=value pairs passed to the client at invocation time.
   *  Each entry is a raw config string, e.g. 'model_reasoning_effort="low"'. */
  readonly cliConfigArgs?: readonly string[];
  /** baiyuxi-agent-studio#340 P5: Model provider name for api_key routing (renamed from `ocProviderName`).
   *  e.g. "openrouter", "maas", "deepseek".
   *  Used with api_key auth — runtime assembles `provider/defaultModel` for the -m flag
   *  and generates an OPENCODE_CONFIG runtime config file for the provider. */
  readonly provider?: string;
}

/**
 * Per-agent feature flags.
 * Controls which subsystems are enabled for each agent.
 */
export interface AgentFeatures {
  /** F24: Enable session chain (context health tracking, auto-seal, bootstrap).
   *  Default: true. Set false for agents with inaccurate token stats (e.g. Gemini). */
  readonly sessionChain?: boolean;
  /** F33 Phase 2: Per-role session strategy override from the resolved runtime agent config.
   *  Partial config — merged with provider/global defaults at runtime.
   *  Matches SessionStrategyConfig shape (all fields except strategy are optional). */
  readonly sessionStrategy?: {
    readonly strategy: 'handoff' | 'compress' | 'hybrid';
    readonly thresholds?: { readonly warn: number; readonly action: number };
    readonly handoff?: { readonly preSealMemoryDump: boolean; readonly bootstrapDepth: 'extractive' | 'generative' };
    readonly hybrid?: { readonly maxCompressions: number };
    readonly compress?: { readonly maxCompressions?: number; readonly trackPostCompression: boolean };
    readonly turnBudget?: number;
    readonly safetyMargin?: number;
  };
  /** F049: Mission Hub self-claim permission ratchet scope. */
  readonly missionHub?: {
    /**
     * disabled: 仅允许「建议 + 批准」
     * once/thread/global: 允许直通 self-claim（细粒度行为由路由层定义）
     */
    readonly selfClaimScope?: MissionHubSelfClaimScope;
  };
}

export type MissionHubSelfClaimScope = 'disabled' | 'once' | 'thread' | 'global';

/**
 * A agent role — the identity layer (name, avatar, color, role).
 * Each role has one or more variants (model configs).
 */
export interface AgentRole {
  readonly id: string; // 'lead-architect', 'code-reviewer', 'frontend-designer'
  readonly agentId: AgentId;
  readonly name: string; // 'Ethan（任务主控与实现）'
  readonly displayName: string;
  /** Nickname given by co-creator. See docs/stories/agent-names/ */
  readonly nickname?: string;
  readonly avatar: string;
  readonly color: AgentColor;
  readonly mentionPatterns: readonly string[];
  readonly roleDescription: string;
  readonly defaultVariantId: string;
  readonly variants: readonly AgentVariant[];
  /** Per-agent feature flags (optional, all features enabled by default) */
  readonly features?: AgentFeatures;
  /** F-Ground-3: Human-readable strengths for teammate roster (role default) */
  readonly teamStrengths?: string;
  /** F-Ground-3: Caution note. null = explicitly no caution (overrides role). */
  readonly caution?: string | null;
  /** F167 Phase E (KD-20): role-level hard restrictions; variants may override.
   *  Natural-language bans (e.g. `["禁止生成图片"]`). */
  readonly restrictions?: readonly string[];
}

// ── F032: Roster types for collaboration rules ─────────────────────────

/**
 * Roster entry for a single agent.
 * F032: Used for reviewer matching, availability tracking, and role checking.
 */
export interface RosterEntry {
  /** Family/species (lead-architect, code-reviewer, frontend-designer) */
  readonly family: string;
  /** Roles this agent can fulfill (architect, peer-reviewer, designer, etc.) */
  readonly roles: readonly string[];
  /** Whether this agent is the lead of its family */
  readonly lead: boolean;
  /** Whether this agent is available (has quota). co-creator 40 美刀教训！ */
  readonly available: boolean;
  /** co-creator's evaluation of this agent */
  readonly evaluation: string;
}

/** Map of agentId → RosterEntry */
export type Roster = Record<string, RosterEntry>;

/**
 * Review policy configuration.
 * F032: Determines how reviewers are matched to authors.
 */
export interface ReviewPolicy {
  /** Require reviewer to be from a different family than author */
  readonly requireDifferentFamily: boolean;
  /** Prefer agents that are active in the current thread */
  readonly preferActiveInThread: boolean;
  /** Prefer lead agents when multiple candidates exist */
  readonly preferLead: boolean;
  /** Exclude agents with available: false (no quota) */
  readonly excludeUnavailable: boolean;
}

// ── F136 Phase 4: Account config types ──────────────────────────────────

/** Protocol that the LLM endpoint speaks. */
export type AccountProtocol = 'anthropic' | 'openai' | 'openai-responses' | 'google' | 'kimi';

/**
 * Account configuration — lives in ~/.agent-studio/accounts.json (global).
 * Maps an accountRef to its LLM endpoint metadata (no secrets).
 */
export interface AccountConfig {
  readonly authType: 'oauth' | 'api_key';
  /** F171: Explicit client identity for API key accounts (e.g. 'anthropic', 'openai'). */
  readonly clientId?: string;
  readonly baseUrl?: string;
  readonly models?: readonly string[];
  readonly displayName?: string;
  /** F171: User-defined env vars injected into agent subprocess.
   *  Keys starting with AGENT_STUDIO_ are reserved and cannot be overridden. */
  readonly envVars?: Readonly<Record<string, string>>;
}

/**
 * Credential entry — lives in ~/.agent-studio/credentials.json (global keychain).
 * HC-1: Object structure supporting both api_key and oauth token with TTL + refresh.
 */
export interface CredentialEntry {
  readonly apiKey?: string;
  readonly accessToken?: string;
  readonly refreshToken?: string;
  /** Token expiry as epoch milliseconds. */
  readonly expiresAt?: number;
}

/**
 * Root config v1: roles only (legacy)
 */
export interface AgentStudioConfigV1 {
  readonly version: 1;
  readonly roles: readonly AgentRole[];
}

/**
 * F067: Co-Creator (co-creator) configuration — configurable identity for @ mention routing.
 */
export interface CoCreatorConfig {
  /** Primary display name (e.g. "You") */
  readonly name: string;
  /** Alternative names agents may use (e.g. ["L.S.", "Lysander"]) */
  readonly aliases: readonly string[];
  /** Line-start mention patterns for routing detection (e.g. ["@co-creator", "@co-creator"]) */
  readonly mentionPatterns: readonly string[];
  /** IANA timezone used when injecting co-creator-local timestamps into agent prompts. */
  readonly timeZone?: string;
  /** Optional co-creator avatar shown in Hub and chat surfaces. */
  readonly avatar?: string;
  /** Optional co-creator palette for Hub/chat surfaces. */
  readonly color?: AgentColor;
}

/**
 * Root config v2: roles + roster + reviewPolicy (F032)
 */
export interface AgentStudioConfigV2 {
  readonly version: 2;
  readonly roles: readonly AgentRole[];
  readonly roster: Roster;
  readonly reviewPolicy: ReviewPolicy;
  readonly coCreator?: CoCreatorConfig;
  /**
   * @deprecated baiyuxi-agent-studio#340: Accounts moved to global ~/.agent-studio/accounts.json.
   * This field is only read during one-time migration (catalog → global).
   * New code must use catalog-accounts.ts which reads the global file.
   */
  readonly accounts?: Readonly<Record<string, AccountConfig>>;
}

/**
 * Root config: versioned, contains all roles.
 * Union of all versions — loader handles migration.
 */
export type AgentStudioConfig = AgentStudioConfigV1 | AgentStudioConfigV2;
