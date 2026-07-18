/**
 * A2A Mention Detection
 * 从智能体回复文本中检测对其他智能体的 @mention。
 *
 * 规则 (F046 简化 — 行首即路由):
 * 1. 剥离围栏代码块 (```...```) 后再解析
 * 2. 仅匹配行首 mention（可带前导空白）→ 直接路由，无需动作词
 * 3. 长匹配优先 + token boundary，避免 `@opus-45` 误命中 `@opus`
 * 4. 过滤自调用
 * 5. F27: 返回所有匹配的智能体 (上限 MAX_A2A_MENTION_TARGETS)
 * 6. 只在智能体回复完整结束后解析 (由调用方保证)
 */

import type { AgentId, AgentRoutingError } from '@agent-studio/shared';
import { agentRegistry } from '@agent-studio/shared';
import { isAgentAvailable } from '../../../../../config/agent-config-loader.js';
import { resolveAgentTarget } from './agent-target-resolver.js';

/** Max A2A chain depth, configurable via env (read at call time for hot-reload) */
export function getMaxA2ADepth(): number {
  return Number(process.env.MAX_A2A_DEPTH) || 15;
}

/** Max number of distinct agents a single message can @mention (F27 safety limit) */
const MAX_A2A_MENTION_TARGETS = 2;
/** @internal Exported for a2a-shadow-detection.ts. */
export const TOKEN_BOUNDARY_RE = /[\s,.:;!?()[\]{}<>，。！？、：；（）【】《》「」『』〈〉]/;
/** @internal Exported for a2a-shadow-detection.ts. */
export const HANDLE_CONTINUATION_RE = /[a-z0-9_.-]/;
const LEADING_MARKDOWN_MENTION_PREFIX_RE = /^(?:(?:>\s*)|(?:[-*+]\s+)|(?:\d+[.)]\s+))+/;
const LINE_START_MARKDOWN_PREFIX_PATTERN = String.raw`\s*(?:(?:>\s*)|(?:[-*+]\s+)|(?:\d+[.)]\s+))*`;
const HANDLE_BOUNDARY_PATTERN = String.raw`(?=$|[\s,.:;!?()\[\]{}<>，。！？、：；（）【】《》「」『』〈〉]|[^a-z0-9_.-])`;

