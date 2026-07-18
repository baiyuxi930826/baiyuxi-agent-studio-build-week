/**
 * F056 agentId → CSS variable helper.
 *
 * agentSlug() returns agentId directly — the runtime agentId (e.g. "opus", "codex")
 * is already the CSS key. AgentHueInjector generates --color-{agentId}-* tokens
 * dynamically for all agents.
 *
 * Safety: agentSlug() validates that the ID is CSS-safe (alphanumeric + hyphen +
 * underscore). This must match AgentHueInjector's guard — if AgentHueInjector
 * skips an ID, agentSlug() must not return it (the reference would point to a
 * non-existent token). Unsafe IDs fall back to 'cocreator' so they still
 * get valid styling instead of broken var() references.
 */

const CSS_SAFE_ID = /^[a-zA-Z0-9_-]+$/;

/** Return the CSS key for a agentId. Validates safety for CSS var interpolation. */
export function agentSlug(agentId: string | undefined): string {
  if (!agentId) return 'cocreator';
  if (!CSS_SAFE_ID.test(agentId)) return 'cocreator';
  return agentId;
}

/** Build `var(--color-{agentId}-{tier})` for a agent color. Default tier is primary. */
export function agentColorVar(
  agentId: string | undefined,
  tier: 'bubble' | 'surface' | 'text' | 'ring' | 'primary' | 'light' | 'dark' | 'bg' = 'primary',
): string {
  return `var(--color-${agentSlug(agentId)}-${tier})`;
}

/** Build `color-mix(...)` for a agent color with alpha. Routes through the agent
 * token, so opacity overlays still follow Tuner-controlled gradient. */
export function agentColorMix(
  agentId: string | undefined,
  alpha: number,
  tier: 'primary' | 'surface' | 'bubble' = 'primary',
): string {
  const pct = Math.round(alpha * 100);
  return `color-mix(in srgb, ${agentColorVar(agentId, tier)} ${pct}%, transparent)`;
}
