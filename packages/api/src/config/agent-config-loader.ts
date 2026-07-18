/**
 * Agent Config Loader
 * 从 agent-template.json / .agent-studio/agent-catalog.json 加载 Role+Variant 配置。
 * Node-only — 前端通过 /api/agents 获取智能体数据。
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AgentConfig,
  AgentFeatures,
  AgentId,
  AgentRole,
  AgentStudioConfig,
  AgentVariant,
  CoCreatorConfig,
  ContextBudget,
  MissionHubSelfClaimScope,
  ReviewPolicy,
  Roster,
} from '@agent-studio/shared';
import { agentRegistry, type ClientId, createAgentId, normalizeCliEffortForProvider } from '@agent-studio/shared';
import { z } from 'zod';
import { createModuleLogger } from '../infrastructure/logger.js';
import { bootstrapAgentCatalog, readAgentCatalogRaw, resolveAgentCatalogPath } from './agent-catalog-store.js';
import { isValidTimeZone } from './time-zone.js';

const log = createModuleLogger('agent-config');

/**
 * Default agent-template.json location (repo root).
 *
 * IMPORTANT: API dev scripts run with cwd=`packages/api`, so `process.cwd()` is
 * not the repo root. Resolve relative to this file instead to keep behavior
 * stable across different launch directories.
 */
const DEFAULT_AGENT_TEMPLATE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../..',
  'agent-template.json',
);

const cliConfigSchema = z.object({
  command: z.string().min(1),
  outputFormat: z.string().min(1),
  defaultArgs: z.array(z.string()).optional(),
  effort: z.enum(['low', 'medium', 'high', 'max', 'xhigh']).optional(),
  contextWindow: z.number().positive().int().optional(),
  autoCompactTokenLimit: z.number().positive().int().optional(),
});

const contextBudgetSchema = z.object({
  maxPromptTokens: z.number().positive(),
  maxContextTokens: z.number().positive(),
  maxMessages: z.number().positive().int(),
  maxContentLengthPerMsg: z.number().positive(),
});

const agyProfileSchema = z
  .object({
    enabled: z.boolean().optional(),
    profileId: z.string().min(1).optional(),
    homeRoot: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    autoApprove: z.boolean().optional(),
    trustedWorkspaces: z.array(z.string().min(1)).optional(),
  })
  .optional();

/** F32-b: mentionPatterns must start with @ */
const mentionPatternSchema = z.string().min(2).regex(/^@/, 'mentionPattern must start with @');

const colorSchema = z.object({ primary: z.string(), secondary: z.string() });

const timeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .refine(isValidTimeZone, { message: 'timeZone must be a valid IANA timezone' });

const agentVariantSchema = z.object({
  id: z.string().min(1),
  agentId: z.string().min(1).optional(), // F32-b: variant-level agentId
  displayName: z.string().min(1).optional(), // F32-b: variant-level displayName
  variantLabel: z.string().min(1).optional(), // F32-b P4: disambiguation label
  mentionPatterns: z.array(mentionPatternSchema).optional(), // F32-b: variant-level mentions
  source: z.string().optional(), // #441: legacy field, ignored — kept in schema for old catalog read compat
  accountRef: z.string().min(1).optional(), // F127: concrete account binding
  clientId: z.string().min(1), // #252: accept unknown providers to avoid full config crash

  defaultModel: z.string(), // OAuth/subscription CLIs have built-in defaults; api_key validated at route level
  mcpSupport: z.boolean(),
  cli: cliConfigSchema.optional(),
  agyProfile: agyProfileSchema,
  commandArgs: z.array(z.string().min(1)).optional(), // F127: explicit bridge args (e.g. Antigravity)
  cliConfigArgs: z.array(z.string().min(1)).optional(), // F127: extra CLI args per member
  /** baiyuxi-agent-studio#340 P5: Model provider name (renamed from ocProviderName). */
  provider: z
    .string()
    .trim()
    .min(1, 'provider must not be blank')
    .refine((v) => !v.includes('/'), 'provider must not contain "/"')
    .optional(),
  roleDescription: z.string().min(1).optional(), // F127 review fix: allow variant-scoped roleDescription override
  sessionChain: z.boolean().optional(), // F127 review fix: allow variant-scoped sessionChain override
  personality: z.string().optional(),
  strengths: z.array(z.string()).optional(),
  avatar: z.string().min(1).optional(), // F32-b P4c: override role avatar
  color: colorSchema.optional(), // F32-b P4c: override role color
  contextBudget: contextBudgetSchema.optional(),
  voiceConfig: z // F103: per-agent TTS voice configuration
    .object({
      voice: z.string().min(1),
      langCode: z.string().min(1),
      speed: z.number().positive().optional(),
      refAudio: z.string().min(1).optional(),
      refText: z.string().min(1).optional(),
      instruct: z.string().min(1).optional(),
      temperature: z.number().min(0).max(2).optional(),
    })
    .optional(),
  teamStrengths: z.string().optional(), // F-Ground-3: human-readable strengths
  caution: z.string().nullable().optional(), // F-Ground-3: null = explicit no-caution (R1 fix)
  restrictions: z.array(z.string().min(1)).optional(), // F167 Phase E: hard task bans
});

/** F33 Phase 2: session strategy config (matches SessionStrategyConfig from shared).
 *  Exported for reuse by Phase 3 API route validation. */
