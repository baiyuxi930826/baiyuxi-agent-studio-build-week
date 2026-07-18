/**
 * F168 Phase C — C1.2: RoleResolver 家里实现 (roster binding, aligned with ActorResolver).
 *
 * The community engine routes by ROLE, never agent name (INV-6). This module is the家里 binding
 * layer — the ONE place allowed to know agent names — implementing the shared `RoleResolver`
 * contract (C1.1). It maps a `CommunityRole` → `RoleExecutor` via deployment-owned bindings,
 * validating availability against an INJECTED roster getter (decoupled from the agent-config
 * singleton, ActorResolver-style, so tests provide mock rosters without global state).
 *
 * Fail-closed (INV-4 / INV-5): an unknown role, an unbound role, or an unavailable agent resolves
 * to `null` plus an OBSERVABLE warning (never a silent default). The case stays `triaged`;
 * nothing is silently routed or swallowed.
 *
 * NOTE (C1.3 grep guard): this file is the deliberate exception to the engine-zero-catname rule.
 * Agent ids live ONLY here (and in deployment config), never in the engine. The C1.3 guard
 * allowlists this module.
 */
import {
  type CommunityRole,
  isCommunityRole,
  isRoleCapability,
  type RoleCapability,
  type RoleExecutor,
  type RoleResolver,
} from '@agent-studio/shared';

/**
 * Minimal roster shape this resolver needs: availability only. Structurally satisfied by the
 * shared `Roster` (`Record<agentId, RosterEntry>` where RosterEntry has `available`), so the
 * production `getRoster` can be passed directly while tests pass a minimal stub.
 */
interface RoleResolverRosterEntry {
  readonly available: boolean;
}
type RoleResolverRosterGetter = () => Record<string, RoleResolverRosterEntry>;

/**
 * Deployment-owned binding for one role: which agent, which model, which prompt template, and the
 * capability ceiling. This is CONFIG, not engine code (INV-6 — lives in the binding layer).
 *
 * `model` is PINNED at the role level on purpose: the narrator deliberately runs a cheap/fast
 * model (it is high-volume triage, not deep reasoning), independent of the agent's general default.
 * It mirrors the agent's `defaultModel` in agent-config — update the two together when the agent's model
 * changes (a deliberate, reviewed deployment-config edit, not silent drift).
 */
export interface RoleBinding {
  readonly agentId: string;
  readonly model: string;
  readonly promptTemplateId: string;
  readonly capabilities: readonly RoleCapability[];
}

export type CommunityRoleBindings = Partial<Record<CommunityRole, RoleBinding>>;

/** Why a `resolve()` returned null — observable, never silent (INV-4 / INV-5). */
export type RoleResolveFailureReason =
  | 'unknown-role' // INV-4: argument is not a CommunityRole
  | 'unbound' // INV-5: role is known but no binding is configured
  | 'invalid-binding' // required deployment binding fields are missing / malformed
  | 'agent-not-in-roster' // INV-5: bound agentId is absent from the roster (misconfiguration)
  | 'agent-unavailable' // INV-5: bound agent is present but available:false (co-creator 40刀教训)
  | 'invalid-capability'; // INV-2: binding carries a capability outside the ROLE_CAPABILITIES ceiling

export interface RoleResolverDeps {
  /** Observable fail-closed hook. Defaults to console.warn (routed to pino). Never silent. */
  readonly onUnresolved?: (role: string, reason: RoleResolveFailureReason) => void;
}

const defaultOnUnresolved = (role: string, reason: RoleResolveFailureReason): void => {
  console.warn(`[RoleResolver] resolve('${role}') → null (${reason}) — case stays triaged, not silently routed`);
};

/**
 * Factory: binds a `RoleResolver` to a roster source + deployment bindings. ActorResolver-style
 * injectable so tests supply mock rosters/bindings without touching the agent-config singleton.
 */
export function createRoleResolver(
  getRoster: RoleResolverRosterGetter,
  bindings: CommunityRoleBindings,
  deps: RoleResolverDeps = {},
): RoleResolver {
  const onUnresolved = deps.onUnresolved ?? defaultOnUnresolved;
  return {
    resolve(role: CommunityRole): RoleExecutor | null {
      // INV-4: fail-closed on an unknown role. The signature says CommunityRole, but callers may
      // pass untrusted strings (cast / deserialized) — defend in depth.
      if (!isCommunityRole(role)) {
        onUnresolved(String(role), 'unknown-role');
        return null;
      }
      // INV-5: role known but unbound.
      const binding = bindings[role];
      if (!binding) {
        onUnresolved(role, 'unbound');
        return null;
      }
      // Deployment bindings can be deserialized / cast from untyped config. Validate required
      // strings before constructing an executor so failures stay at the resolver boundary instead
      // of surfacing later in narrator spawn.
      if (
        typeof binding.agentId !== 'string' ||
        binding.agentId.trim() === '' ||
        typeof binding.model !== 'string' ||
        binding.model.trim() === '' ||
        typeof binding.promptTemplateId !== 'string' ||
        binding.promptTemplateId.trim() === ''
      ) {
        onUnresolved(role, 'invalid-binding');
        return null;
      }
      // INV-2: capabilities come from deployment config — `readonly RoleCapability[]` is only a
      // compile-time hint, so a drifted/deserialized binding can carry an out-of-ceiling capability
      // (e.g. 'code') or omit the field entirely. Re-validate at the trust boundary, mirroring the
      // isCommunityRole role check above: fail closed rather than hand the engine a power the ceiling
      // forbids. The TS type makes the ceiling unrepresentable; this makes it unenforceable to bypass.
      if (!Array.isArray(binding.capabilities) || !binding.capabilities.every(isRoleCapability)) {
        onUnresolved(role, 'invalid-capability');
        return null;
      }
      // INV-5: validate the bound agent against a SINGLE consistent roster snapshot (read once, so a
      // concurrent config reload can never be observed half-applied mid-resolve).
      const roster = getRoster();
      const entry = roster[binding.agentId];
      if (!entry) {
        onUnresolved(role, 'agent-not-in-roster');
        return null;
      }
      if (!entry.available) {
        onUnresolved(role, 'agent-unavailable');
        return null;
      }
      return {
        agentId: binding.agentId,
        model: binding.model,
        promptTemplateId: binding.promptTemplateId,
        capabilities: binding.capabilities,
      };
    },
  };
}

/**
 *家里 default bindings (deployment-config seam). Together with agent ids in deployment config, this
 * is the ONE place agent names appear — allowlisted by the C1.3 engine-zero-catname grep guard.
 *
 * - narrator → gemini (资料卡 handle @andy, Andy（界面与视觉）). Model pinned to gemini-3.5-flash (cheap,
 *   fast — narration is high-volume triage). Capabilities exclude code/merge/worktree (INV-2): the
 *   narrator triages, recommends a route, and replies — it never owns case state or touches code.
 * - case-owner / reconciler are reserved (Phase C is narrator-first); they are bound in later phases.
 */
export const DEFAULT_COMMUNITY_ROLE_BINDINGS: CommunityRoleBindings = {
  narrator: {
    agentId: 'gemini',
    model: 'gemini-3.5-flash',
    promptTemplateId: 'community-narrator-v1',
    capabilities: ['triage', 'route-recommend', 'public-reply'],
  },
};
