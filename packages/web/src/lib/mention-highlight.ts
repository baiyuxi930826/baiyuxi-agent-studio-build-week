/**
 * F32-b Phase 3: Mention highlighting data — refreshable from API.
 *
 * Starts empty; useAgentData calls refreshMentionData() after /api/agents fetch
 * to populate regex with all agents from the runtime catalog.
 */

import { escapeRegExp } from '@agent-studio/shared';
import type { AgentData } from '@/hooks/useAgentData';
import { CO_CREATOR_MENTION_COLOR as CO_CREATOR_MENTION } from '@/lib/color-defaults';

// ── Internal builders ───────────────────────────────────

function buildMentionToAgent(agents: Array<{ id: string; mentionPatterns: string[] }>): Record<string, string> {
  return Object.fromEntries(
    agents.flatMap((agent) => agent.mentionPatterns.map((p) => [p.replace(/^@/, '').toLowerCase(), agent.id])),
  );
}

function buildMentionRe(toAgent: Record<string, string>): RegExp {
  const aliases = Object.keys(toAgent).sort((a, b) => b.length - a.length);
  if (aliases.length === 0) return /(?!)/g; // never-match fallback
  const pattern = aliases.map(escapeRegExp).join('|');
  // Boundary chars aligned with backend AgentRouter.parseMentions
  return new RegExp(`@(${pattern})(?=$|\\s|[,.:;!?()\\[\\]{}<>，。！？、：；（）【】《》「」『』〈〉])`, 'gi');
}

function buildMentionColor(agents: Array<{ id: string; color: { primary: string } }>): Record<string, string> {
  return Object.fromEntries(agents.map((agent) => [agent.id, agent.color.primary]));
}

// ── Owner mention highlighting ─────────────────────────────────
const CO_CREATOR_ID = '__co-creator__';
const CO_CREATOR_COLOR = CO_CREATOR_MENTION;
const DEFAULT_CO_CREATOR_MENTION_PATTERNS = ['@baiyuxi', '@owner'];

// ── Module-level cache (populated by refreshMentionData after /api/agents fetch) ─

// Include the owner as a pseudo-member so personal mentions highlight consistently.
let _agents: Array<{ id: string; mentionPatterns: string[]; color: { primary: string } }> = [];
let _coCreatorMentionPatterns = [...DEFAULT_CO_CREATOR_MENTION_PATTERNS];
let _mentionToAgent = buildMentionToAgent([]);
let _mentionRe = buildMentionRe(_mentionToAgent);
let _mentionColor = buildMentionColor([]);

function normalizeCoCreatorMentionPatterns(mentionPatterns: readonly string[]): string[] {
  const normalized = mentionPatterns
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0)
    .map((pattern) => (pattern.startsWith('@') ? pattern : `@${pattern}`));
  const unique = new Set(DEFAULT_CO_CREATOR_MENTION_PATTERNS);
  for (const pattern of normalized) unique.add(pattern);
  return [...unique];
}

function rebuildMentionCache(): void {
  const ownerEntry = {
    id: CO_CREATOR_ID,
    mentionPatterns: _coCreatorMentionPatterns,
    color: { primary: CO_CREATOR_COLOR },
  };
  const all = [..._agents, ownerEntry];
  _mentionToAgent = buildMentionToAgent(all);
  _mentionRe = buildMentionRe(_mentionToAgent);
  _mentionColor = buildMentionColor(all);
}

rebuildMentionCache();

// ── Public API ──────────────────────────────────────────

/** Called once by useAgentData after API fetch succeeds.
 *  Filters out disabled members (roster.available === false) so they don't highlight. */
export function refreshMentionData(agents: AgentData[]): void {
  _agents = agents.filter((agent) => agent.roster?.available !== false);
  rebuildMentionCache();
}

export function refreshCoCreatorMentionData(mentionPatterns: readonly string[]): void {
  _coCreatorMentionPatterns = normalizeCoCreatorMentionPatterns(mentionPatterns);
  rebuildMentionCache();
}

/** Get the current mention regex (refreshed after API load) */
export function getMentionRe(): RegExp {
  return _mentionRe;
}

/** Map mention alias (lowercase, no @) → agentId */
export function getMentionToAgent(): Record<string, string> {
  return _mentionToAgent;
}

/** Map agentId → primary color hex (e.g. "#9B7EBD") */
export function getMentionColor(): Record<string, string> {
  return _mentionColor;
}

export function resetMentionDataForTest(): void {
  _agents = [];
  _coCreatorMentionPatterns = [...DEFAULT_CO_CREATOR_MENTION_PATTERNS];
  rebuildMentionCache();
}