export const sessionStrategySchema = z
  .object({
    strategy: z.enum(['handoff', 'compress', 'hybrid']),
    thresholds: z
      .object({
        warn: z.number().min(0).max(1),
        action: z.number().min(0).max(1),
      })
      .refine((t) => t.warn < t.action, { message: 'thresholds.warn must be less than thresholds.action' })
      .optional(),
    handoff: z
      .object({
        preSealMemoryDump: z.boolean(),
        bootstrapDepth: z.enum(['extractive', 'generative']),
      })
      .optional(),
    compress: z
      .object({
        maxCompressions: z.number().int().positive().optional(),
        trackPostCompression: z.boolean(),
      })
      .optional(),
    hybrid: z
      .object({
        maxCompressions: z.number().int().positive(),
      })
      .optional(),
    turnBudget: z.number().int().positive().optional(),
    safetyMargin: z.number().int().positive().optional(),
  })
  .optional();

const agentFeaturesSchema = z
  .object({
    sessionChain: z.boolean().optional(),
    sessionStrategy: sessionStrategySchema,
    missionHub: z
      .object({
        selfClaimScope: z.enum(['disabled', 'once', 'thread', 'global']).optional(),
      })
      .optional(),
  })
  .optional();

const agentRoleSchema = z.object({
  id: z.string().min(1),
  agentId: z.string().min(1),
  name: z.string().min(1),
  displayName: z.string().min(1),
  nickname: z.string().nullable().optional(),
  avatar: z.string().min(1),
  color: colorSchema,
  mentionPatterns: z.array(mentionPatternSchema).min(1),
  roleDescription: z.string().min(1),
  defaultVariantId: z.string().min(1),
  variants: z.array(agentVariantSchema).min(1),
  features: agentFeaturesSchema,
  teamStrengths: z.string().optional(), // F-Ground-3: role-level default
  caution: z.string().nullable().optional(), // F-Ground-3: null = explicit no-caution (R1 fix)
  restrictions: z.array(z.string().min(1)).optional(), // F167 Phase E: role-level hard task bans
});

// ── F032: Roster schema for collaboration rules ──────────────────────

/** Roster entry for a single agent */
const rosterEntrySchema = z.object({
  family: z.string().min(1),
  roles: z.array(z.string().min(1)).min(1),
  lead: z.boolean(),
  available: z.boolean(),
  evaluation: z.string().min(1),
});

/** Review policy configuration */
const reviewPolicySchema = z.object({
  requireDifferentFamily: z.boolean(),
  preferActiveInThread: z.boolean(),
  preferLead: z.boolean(),
  excludeUnavailable: z.boolean(),
});

// Note: Roster, RosterEntry, ReviewPolicy types imported from @agent-studio/shared above

/** F067: Owner config schema */
const coCreatorConfigSchema = z.object({
  name: z.string().min(1),
  aliases: z.array(z.string().min(1)),
  mentionPatterns: z.array(mentionPatternSchema).min(1),
  timeZone: timeZoneSchema.optional(),
  avatar: z.string().min(1).optional(),
  color: colorSchema.optional(),
});

/** Version 1: roles only (legacy) */
const agentStudioConfigSchemaV1 = z.object({
  version: z.literal(1),
  roles: z.array(agentRoleSchema),
});

/** Version 2: roles + roster + reviewPolicy (F032) + coCreator (F067) */
const agentStudioConfigSchemaV2 = z
  .object({
    version: z.literal(2),
    roles: z.array(agentRoleSchema),
    roster: z.record(z.string(), rosterEntrySchema),
    reviewPolicy: reviewPolicySchema,
    coCreator: coCreatorConfigSchema.optional(),
    /** @deprecated Accepted for backward compat; migrated to coCreator at parse time. */
    owner: coCreatorConfigSchema.optional(),
  })
  .transform((data) => {
    // Migrate legacy "owner" key → "coCreator" (coCreator takes precedence)
    const { owner: legacyOwner, ...rest } = data;
    if (!rest.coCreator && legacyOwner) {
      return { ...rest, coCreator: legacyOwner };
    }
    return rest;
  });

/** Union of all versions — loader handles migration */
const agentStudioConfigSchema = z.union([agentStudioConfigSchemaV1, agentStudioConfigSchemaV2]);

/** baiyuxi-agent-studio#340: Read agent-template.json directly — agent-config.json is no longer a runtime source. */
function readTemplate(templatePath: string): string {
  try {
    return readFileSync(templatePath, 'utf-8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    throw new Error(`Failed to read agent-template.json at ${templatePath}: ${code ?? 'unknown error'}`);
  }
}

/**
 * Keys that represent atomic config units — overlay replaces base entirely,
 * even though they are plain objects. Prevents stale sub-fields from leaking
 * across provider switches (e.g. template cli.defaultArgs surviving into a
 * catalog variant that switched to a different client).
 */
const ATOMIC_OBJECT_KEYS = new Set(['cli', 'agyProfile', 'color', 'contextBudget', 'voiceConfig']);

/**
 * Deep merge two plain objects. `overlay` fields override `base` fields.
 * - Atomic keys (cli, color, etc.): overlay replaces base entirely.
 * - Other objects: recursively merged (base fields preserved if absent from overlay).
 * - Arrays of objects with `id`: key-based merge (matched by id, then deep-merged).
 *   Overlay-only items appended; base-only items preserved.
 * - Other arrays / primitives: overlay replaces base.
 */
function deepMergeConfig(base: Record<string, unknown>, overlay: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };
  for (const key of Object.keys(overlay)) {
    const bVal = base[key];
    const oVal = overlay[key];
    if (ATOMIC_OBJECT_KEYS.has(key)) {
      merged[key] = oVal;
    } else if (Array.isArray(oVal) && Array.isArray(bVal) && oVal.length > 0 && isIdArray(oVal) && isIdArray(bVal)) {
      merged[key] = mergeById(bVal as HasId[], oVal as HasId[]);
    } else if (isPlainObject(oVal) && isPlainObject(bVal)) {
      merged[key] = deepMergeConfig(bVal as Record<string, unknown>, oVal as Record<string, unknown>);
    } else {
      merged[key] = oVal;
    }
  }
  return merged;
}

