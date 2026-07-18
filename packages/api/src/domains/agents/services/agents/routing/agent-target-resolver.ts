import type { AgentAlternative, AgentId, AgentRoutingError } from '@agent-studio/shared';
import { agentRegistry } from '@agent-studio/shared';
import { getRoster } from '../../../../../config/agent-config-loader.js';

function buildAlts(excludeId: string | null, preferFamily?: string): AgentAlternative[] {
  const roster = getRoster();
  const configs = agentRegistry.getAllConfigs();
  return Object.entries(roster)
    .filter(([id, e]) => id !== excludeId && e.available && agentRegistry.has(id))
    .map(([id, e]) => ({
      agentId: id as AgentId,
      mention: configs[id]?.mentionPatterns[0] ?? `@${id}`,
      displayName: configs[id]?.displayName ?? id,
      family: e.family,
    }))
    .sort((a, b) => {
      const fd = +(a.family !== preferFamily) - +(b.family !== preferFamily);
      const la = roster[a.agentId]?.lead ? 0 : 1;
      const lb = roster[b.agentId]?.lead ? 0 : 1;
      return fd || la - lb || a.agentId.localeCompare(b.agentId);
    });
}

export function resolveAgentTarget(mentionOrId: string): { ok: AgentId } | { error: AgentRoutingError } {
  const input = (mentionOrId.startsWith('@') ? mentionOrId.slice(1) : mentionOrId).toLowerCase();
  const configs = agentRegistry.getAllConfigs();
  let agentId: string | undefined = agentRegistry.has(input) ? input : undefined;
  if (!agentId) {
    outer: for (const [id, cfg] of Object.entries(configs)) {
      for (const p of cfg.mentionPatterns) {
        if ((p.startsWith('@') ? p.slice(1) : p).toLowerCase() === input) {
          agentId = id;
          break outer;
        }
      }
    }
  }
  if (!agentId) return { error: { kind: 'agent_not_found', mention: mentionOrId, alternatives: buildAlts(null) } };
  // KD-9: two-step check — isAgentAvailable not used (it returns true for not-in-roster)
  // agents not in roster = available (backward compat); only explicit available:false = disabled
  const entry = getRoster()[agentId];
  if (entry && entry.available === false) {
    return {
      error: {
        kind: 'agent_disabled',
        agentId: agentId as AgentId,
        displayName: configs[agentId]?.displayName ?? agentId,
        alternatives: buildAlts(agentId, entry.family),
      },
    };
  }
  return { ok: agentId as AgentId };
}