interface MentionPatternEntry {
  readonly agentId: AgentId;
  readonly pattern: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildWhitespaceTolerantMentionPattern(pattern: string): RegExp {
  const interleaved = Array.from(pattern)
    .map((ch) => escapeRegExp(ch))
    .join(String.raw`\s*`);
  return new RegExp(`(^|\\n)(${LINE_START_MARKDOWN_PREFIX_PATTERN})${interleaved}${HANDLE_BOUNDARY_PATTERN}`, 'giu');
}

function repairLineStartMentionWhitespace(text: string, entries: readonly MentionPatternEntry[]): string {
  let repaired = text;
  for (const entry of entries) {
    repaired = repaired.replace(
      buildWhitespaceTolerantMentionPattern(entry.pattern),
      (_match, lineStart: string, prefix: string) => `${lineStart}${prefix}${entry.pattern}`,
    );
  }
  return repaired;
}

/** @deprecated Suppression system removed — line-start mentions always route. Kept for backward compat. */
export type MentionSuppressionReason = 'no_action' | 'cross_paragraph';

/** @deprecated Suppression system removed. Kept for backward compat. */
export interface SuppressedA2AMention {
  readonly agentId: AgentId;
  readonly reason: MentionSuppressionReason;
}

export interface A2AMentionAnalysis {
  readonly mentions: AgentId[];
  /** @deprecated Always empty — suppression system removed. */
  readonly suppressed: SuppressedA2AMention[];
  /** F182: routing errors for disabled agents detected in text @ parsing */
  readonly routing_warnings: AgentRoutingError[];
}

/** #417: Inline @mention paired with action words — missed handoff candidate. */
export interface InlineActionMention {
  readonly agentId: AgentId;
  readonly lineText: string;
}

/** @deprecated Mode is ignored — line-start mentions always route regardless of mode. */
export type MentionActionabilityMode = 'strict' | 'relaxed';

export interface A2AMentionParseOptions {
  /** @deprecated Ignored — line-start mentions always route. Kept for backward compat. */
  readonly mode?: MentionActionabilityMode;
}

/**
 * Parse A2A @mentions from agent response text.
 * F27: Returns all matched AgentIds (up to MAX_A2A_MENTION_TARGETS).
 *
 * Line-start @mention = always actionable. No keyword gate.
 */
export function parseA2AMentions(
  text: string,
  currentAgentId?: AgentId,
  _options: A2AMentionParseOptions = {},
): AgentId[] {
  return analyzeA2AMentions(text, currentAgentId, _options).mentions;
}

export function analyzeA2AMentions(
  text: string,
  currentAgentId?: AgentId,
  _options: A2AMentionParseOptions = {},
): A2AMentionAnalysis {
  if (!text) return { mentions: [], suppressed: [], routing_warnings: [] };

  // 1. Strip fenced code blocks
  const stripped = text.replace(/```[\s\S]*?```/g, '');

  // F32-a: read from agentRegistry (.agent-studio/agent-catalog.json)
  const allConfigs = agentRegistry.getAllConfigs();

  // 2. Build patterns and sort longest-first to avoid prefix collisions
  // F182 KD-10: include ALL agents (including disabled) so patterns participate in matching;
  // availability is checked at match-time via resolveAgentTarget, not here.
  const entries: MentionPatternEntry[] = [];
  for (const [id, config] of Object.entries(allConfigs)) {
    if (currentAgentId && id === currentAgentId) continue; // 4. Filter self (skip when cross-thread)
    for (const pattern of config.mentionPatterns) {
      entries.push({ agentId: id as AgentId, pattern: pattern.toLowerCase() });
    }
  }
  entries.sort((a, b) => b.pattern.length - a.pattern.length);
  const normalizedText = repairLineStartMentionWhitespace(stripped, entries);

  // 3. Line-start matching with token boundary — always actionable (no keyword gate)
  const found: AgentId[] = [];
  const seen = new Set<string>();
  const routing_warnings: AgentRoutingError[] = [];
  const lines = normalizedText.split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const rawLine = lines[lineIndex]!;
    if (found.length >= MAX_A2A_MENTION_TARGETS) break; // 5. Safety limit

    const leadingWs = rawLine.match(/^\s*/)?.[0].length ?? 0;
    const normalized = rawLine.slice(leadingWs).toLowerCase().replace(LEADING_MARKDOWN_MENTION_PREFIX_RE, '');
    if (!normalized.startsWith('@')) {
      continue;
    }

    let cursor = 0;
    while (cursor < normalized.length && found.length < MAX_A2A_MENTION_TARGETS) {
      const segment = normalized.slice(cursor);
      let matched = false;

      for (const entry of entries) {
        if (!segment.startsWith(entry.pattern)) continue;
        const charAfter = segment[entry.pattern.length];
        const isBoundary = !charAfter || TOKEN_BOUNDARY_RE.test(charAfter) || !HANDLE_CONTINUATION_RE.test(charAfter);
        if (!isBoundary) continue;
        // F182 KD-10: resolver check at match-time (not at pattern-build time)
        const resolved = resolveAgentTarget(entry.agentId);
        if ('error' in resolved) {
          if (!seen.has(entry.agentId)) {
            seen.add(entry.agentId);
            routing_warnings.push(resolved.error);
          }
        } else if (!seen.has(entry.agentId)) {
          seen.add(entry.agentId);
          found.push(entry.agentId);
        }
        cursor += entry.pattern.length;
        matched = true;
        break; // longest-match-first: lock one winner at current cursor
      }

      if (!matched) break;

      while (cursor < normalized.length && TOKEN_BOUNDARY_RE.test(normalized[cursor]!)) {
        cursor += 1;
      }
      if (normalized[cursor] !== '@') {
        break;
      }
    }
  }

  return { mentions: found, suppressed: [], routing_warnings };
}

/**
 * #417: Detect inline @mentions paired with action words — missed handoff candidates.
 * Used for write-side feedback only, NOT for routing.
 *
 * Conditions (all must hold):
 *  1. @pattern appears mid-line (not at line start)
 *  2. Action keyword immediately adjacent to @mention (proximity-based, not whole-line)
 *  3. Not inside a fenced code block or blockquote
 *  4. Target agent was not already routed via line-start mention
 *  5. Not a self-mention
 */

