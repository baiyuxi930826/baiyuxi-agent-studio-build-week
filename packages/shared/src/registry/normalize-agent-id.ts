/**
 * normalizeAgentId — resolve user input (agent name / alias / agentId) to registered agentId.
 *
 * F154 AC-A3: uses agentRegistry as source of truth (not hardcoded aliases).
 * F154 AC-A7 / KD-8: ambiguous partial match → reject with candidate list.
 *
 * Priority: exact agentId → exact alias (strip @, case-insensitive) → partial displayName/nickname.
 */

import type { AgentId } from '../types/ids.js';
import { createAgentId } from '../types/ids.js';
import { agentRegistry } from './AgentRegistry.js';

export type NormalizeAgentResult =
  | { ok: true; agentId: AgentId }
  | { ok: false; reason: 'not-found'; input: string }
  | { ok: false; reason: 'ambiguous'; input: string; candidates: string[] };

function agentMentionPatterns(config: { mentionPatterns?: unknown }): readonly string[] {
  if (!Array.isArray(config.mentionPatterns)) {
    return [];
  }
  return config.mentionPatterns.filter((pattern): pattern is string => typeof pattern === 'string');
}

function agentSearchLabels(config: { displayName?: unknown; nickname?: unknown }): string[] {
  const labels: string[] = [];
  if (typeof config.displayName === 'string') {
    labels.push(config.displayName);
  }
  if (typeof config.nickname === 'string') {
    labels.push(config.nickname);
  }
  return labels;
}

function findExactAlias(allConfigs: Record<string, { mentionPatterns?: unknown }>, lower: string): AgentId | undefined {
  for (const [agentId, config] of Object.entries(allConfigs)) {
    for (const pattern of agentMentionPatterns(config)) {
      const stripped = pattern.startsWith('@') ? pattern.slice(1) : pattern;
      if (stripped.toLowerCase() === lower) {
        return createAgentId(agentId);
      }
    }
  }
  return undefined;
}

function findPartialMatches(
  allConfigs: Record<string, { displayName?: unknown; nickname?: unknown }>,
  lower: string,
): string[] {
  const partials: string[] = [];
  for (const [agentId, config] of Object.entries(allConfigs)) {
    if (agentSearchLabels(config).some((label) => label.toLowerCase().includes(lower))) {
      partials.push(agentId);
    }
  }
  return partials;
}

export function normalizeAgentId(input: string): NormalizeAgentResult {
  const cleaned = input.startsWith('@') ? input.slice(1) : input;
  const lower = cleaned.toLowerCase();

  if (!lower) {
    return { ok: false, reason: 'not-found', input: cleaned };
  }

  // 1. Exact agentId match (case-insensitive)
  if (agentRegistry.has(lower)) {
    return { ok: true, agentId: createAgentId(lower) };
  }

  // 2. Exact alias match (mentionPatterns without @, case-insensitive)
  const allConfigs = agentRegistry.getAllConfigs();
  const exactAlias = findExactAlias(allConfigs, lower);
  if (exactAlias) {
    return { ok: true, agentId: exactAlias };
  }

  // 3. Partial displayName / nickname match
  const partials = findPartialMatches(allConfigs, lower);

  if (partials.length === 1) {
    return { ok: true, agentId: createAgentId(partials[0]) };
  }
  if (partials.length > 1) {
    return { ok: false, reason: 'ambiguous', input: cleaned, candidates: partials };
  }

  return { ok: false, reason: 'not-found', input: cleaned };
}
