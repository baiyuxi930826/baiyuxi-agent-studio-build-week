/**
 * F056 — Centralized agent & owner fallback colors (single source of truth).
 *
 * These hex values are JS-level fallbacks for when agent/owner config hasn't
 * loaded yet. They feed JS color computation (hexToOklch, inline style derivation)
 * — CSS tokens can't serve this role because the values must be manipulable in JS.
 *
 * Agent persona CSS tokens (--color-{agentId}-*) are injected dynamically by
 * AgentHueInjector from the live agent catalog. These fallbacks are the safety net
 * for pre-load, SSR, and edge cases where the catalog hasn't arrived.
 *
 * Truth source: agent-persona-tokens.css (cocreator hue/chroma) + agent-template.json.
 */

export interface AgentColorPair {
  primary: string;
  secondary: string;
}

/** Agent persona fallback colors keyed by agentId.
 * Values mirror agent-template.json defaults — update both when adding a new agent. */
export const AGENT_COLORS: Record<string, AgentColorPair> = {
  opus: { primary: '#9B7EBD', secondary: '#E8DFF5' },
  codex: { primary: '#5B8C5A', secondary: '#D4E6D3' },
  gemini: { primary: '#5B9BD5', secondary: '#D6E9F8' },
  kimi: { primary: '#4B5563', secondary: '#E5E7EB' },
  dare: { primary: '#D4A76A', secondary: '#FFF8F0' },
};

/** Fallback when agentId is unknown or color data is missing entirely. */
export const UNKNOWN_AGENT_COLOR: AgentColorPair = { primary: '#9B7EBD', secondary: '#E8DFF5' };

/** Neutral gray for status dots when no agent color is available (PlanBoard, etc.). */
export const NEUTRAL_DOT_COLOR = '#9CA3AF';

/** Owner default colors. */
export const CO_CREATOR_COLOR: AgentColorPair = { primary: '#D4A76A', secondary: '#FFF8F0' };

/** Co-creator @mention highlight (warm gold, visually distinct from bubble primary). */
export const CO_CREATOR_MENTION_COLOR = '#F5A623';

/** HTML <meta name="theme-color"> — brand accent for mobile browser chrome. */
export const META_THEME_COLOR = '#E29578';

/** Default new-label color for ThreadLabelPicker initial state. */
export const DEFAULT_LABEL_COLOR = '#5B8C5A';

/** Group mention accent (used by @thread / @all input options). */
export const GROUP_MENTION_COLOR = '#6B7280';

/* ── Helpers ── */

/** Get agent primary color by agentId, falling back to UNKNOWN_AGENT_COLOR. */
export function agentPrimary(agentId: string): string {
  return AGENT_COLORS[agentId]?.primary ?? UNKNOWN_AGENT_COLOR.primary;
}

/** Get full agent color pair by agentId, falling back to UNKNOWN_AGENT_COLOR. */
export function agentColor(agentId: string): AgentColorPair {
  return AGENT_COLORS[agentId] ?? UNKNOWN_AGENT_COLOR;
}