type HasId = Record<string, unknown> & { id: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isIdArray(arr: unknown[]): arr is HasId[] {
  return (
    arr.length > 0 &&
    arr.every((item) => isPlainObject(item) && typeof (item as Record<string, unknown>).id === 'string')
  );
}

function mergeById(base: HasId[], overlay: HasId[]): HasId[] {
  const baseMap = new Map(base.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const result: HasId[] = [];
  for (const oItem of overlay) {
    seen.add(oItem.id);
    const bItem = baseMap.get(oItem.id);
    result.push(bItem ? (deepMergeConfig(bItem, oItem) as HasId) : oItem);
  }
  // Preserve base-only items (new items added to agent-template.json but not yet in catalog)
  for (const bItem of base) {
    if (!seen.has(bItem.id)) result.push(bItem);
  }
  return result;
}

type RoleWithResolvedAgentIds = HasId & {
  agentId?: string;
  variants?: Array<{
    agentId?: string;
  }>;
};

function collectResolvedAgentIds(roles: RoleWithResolvedAgentIds[]): Set<string> {
  const agentIds = new Set<string>();
  for (const role of roles) {
    if (role.agentId) agentIds.add(role.agentId);
    for (const variant of Array.isArray(role.variants) ? role.variants : []) {
      const resolvedAgentId = variant.agentId ?? role.agentId;
      if (resolvedAgentId) agentIds.add(resolvedAgentId);
    }
  }
  return agentIds;
}

/**
 * Merge template + catalog with #772 template-only role filter applied.
 * Shared by loadAgentConfig() and getAcpConfig() to avoid duplicate merge paths.
 */
function mergeTemplateWithCatalog(templatePath: string): string | null {
  const projectRoot = dirname(templatePath);
  const catalogRaw = readAgentCatalogRaw(projectRoot);
  if (catalogRaw === null) return null;

  const baseRaw = readTemplate(templatePath);
  const baseJson = JSON.parse(baseRaw) as Record<string, unknown>;
  const catalogJson = JSON.parse(catalogRaw) as Record<string, unknown>;
  const merged = deepMergeConfig(baseJson, catalogJson);

  // #772: Template-only roles must not leak into runtime.
  // When a catalog exists, only catalog roles are runtime members.
  // roles: [] (bootstrap state) means "no roles" — all template roles are menu data only.
  const catalogRoles = Array.isArray(catalogJson.roles) ? (catalogJson.roles as RoleWithResolvedAgentIds[]) : [];
  const catalogRoleIds = new Set(catalogRoles.map((role) => role.id));
  if (Array.isArray(merged.roles)) {
    merged.roles = (merged.roles as RoleWithResolvedAgentIds[]).filter((role) => catalogRoleIds.has(role.id));
  }
  const runtimeAgentIds = Array.isArray(merged.roles)
    ? collectResolvedAgentIds(merged.roles as RoleWithResolvedAgentIds[])
    : new Set<string>();

  // Prune roster entries for template-only roles — preserve variant, owner,
  // and other catalog-added entries. Runs even when catalogRoles is empty
  // (bootstrap writes roles:[] + owner roster; template roster must not leak).
  const baseRoles = Array.isArray(baseJson.roles) ? (baseJson.roles as RoleWithResolvedAgentIds[]) : [];
  const templateOnlyAgentIds = collectResolvedAgentIds(baseRoles.filter((role) => !catalogRoleIds.has(role.id)));
  for (const runtimeAgentId of runtimeAgentIds) templateOnlyAgentIds.delete(runtimeAgentId);
  if (templateOnlyAgentIds.size > 0 && merged.roster && typeof merged.roster === 'object') {
    for (const key of Object.keys(merged.roster as Record<string, unknown>)) {
      if (templateOnlyAgentIds.has(key)) delete (merged.roster as Record<string, unknown>)[key];
    }
  }

  return JSON.stringify(merged);
}

/**
 * Load and validate the resolved agent config source.
 * Explicit filePath reads that file directly.
 * Default resolution: agent-template.json is the base, .agent-studio/agent-catalog.json is a delta overlay.
 * Catalog fields override config fields (deep merge); config fields absent from catalog are preserved.
 */
export function loadAgentConfig(filePath?: string): AgentStudioConfig {
  let raw: string;
  let resolvedPath = filePath;
  if (filePath) {
    try {
      raw = readFileSync(filePath, 'utf-8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      throw new Error(`Failed to read agent config at ${filePath}: ${code ?? 'unknown error'}`);
    }
  } else {
    const templatePath = process.env.AGENT_TEMPLATE_PATH ?? DEFAULT_AGENT_TEMPLATE_PATH;
    const merged = mergeTemplateWithCatalog(templatePath);
    if (merged !== null) {
      raw = merged;
      resolvedPath = resolveAgentCatalogPath(dirname(templatePath));
    } else {
      raw = readTemplate(templatePath);
      resolvedPath = templatePath;
    }
  }

  const json: unknown = JSON.parse(raw);
  const result = agentStudioConfigSchema.safeParse(json);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid agent config:\n${issues.join('\n')}`);
  }

  // Validate defaultVariantId references
  for (const role of result.data.roles) {
    const found = role.variants.find((v) => v.id === role.defaultVariantId);
    if (!found) {
      throw new Error(`Role "${role.id}": defaultVariantId "${role.defaultVariantId}" not found in variants`);
    }
  }

  // Validate that configured mentionPatterns are non-empty.
  // The canonical @agentId handle is no longer required — users may replace it
  // with custom aliases via the Hub editor, as long as at least one alias exists.
  for (const role of result.data.roles) {
    if (role.mentionPatterns.length === 0) {
      throw new Error(`Role "${role.id}": mentionPatterns must have at least one entry`);
    }
  }

  // Zod output has mutable arrays + plain string agentId;
  // AgentStudioConfig has readonly arrays + branded AgentId.
  // The shapes match at runtime after validation.
  return result.data as unknown as AgentStudioConfig;
}

export function bootstrapDefaultAgentCatalog(templatePath?: string): AgentStudioConfig {
  const resolvedTemplatePath = templatePath ?? process.env.AGENT_TEMPLATE_PATH ?? DEFAULT_AGENT_TEMPLATE_PATH;
  const projectRoot = dirname(resolvedTemplatePath);
  const catalogPath = bootstrapAgentCatalog(projectRoot, resolvedTemplatePath);
  return loadAgentConfig(catalogPath);
}

/** Get the default variant for a role */
export function getDefaultVariant(role: AgentRole): AgentVariant {
  const found = role.variants.find((variant) => variant.id === role.defaultVariantId);
  if (!found) throw new Error(`Default variant "${role.defaultVariantId}" not found for role "${role.id}"`);
  return found;
}

/**
 * F32-b: Register ALL variants as independent agents.
 * Each variant becomes a AgentConfig entry keyed by its agentId.
 * Default variant inherits role-level mentionPatterns; others default to @agentId when unspecified.
 * @throws Error on duplicate agentId (fail-fast at startup)
 */
export function toAllAgentConfigs(config: AgentStudioConfig): Record<string, AgentConfig> {
  const result: Record<
    string,
    AgentConfig & {
      contextBudget?: ContextBudget;
    }
  > = {};
  for (const role of config.roles) {
    // F32-b P4c: resolve default variant personality for non-default fallback
    const defaultVariant = role.variants.find((v) => v.id === role.defaultVariantId);

    for (const variant of role.variants) {
      const isDefault = variant.id === role.defaultVariantId;
      const agentId = variant.agentId ?? role.agentId;
      const fallbackMentionPatterns = isDefault ? role.mentionPatterns : [`@${agentId}`];
      const mentionPatterns =
        variant.mentionPatterns && variant.mentionPatterns.length > 0
          ? variant.mentionPatterns
          : fallbackMentionPatterns;

      // F32-b R3: agentId uniqueness — duplicate is a hard error (startup failure)
      if (result[agentId]) {
        throw new Error(
          `Duplicate agentId "${agentId}": variant "${variant.id}" in role "${role.id}" ` +
            `conflicts with already registered agent. Each variant must have a unique agentId.`,
        );
      }

      const teamStrengths = variant.teamStrengths ?? role.teamStrengths;
      // R1 fix: null = "explicitly no caution" (don't inherit role).
      // undefined (omitted) = inherit from role. ?? treats null as nullish, so use !== undefined.
      const caution = variant.caution !== undefined ? variant.caution : role.caution;
      // F167 Phase E (KD-20): variant restrictions override role (no merge);
      // undefined (omitted) inherits role-level restrictions.
      const restrictions = variant.restrictions ?? role.restrictions;
      const projectedCommandArgs =
        variant.commandArgs ??
        (variant.clientId === 'antigravity' && variant.cli?.defaultArgs && variant.cli.defaultArgs.length > 0
          ? variant.cli.defaultArgs
          : undefined);

      result[agentId] = {
        id: createAgentId(agentId),
        name: variant.displayName ?? role.name,
        displayName: variant.displayName ?? role.displayName,
        ...(role.nickname != null ? { nickname: role.nickname } : {}),
        avatar: variant.avatar ?? role.avatar, // F32-b P4c: variant can override
        color: variant.color ?? role.color, // F32-b P4c: variant can override
        mentionPatterns,
        ...(variant.accountRef != null ? { accountRef: variant.accountRef } : {}),
        clientId: variant.clientId as ClientId, // #252: Zod now accepts any string; downstream switch/case has default branches
        defaultModel: variant.defaultModel,
        mcpSupport: variant.mcpSupport,
        ...(variant.agyProfile != null ? { agyProfile: variant.agyProfile } : {}),
        ...(projectedCommandArgs != null ? { commandArgs: projectedCommandArgs } : {}),
        ...(variant.cliConfigArgs != null && variant.cliConfigArgs.length > 0
          ? { cliConfigArgs: [...variant.cliConfigArgs] }
          : {}),
        ...(variant.cli != null ? { cli: variant.cli } : {}),
        ...(variant.provider != null ? { provider: variant.provider } : {}),
        ...(variant.contextBudget != null ? { contextBudget: variant.contextBudget } : {}),
        ...(variant.voiceConfig != null ? { voiceConfig: variant.voiceConfig } : {}),
        roleDescription: variant.roleDescription ?? role.roleDescription,
        personality: variant.personality ?? defaultVariant?.personality ?? '',
        roleId: role.id,
        roleDisplayName: role.displayName,
        ...(variant.variantLabel != null ? { variantLabel: variant.variantLabel } : {}),
        isDefaultVariant: isDefault,
        ...(teamStrengths != null ? { teamStrengths } : {}),
        // R1 fix: preserve null (explicit no-caution) in AgentConfig; only omit if undefined
        ...(caution !== undefined ? { caution } : {}),
        // F167 Phase E: preserve restrictions list for teammate roster + self-awareness injection
        ...(restrictions != null && restrictions.length > 0 ? { restrictions: [...restrictions] } : {}),
        ...(variant.strengths != null ? { strengths: variant.strengths } : {}),
        ...(variant.sessionChain !== undefined
          ? { sessionChain: variant.sessionChain }
          : role.features?.sessionChain !== undefined
            ? { sessionChain: role.features.sessionChain }
            : {}),
      };
    }
  }
  return result;
}

/** Backward-compat alias — now registers all variants, not just defaults */
export function toFlatConfigs(config: AgentStudioConfig): Record<string, AgentConfig> {
  return toAllAgentConfigs(config);
}

/**
 * F032 P2 cleanup: Get all agent IDs from config (replaces hardcoded fallbacks).
 * Used by agent-voices.ts, agent-budgets.ts, TaskExtractor.ts.
 */
export function getAllAgentIdsFromConfig(): readonly string[] {
  try {
    const config = getCachedConfig();
    if (!config) return [];
    return Object.keys(toAllAgentConfigs(config));
  } catch {
    return []; // If config fails to load, return empty (caller decides fallback)
  }
}

/**
 * Find a role by checking mention patterns against text.
 * F32-b P4c: Uses longest-match-first to avoid prefix collisions
 * (e.g. `@架构sonnet` must match Sonnet variant, not role-level `@架构`).
 */
export function findRoleByMention(
  config: AgentStudioConfig,
  text: string,
): { role: AgentRole; agentId: AgentId } | undefined {
  const lower = text.toLowerCase();

  // Collect all patterns with their resolution targets
  const entries: { pattern: string; role: AgentRole; agentId: string }[] = [];
  for (const role of config.roles) {
    for (const pattern of role.mentionPatterns) {
      entries.push({ pattern: pattern.toLowerCase(), role, agentId: role.agentId });
    }
    for (const variant of role.variants) {
      if (variant.mentionPatterns) {
        const agentId = variant.agentId ?? role.agentId;
        for (const pattern of variant.mentionPatterns) {
          entries.push({ pattern: pattern.toLowerCase(), role, agentId });
        }
      }
    }
  }

  // Sort longest-first to prevent prefix collisions
  entries.sort((a, b) => b.pattern.length - a.pattern.length);

  for (const entry of entries) {
    if (lower.includes(entry.pattern)) {
      return { role: entry.role, agentId: createAgentId(entry.agentId) };
    }
  }
  return undefined;
}

// ── F24 Feature Toggle ──────────────────────────────────────────────

let _cachedConfig: AgentStudioConfig | null = null;
let _configLoadFailed = false;

function getCachedConfig(): AgentStudioConfig | null {
  if (_configLoadFailed) return null;
  if (!_cachedConfig) {
    try {
      _cachedConfig = loadAgentConfig();
    } catch (err) {
      _configLoadFailed = true;
      log.warn({ err }, 'Failed to load runtime catalog/template config, F24 toggle will default to enabled');
      return null;
    }
  }
  return _cachedConfig;
}

// ── F32-b: agentId → role index (for variant-aware feature lookups) ────

/**
 * Build an index mapping every agentId (including variant-level) to its parent role.
 * Used by isSessionChainEnabled() to correctly resolve features for variants.
 */
export function buildAgentIdToRoleIndex(config: AgentStudioConfig): Map<string, AgentRole> {
  const index = new Map<string, AgentRole>();
  for (const role of config.roles) {
    for (const variant of role.variants) {
      const agentId = variant.agentId ?? role.agentId;
      index.set(agentId, role);
    }
  }
  return index;
}

// Cache bound to config reference — rebuilt if different config is passed (e.g. tests)
let _agentIdToRole: Map<string, AgentRole> | null = null;
let _agentIdToRoleSource: AgentStudioConfig | null = null;

/**
 * Check if F24 session chain is enabled for a agent.
 * Returns true by default — only false when explicitly disabled in the resolved agent config.
 * Gracefully returns true if config file is unreadable (availability over strictness).
 *
 * F32-b: Now resolves variant agentIds to their parent role via index.
 * Design constraint: Agent Studio config is loaded once at startup, no hot-reload.
 *
 * @param agentId - The agent to check (e.g. 'opus', 'codex', 'opus-45')
 * @param config - Optional config override (for testing)
 */
export function isSessionChainEnabled(agentId: AgentId | string, config?: AgentStudioConfig): boolean {
  const cfg = config ?? getCachedConfig();
  if (!cfg) return true; // Config unreadable → default enabled (Cloud P1 fix)
  const id = agentId as string;
  for (const role of cfg.roles) {
    for (const variant of role.variants) {
      const resolvedAgentId = variant.agentId ?? role.agentId;
      if (resolvedAgentId !== id) continue;
      if (variant.sessionChain !== undefined) return variant.sessionChain;
      return role.features?.sessionChain !== false;
    }
  }
  return true; // Unknown agent → default enabled
}

// ── F33 Phase 2: Session Strategy from config ─────────────────────────

/**
 * Get session strategy config from the resolved agent config for a agent.
 * Returns undefined if not configured (caller falls back to code defaults).
 *
 * F33 Phase 2: Same lookup pattern as isSessionChainEnabled — agentId → role → features.
 */
export function getConfigSessionStrategy(
  agentId: string,
  config?: AgentStudioConfig,
): AgentFeatures['sessionStrategy'] | undefined {
  const cfg = config ?? getCachedConfig();
  if (!cfg) return undefined;

  if (!_agentIdToRole || _agentIdToRoleSource !== cfg) {
    _agentIdToRole = buildAgentIdToRoleIndex(cfg);
    _agentIdToRoleSource = cfg;
  }

  const role = _agentIdToRole.get(agentId);
  if (!role) return undefined;

  // features.sessionStrategy is Zod-validated at load time
  return role.features?.sessionStrategy;
}

/**
 * Get Mission Hub self-claim scope from the resolved agent config for a agent.
 * Defaults to 'disabled' when not configured.
 */
export function getMissionHubSelfClaimScope(agentId: string, config?: AgentStudioConfig): MissionHubSelfClaimScope {
  const cfg = config ?? getCachedConfig();
  if (!cfg) return DEFAULT_MISSION_HUB_SELF_CLAIM_SCOPE;

  if (!_agentIdToRole || _agentIdToRoleSource !== cfg) {
    _agentIdToRole = buildAgentIdToRoleIndex(cfg);
    _agentIdToRoleSource = cfg;
  }

  const role = _agentIdToRole.get(agentId);
  if (!role) return DEFAULT_MISSION_HUB_SELF_CLAIM_SCOPE;

  return role.features?.missionHub?.selfClaimScope ?? DEFAULT_MISSION_HUB_SELF_CLAIM_SCOPE;
}

// ── F32-b: Default agent resolution ─────────────────────────────────────

let _defaultAgentId: AgentId | null = null;
/** F154 AC-A4: Runtime override for default agent (set via Hub API, owner-gated). */
let _runtimeDefaultAgentId: AgentId | null = null;

function isKnownAvailableDefaultAgent(agentId: string): boolean {
  const config = getCachedConfig();
  if (!config) {
    const id = createAgentId(agentId);
    return agentRegistry.getAllIds().length === 0 || agentRegistry.has(id);
  }

  if (!_agentIdToRole || _agentIdToRoleSource !== config) {
    _agentIdToRole = buildAgentIdToRoleIndex(config);
    _agentIdToRoleSource = config;
  }

  return _agentIdToRole.has(agentId) && isAgentAvailable(agentId, config);
}

/**
 * Get the default agent ID.
 * Priority: runtime override (F154) → roles[0].defaultVariantId (F32-b R4).
 * Used as ultimate fallback in AgentRouter when no mentions/participants/preferredAgents.
 */
export function getDefaultAgentId(): AgentId {
  if (_runtimeDefaultAgentId) {
    if (isKnownAvailableDefaultAgent(_runtimeDefaultAgentId)) return _runtimeDefaultAgentId;
    log.warn({ agentId: _runtimeDefaultAgentId }, 'Runtime default agent is unavailable or unknown, falling back');
  }

  const envAgentId = process.env.DEFAULT_AGENT_ID?.trim();
  if (envAgentId) {
    const id = createAgentId(envAgentId);
    if (isKnownAvailableDefaultAgent(id)) return id;
    log.warn({ envAgentId }, 'DEFAULT_AGENT_ID references unavailable or unknown agent, falling back');
  }

  if (_defaultAgentId) return _defaultAgentId;

  const config = getCachedConfig();
  const firstRole = config?.roles[0];
  if (firstRole) {
    const defaultVariant = firstRole.variants.find((v) => v.id === firstRole.defaultVariantId);
    // variant has independent agentId → use it; otherwise inherit role's
    _defaultAgentId = createAgentId(defaultVariant?.agentId ?? firstRole.agentId);
    return _defaultAgentId;
  }

  // Ultimate fallback for zero-member bootstrap mode.
  return createAgentId('opus');
}

/** F154 AC-A4: Set runtime default agent override. Owner-gated at the API layer. */
export function setRuntimeDefaultAgentId(agentId: string): void {
  _runtimeDefaultAgentId = createAgentId(agentId);
}

/** F154 AC-A4: Clear runtime override — falls back to roles[0]. */
export function clearRuntimeDefaultAgentId(): void {
  _runtimeDefaultAgentId = null;
}

/** F154 AC-A4: Check whether a runtime override is active. */
export function hasRuntimeDefaultAgentOverride(): boolean {
  return _runtimeDefaultAgentId !== null && isKnownAvailableDefaultAgent(_runtimeDefaultAgentId);
}

/** Unified owner userId: configured env or single-user fallback. */
export function getOwnerUserId(): string {
  return process.env.DEFAULT_OWNER_USER_ID?.trim() || 'default-user';
}

// ── Variant CLI effort accessor ──────────────────────────────────────

/** agentId → variant index (lazy, rebuilt on config change) */
let _agentIdToVariant: Map<string, AgentVariant> | null = null;
let _agentIdToVariantSource: AgentStudioConfig | null = null;

function buildAgentIdToVariantIndex(config: AgentStudioConfig): Map<string, AgentVariant> {
  const index = new Map<string, AgentVariant>();
  for (const role of config.roles) {
    for (const variant of role.variants) {
      const agentId = variant.agentId ?? role.agentId;
      index.set(agentId, variant);
    }
  }
  return index;
}

/** Effort level union across all CLI providers */
export type CliEffortLevel = 'low' | 'medium' | 'high' | 'max' | 'xhigh';

/**
 * Get CLI effort level for a agent from the resolved agent config.
 * Default when not configured:
 *   claude (anthropic): 'max'
 *   codex (openai):     'xhigh'
 *   others:             'high'
 */
export function getAgentEffort(
  agentId: string,
  config?: AgentStudioConfig,
  fallbackProvider?: ClientId,
): CliEffortLevel {
  const cfg = config ?? getCachedConfig();
  if (!cfg) {
    const normalized = normalizeCliEffortForProvider(fallbackProvider ?? 'anthropic', undefined);
    return normalized ?? 'high';
  }

  if (!_agentIdToVariant || _agentIdToVariantSource !== cfg) {
    _agentIdToVariant = buildAgentIdToVariantIndex(cfg);
    _agentIdToVariantSource = cfg;
  }

  const variant = _agentIdToVariant.get(agentId);
  if (variant?.cli?.effort) {
    // Defense-in-depth: validate persisted effort against current provider.
    // Stale cross-provider values (e.g. 'max' on openai) are cleaned at write
    // time, but historical data may still contain them.
    const provider = variant.clientId ?? fallbackProvider;
    if (provider) {
      const validated = normalizeCliEffortForProvider(provider, variant.cli.effort);
      if (validated) return validated;
      // Invalid for this provider — fall through to provider default below
    } else {
      return variant.cli.effort;
    }
  }

  // Client-aware defaults: use variant's clientId if found, otherwise fallbackProvider
  const effectiveProvider = variant?.clientId ?? fallbackProvider;
  if (effectiveProvider) {
    const normalized = normalizeCliEffortForProvider(effectiveProvider, undefined);
    if (normalized) return normalized;
  }
  return 'high';
}

export interface AgentContextWindowConfig {
  contextWindow: number;
  autoCompactTokenLimit: number;
}

export function getAgentContextWindowConfig(agentId: string): AgentContextWindowConfig | undefined {
  const cfg = getCachedConfig();
  if (!cfg) return undefined;

  if (!_agentIdToVariant || _agentIdToVariantSource !== cfg) {
    _agentIdToVariant = buildAgentIdToVariantIndex(cfg);
    _agentIdToVariantSource = cfg;
  }

  const variant = _agentIdToVariant.get(agentId);
  if (!variant?.cli?.contextWindow) return undefined;
  return {
    contextWindow: variant.cli.contextWindow,
    autoCompactTokenLimit: variant.cli.autoCompactTokenLimit ?? Math.floor(variant.cli.contextWindow * 0.88),
  };
}

// ── F149: ACP config accessor (raw variant field, not in AgentConfig type) ──────

export interface AcpVariantConfig {
  command: string;
  startupArgs: string[];
  mcpWhitelist?: string[];
  supportsMultiplexing?: boolean;
  /** Phase C: optional pool config overrides */
  pool?: {
    maxLiveProcesses?: number;
    idleTtlMs?: number;
  };
}

/**
 * Get ACP config for a agent from the resolved raw runtime variant.
 * Returns undefined if the variant has no `acp` section (= use legacy CLI).
 * Reads raw JSON because `acp` is not in the typed AgentConfig (intentionally).
 */
export function getAcpConfig(agentId: string): AcpVariantConfig | undefined {
  try {
    const templatePath = process.env.AGENT_TEMPLATE_PATH ?? DEFAULT_AGENT_TEMPLATE_PATH;
    const raw = mergeTemplateWithCatalog(templatePath) ?? readTemplate(templatePath);
    const json = JSON.parse(raw) as {
      roles?: Array<{ agentId?: string; variants?: Array<{ agentId?: string; acp?: AcpVariantConfig }> }>;
    };
    for (const role of json.roles ?? []) {
      for (const variant of role.variants ?? []) {
        const resolvedAgentId = variant.agentId ?? role.agentId;
        if (resolvedAgentId === agentId && variant.acp) return variant.acp;
      }
    }
  } catch {
    // Config unreadable → no ACP config
  }
  return undefined;
}

/** Reset cached config (for testing) */
export function _resetCachedConfig(): void {
  _cachedConfig = null;
  _configLoadFailed = false;
  _agentIdToRole = null;
  _agentIdToRoleSource = null;
  _agentIdToVariant = null;
  _agentIdToVariantSource = null;
  _defaultAgentId = null;
  _cachedRoster = null;
  _cachedReviewPolicy = null;
  _cachedCoCreator = null;
}

// ── F032: Roster + ReviewPolicy accessors ──────────────────────────────

let _cachedRoster: Roster | null = null;
let _cachedReviewPolicy: ReviewPolicy | null = null;

/** Default review policy if not configured (v1 config) */
const DEFAULT_REVIEW_POLICY: ReviewPolicy = {
  requireDifferentFamily: true,
  preferActiveInThread: true,
  preferLead: true,
  excludeUnavailable: true,
};
const DEFAULT_MISSION_HUB_SELF_CLAIM_SCOPE: MissionHubSelfClaimScope = 'disabled';

/**
 * Get roster from config. Returns empty object for v1 configs.
 * F032: Used by reviewer matching to check roles, availability, family.
 */
export function getRoster(config?: AgentStudioConfig): Roster {
  if (_cachedRoster && !config) return _cachedRoster;

  const cfg = config ?? getCachedConfig();
  if (!cfg) return {};

  // v1 config has no roster
  if (cfg.version === 1) return {};

  // v2 config has roster — TypeScript narrows type after version check
  _cachedRoster = cfg.roster;
  return _cachedRoster;
}

/**
 * Get review policy from config. Returns defaults for v1 configs.
 * F032: Used by reviewer matching to determine matching strategy.
 */
export function getReviewPolicy(config?: AgentStudioConfig): ReviewPolicy {
  if (_cachedReviewPolicy && !config) return _cachedReviewPolicy;

  const cfg = config ?? getCachedConfig();
  if (!cfg) return DEFAULT_REVIEW_POLICY;

  // v1 config has no reviewPolicy → use defaults
  if (cfg.version === 1) return DEFAULT_REVIEW_POLICY;

  // v2 config has reviewPolicy — TypeScript narrows type after version check
  _cachedReviewPolicy = cfg.reviewPolicy;
  return _cachedReviewPolicy;
}

/**
 * Check if a agent is available (has quota).
 * F032: co-creator 40 美刀教训 — 没智能体粮的智能体不要找！
 */
export function isAgentAvailable(agentId: string, config?: AgentStudioConfig): boolean {
  const roster = getRoster(config);
  const entry = roster[agentId];
  // If not in roster, assume available (backward compat)
  return entry?.available !== false;
}

/**
 * Get a agent's family from roster.
 * F032: Used for "different family" rule in reviewer matching.
 */
export function getAgentFamily(agentId: string, config?: AgentStudioConfig): string | undefined {
  const roster = getRoster(config);
  return roster[agentId]?.family;
}

/**
 * Check if a agent has a specific role.
 * F032: Used to check if a agent can be a reviewer, architect, etc.
 */
export function agentHasRole(agentId: string, role: string, config?: AgentStudioConfig): boolean {
  const roster = getRoster(config);
  const entry = roster[agentId];
  return entry?.roles.includes(role) ?? false;
}

/**
 * Check if a agent is the lead of its family.
 * F032: Used for "prefer lead" rule in reviewer matching.
 */
export function isAgentLead(agentId: string, config?: AgentStudioConfig): boolean {
  const roster = getRoster(config);
  return roster[agentId]?.lead ?? false;
}

// ── F067: Co-Creator config accessor ────────────────────────────────

/** Default co-creator mention patterns (backward compat when not configured) */
const DEFAULT_CO_CREATOR_MENTION_PATTERNS = ['@co-creator', '@co-creator', '@co-creator', '@co-creator', '@co-creator'];

let _cachedCoCreator: CoCreatorConfig | null = null;

/**
 * Get coCreator config from the resolved agent config.
 * Returns a default config with @co-creator/@co-creator patterns when not configured.
 */
export function getCoCreatorConfig(config?: AgentStudioConfig): CoCreatorConfig {
  if (_cachedCoCreator && !config) return _cachedCoCreator;

  const cfg = config ?? getCachedConfig();

  // v1 config or no coCreator → return defaults
  if (!cfg || cfg.version === 1 || !cfg.coCreator) {
    return { name: 'co-creator', aliases: [], mentionPatterns: DEFAULT_CO_CREATOR_MENTION_PATTERNS };
  }

  _cachedCoCreator = cfg.coCreator;
  return _cachedCoCreator;
}

/**
 * Get all co-creator mention patterns (lowercased, with @ prefix).
 * Always includes @co-creator and @co-creator as fallback patterns in addition to configured ones.
 */
export function getCoCreatorMentionPatterns(config?: AgentStudioConfig): readonly string[] {
  const coCreator = getCoCreatorConfig(config);
  const patterns = new Set(coCreator.mentionPatterns.map((p: string) => p.toLowerCase()));
  // Always include legacy patterns for backward compat
  for (const p of DEFAULT_CO_CREATOR_MENTION_PATTERNS) patterns.add(p);
  return [...patterns];
}