/**
 * Action patterns that appear immediately BEFORE @mention (e.g. "Ready for @xxx").
 * Chinese 请 uses negative lookbehind to exclude compounds (邀请 = invite, 申请 = apply).
 */
/** @internal Exported for a2a-shadow-detection.ts. */
export const BEFORE_HANDOFF_RE = /(?:ready\s+for|交接给?|转给|(?<![邀申敬])请|帮)\s*$/i;
/**
 * Action patterns immediately AFTER @mention (e.g. "@xxx review").
 * English verbs use (?![a-z]) to reject continuations ("reviewed", "checklist").
 * Chinese verbs use negative lookahead to exclude completion suffixes (过/了/完/好/掉).
 */
/** @internal Exported for a2a-shadow-detection.ts. */
export const AFTER_HANDOFF_RE =
  /^\s*(?:(?:review|check|fix|merge)(?![a-z])|(?:确认|处理|来处理|来看)(?![过了完好掉])|看一?下|帮忙|请(?![教示假求问]))/i;

export function detectInlineActionMentions(
  text: string,
  currentAgentId?: AgentId,
  routedMentions?: AgentId[],
): InlineActionMention[] {
  if (!text) return [];

  const stripped = text.replace(/```[\s\S]*?```/g, '');
  const allConfigs = agentRegistry.getAllConfigs();

  const entries: MentionPatternEntry[] = [];
  for (const [id, config] of Object.entries(allConfigs)) {
    if (currentAgentId && id === currentAgentId) continue;
    if (!isAgentAvailable(id)) continue;
    for (const pattern of config.mentionPatterns) {
      entries.push({ agentId: id as AgentId, pattern: pattern.toLowerCase() });
    }
  }
  entries.sort((a, b) => b.pattern.length - a.pattern.length);

  const routedSet = new Set(routedMentions ?? []);
  const found: InlineActionMention[] = [];
  const seen = new Set<string>();

  for (const rawLine of stripped.split(/\r?\n/)) {
    const trimmed = rawLine.trimStart();
    const normalized = trimmed.toLowerCase();
    // Skip blockquotes; do NOT skip lines starting with @ — the inner loop's
    // routedSet handles line-start mentions, so other inline @ on the same line
    // can still be detected (P1 fix from codex review of agent-studio#1057).
    if (normalized.startsWith('>')) continue;

    let lineMatched = false;
    for (const entry of entries) {
      if (lineMatched) break;
      // Scan ALL occurrences of this pattern in the line (not just first indexOf hit).
      // Fixes: "之前 @codex 提过意见，现在 Ready for @codex review" must find the second one.
      let searchFrom = 0;
      while (searchFrom < normalized.length) {
        const idx = normalized.indexOf(entry.pattern, searchFrom);
        if (idx < 0) break;
        searchFrom = idx + 1;
        // Skip line-start mentions — those are handled by parseA2AMentions, not here.
        // Only skip this specific occurrence, not the whole line (P1 fix: other agents
        // on the same line may still be inline action mentions).
        if (idx === 0) continue;
        // Left boundary: @ must not be preceded by word-like chars (avoids "foo@codex")
        if (HANDLE_CONTINUATION_RE.test(normalized[idx - 1]!)) continue;
        const charAfter = normalized[idx + entry.pattern.length];
        const isBoundary = !charAfter || TOKEN_BOUNDARY_RE.test(charAfter) || !HANDLE_CONTINUATION_RE.test(charAfter);
        if (!isBoundary) continue;
        // Already routed via line-start: skip this entry but keep scanning other agents on same line.
        if (routedSet.has(entry.agentId)) break;
        const before = normalized.slice(0, idx);
        const after = normalized.slice(idx + entry.pattern.length);
        if (!BEFORE_HANDOFF_RE.test(before) && !AFTER_HANDOFF_RE.test(after)) continue;
        if (!seen.has(entry.agentId)) {
          seen.add(entry.agentId);
          found.push({ agentId: entry.agentId, lineText: rawLine.trim() });
          lineMatched = true;
        }
        // Already-seen agent: don't claim the line — let other agents still be scanned.
        break;
      }
    }
  }

  return found;
}

// --- baiyuxi-agent-studio#489: Shadow detection — extracted to a2a-shadow-detection.ts ---
export type { ShadowDetectionResult, ShadowMiss } from './a2a-shadow-detection.js';
export { detectInlineActionMentionsWithShadow } from './a2a-shadow-detection.js';
