/**
 * Agent Types and Configurations
 * 三只 AI 智能体的类型定义和配置
 */

import type { CliConfig, ContextBudget } from './agent-role.js';
import type { AgentId, SessionId } from './ids.js';
import { createAgentId } from './ids.js';
import type { VoiceConfig } from './tts.js';

/**
 * CLI client identity used to invoke a agent (e.g. 'anthropic' → claude CLI, 'openai' → codex CLI).
 * Renamed from AgentProvider in baiyuxi-agent-studio#340 P5.
 */
export type ClientId =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'kimi'
  | 'dare'
  | 'antigravity'
  | 'opencode'
  | 'a2a'
  | 'agentrunner';

/** @deprecated baiyuxi-agent-studio#340: Use {@link ClientId} instead. Kept as alias for backward compatibility. */
export type AgentProvider = ClientId;

/**
 * Agent status in the system
 */
export type AgentStatus = 'idle' | 'thinking' | 'working' | 'error' | 'offline';

/**
 * Agent color configuration
 */
export interface AgentColor {
  readonly primary: string;
  readonly secondary: string;
}

/**
 * F210 Phase G: Isolated Antigravity CLI profile binding.
 * The API runtime uses this to create a per-agent HOME sandbox before invoking `agy`.
 */
export interface AgyProfileConfig {
  readonly enabled?: boolean;
  readonly profileId?: string;
  readonly homeRoot?: string;
  readonly model?: string;
  readonly autoApprove?: boolean;
  readonly trustedWorkspaces?: readonly string[];
}

/**
 * Agent configuration (immutable)
 */
export interface AgentConfig {
  readonly id: AgentId;
  readonly name: string;
  readonly displayName: string;
  /** Nickname given by co-creator (e.g. 宪宪, 砚砚). See docs/stories/agent-names/ */
  readonly nickname?: string;
  readonly avatar: string;
  readonly color: AgentColor;
  readonly mentionPatterns: readonly string[];
  readonly accountRef?: string;
  /** baiyuxi-agent-studio#340 P5: CLI client identity (renamed from `provider`). */
  readonly clientId: ClientId;
  readonly defaultModel: string;
  readonly mcpSupport: boolean;
  readonly cli?: CliConfig;
  readonly agyProfile?: AgyProfileConfig;
  readonly commandArgs?: readonly string[];
  readonly contextBudget?: ContextBudget;
  readonly roleDescription: string;
  readonly personality: string;
  /** F32-b: Which role this agent belongs to (for frontend grouping) */
  readonly roleId?: string;
  /** F32-b P4: Human-readable variant label (e.g. "4.5", "Sonnet") */
  readonly variantLabel?: string;
  /** F32-b P4: Whether this is the default variant for its role */
  readonly isDefaultVariant?: boolean;
  /** F32-b P4: Role-level display name (for group headings in UI) */
  readonly roleDisplayName?: string;
  /** F-Ground-3: Human-readable strengths for teammate roster */
  readonly teamStrengths?: string;
  /** F-Ground-3: Caution note for teammate roster. null = explicitly no warning (overrides role). */
  readonly caution?: string | null;
  /** F167 Phase E (KD-20): hard task restrictions — natural-language bans
   *  (e.g. `["禁止写代码"]`). Surfaced to teammates via buildTeammateRoster
   *  and to the agent itself via buildStaticIdentity. Data-driven replacement
   *  for the retired L3 role-gate hardcoded regex. */
  readonly restrictions?: readonly string[];
  /** F127 Screen 3: editable strength tags */
  readonly strengths?: readonly string[];
  /** F127 Screen 3: whether session chain is enabled for this member */
  readonly sessionChain?: boolean;
  /** F103/F190: Per-agent TTS voice configuration, including optional refAudio. */
  readonly voiceConfig?: VoiceConfig;
  /** F127: Extra CLI --config key=value pairs passed to the client at invocation time. */
  readonly cliConfigArgs?: readonly string[];
  /** baiyuxi-agent-studio#340 P5: Model provider name for api_key routing (renamed from `ocProviderName`).
   *  e.g. "openrouter", "maas", "deepseek". Runtime assembles provider/model for the -m flag. */
  readonly provider?: string;
}

/**
 * Agent runtime state
 */
export interface AgentState {
  readonly id: AgentId;
  readonly status: AgentStatus;
  readonly currentTask?: string;
  readonly lastActiveAt: Date;
  readonly sessionId?: SessionId;
}
