import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import type { AgentStudioConfig, ClientId, RosterEntry } from '@agent-studio/shared';
import { builtinAccountIdForClient, resolveBuiltinClientForProvider } from './account-resolver.js';

const CONFIG_SUBDIR = '.agent-studio';
const AGENT_CATALOG_FILENAME = 'agent-catalog.json';

function safePath(projectRoot: string, ...segments: string[]): string {
  const root = resolve(projectRoot);
  const normalized = resolve(root, ...segments);
  const rel = relative(root, normalized);
  if (rel.startsWith(`..${sep}`) || rel === '..') {
    throw new Error(`Path escapes project root: ${normalized}`);
  }
  return normalized;
}

function writeFileAtomic(filePath: string, content: string): void {
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, content, 'utf-8');
  try {
    renameSync(tempPath, filePath);
  } catch (error) {
    try {
      unlinkSync(tempPath);
    } catch {
      // Ignore cleanup failures.
    }
    throw error;
  }
}

/** baiyuxi-agent-studio#340 P5: ClientId values — used to detect old `provider` field holding a clientId. */
const CLIENT_ID_VALUES = new Set(['anthropic', 'openai', 'google', 'kimi', 'dare', 'antigravity', 'opencode', 'a2a']);

const SIMPLIFIED_ROLE_IDS = new Set(['architecture-development', 'code-review', 'frontend-visual', 'research-docs']);
const SIMPLIFIED_ROLE_ORDER = ['architecture-development', 'code-review', 'frontend-visual', 'research-docs'] as const;

const LEGACY_ROLE_TO_SIMPLIFIED_ROLE: Record<string, string> = {
  'lead-architect': 'architecture-development',
  'principal-architect': 'architecture-development',
  'runtime-engineer': 'architecture-development',
  'tooling-engineer': 'architecture-development',
  'opus-47': 'architecture-development',
  'code-reviewer': 'code-review',
  'frontend-designer': 'frontend-visual',
  'creative-frontend-designer': 'frontend-visual',
  'visual-qa': 'frontend-visual',
  moonshot: 'research-docs',
};

const LEGACY_AGENT_TO_SIMPLIFIED_ROLE: Record<string, string> = {
  opus: 'architecture-development',
  sonnet: 'architecture-development',
  'opus-45': 'architecture-development',
  'opus-47': 'architecture-development',
  'fable-5': 'architecture-development',
  dare: 'architecture-development',
  opencode: 'architecture-development',
  codex: 'code-review',
  gpt52: 'code-review',
  spark: 'code-review',
  gemini: 'frontend-visual',
  gemini25: 'frontend-visual',
  gemini35: 'frontend-visual',
  antigravity: 'frontend-visual',
  'antig-opus': 'frontend-visual',
  kimi: 'research-docs',
};

const SIMPLIFIED_ROLE_METADATA: Record<
  string,
  {
    agentId: string;
    name: string;
    nickname: string;
    avatar: string;
    color: { primary: string; secondary: string };
    mentionPatterns: string[];
    roleDescription: string;
    teamStrengths: string;
    defaultVariantId: string;
    defaultEvaluation: string;
    features?: Record<string, unknown>;
  }
> = {
  'architecture-development': {
    agentId: 'opus',
    name: 'Ethan（任务主控与实现）',
    nickname: 'Ethan',
    avatar: '/avatars/default.svg',
    color: { primary: '#2563EB', secondary: '#DBEAFE' },
    mentionPatterns: [
      '@ethan',
      '@opus',
      '@architect',
      '@lead-architect',
      '@dev',
      '@architecture-development',
      '@orchestrator',
      '@builder',
      '@task-lead',
      '@架构',
      '@开发',
      '@任务主控',
      '@实现',
      '@任务主控与实现',
    ],
    roleDescription: '任务主控与实现能力通道，负责拆解目标、选择工作流、组织上下文与工具调用、完成主要实现和集成验证。',
    teamStrengths: '任务拆解、工作流编排、核心实现、工具调用、集成验证',
    defaultVariantId: 'opus-default',
    defaultEvaluation: 'Ethan（任务主控与实现） 任务主控与实现 agent',
  },
  'code-review': {
    agentId: 'codex',
    name: 'Owen（验证与审查）',
    nickname: 'Owen',
    avatar: '/avatars/default.svg',
    color: { primary: '#0F766E', secondary: '#D9F4EF' },
    mentionPatterns: [
      '@owen',
      '@codex',
      '@reviewer',
      '@code-reviewer',
      '@code-review',
      '@evaluator',
      '@gatekeeper',
      '@validation',
      '@审查',
      '@验证',
      '@验证与审查',
    ],
    roleDescription: '验证与审查能力通道，负责评估输出质量、代码风险、安全边界、测试缺口、回归风险和发布前检查。',
    teamStrengths: '输出评估、代码审查、安全分析、测试策略、回归风险定位、发布前检查',
    defaultVariantId: 'codex-default',
    defaultEvaluation: 'Owen（验证与审查） 验证与审查 agent',
    features: { missionHub: { selfClaimScope: 'disabled' } },
  },
  'frontend-visual': {
    agentId: 'gemini',
    name: 'Andy（界面与视觉）',
    nickname: 'Andy',
    avatar: '/avatars/default.svg',
    color: { primary: '#0EA5A8', secondary: '#DDF7FA' },
    mentionPatterns: [
      '@andy',
      '@gemini',
      '@frontend',
      '@frontend-designer',
      '@designer',
      '@ui',
      '@visual',
      '@frontend-visual',
      '@interface',
      '@surface',
      '@browser-qa',
      '@前端',
      '@视觉',
      '@界面',
      '@界面与视觉',
    ],
    roleDescription: '界面与视觉能力通道，负责 UI/UX、交互状态、视觉层级、截图证据、移动端适配和浏览器验证。',
    teamStrengths: '界面设计、视觉风格、交互体验、可用性、截图与浏览器验证',
    defaultVariantId: 'gemini-default',
    defaultEvaluation: 'Andy（界面与视觉） 界面与视觉 agent',
    features: { sessionChain: true },
  },
  'research-docs': {
    agentId: 'kimi',
    name: 'Nora（研究与上下文）',
    nickname: 'Nora',
    avatar: '/avatars/default.svg',
    color: { primary: '#7C3AED', secondary: '#EDE9FE' },
    mentionPatterns: [
      '@nora',
      '@kimi',
      '@moonshot',
      '@research',
      '@analyst',
      '@docs',
      '@research-docs',
      '@context',
      '@research-context',
      '@研究',
      '@文档',
      '@上下文',
      '@研究与上下文',
    ],
    roleDescription: '研究与上下文能力通道，负责资料检索、事实核验、长上下文总结、竞品观察、方案素材和结构化输入。',
    teamStrengths: '资料检索、事实核验、长文总结、趋势分析、方案素材、上下文整理',
    defaultVariantId: 'kimi-default',
    defaultEvaluation: 'Nora（研究与上下文） 研究与上下文 agent',
  },
};

const PRIMARY_SIMPLIFIED_SOURCE_ROLE: Record<string, string> = {
  'architecture-development': 'lead-architect',
  'code-review': 'code-reviewer',
  'frontend-visual': 'frontend-designer',
  'research-docs': 'moonshot',
};

const SIMPLIFIED_LEAD_AGENT_IDS = new Set(['opus', 'codex', 'gemini', 'kimi']);

const SIMPLIFIED_DEFAULT_ROSTER_ROLES: Record<string, string[]> = {
  opus: ['orchestrator', 'builder', 'peer-reviewer'],
  codex: ['evaluator', 'peer-reviewer', 'security'],
  gemini: ['interface', 'visual', 'browser-qa'],
  kimi: ['research', 'context'],
};

const LEGACY_SIMPLIFIED_EVALUATION_RE = /架构与开发|代码审查|前端与视觉|研究与文档|架构开发|前端视觉|研究文档/;

function resolveSimplifiedRosterEvaluation(existing: unknown, fallback: string): string {
  if (typeof existing !== 'string' || existing.trim().length === 0) return fallback;
  return LEGACY_SIMPLIFIED_EVALUATION_RE.test(existing) ? fallback : existing;
}

function shouldMigrateToSimplifiedRoles(
  catalog: AgentStudioConfig,
  externalStandaloneRoleIds?: ReadonlySet<string>,
): boolean {
  if (externalStandaloneRoleIds && [...SIMPLIFIED_ROLE_IDS].some((roleId) => externalStandaloneRoleIds.has(roleId))) {
    return true;
  }
  return (catalog.roles as unknown as Array<{ id?: unknown }>).some((role) => {
    return typeof role.id === 'string' && SIMPLIFIED_ROLE_IDS.has(role.id);
  });
}

function resolveVariantAgentId(role: Record<string, unknown>, variant: Record<string, unknown>): string | undefined {
  return typeof variant.agentId === 'string'
    ? variant.agentId
    : typeof role.agentId === 'string'
      ? role.agentId
      : undefined;
}

function resolveSimplifiedRoleId(role: Record<string, unknown>): string | undefined {
  const roleId = typeof role.id === 'string' ? role.id : undefined;
  if (roleId && SIMPLIFIED_ROLE_IDS.has(roleId)) return roleId;
  if (roleId && LEGACY_ROLE_TO_SIMPLIFIED_ROLE[roleId]) return LEGACY_ROLE_TO_SIMPLIFIED_ROLE[roleId];

  const agentId = typeof role.agentId === 'string' ? role.agentId : undefined;
  if (agentId && LEGACY_AGENT_TO_SIMPLIFIED_ROLE[agentId]) return LEGACY_AGENT_TO_SIMPLIFIED_ROLE[agentId];
  return undefined;
}

function normalizeSimplifiedVariant(
  sourceRole: Record<string, unknown>,
  sourceVariant: Record<string, unknown>,
  targetRoleId: string,
): Record<string, unknown> {
  const meta = SIMPLIFIED_ROLE_METADATA[targetRoleId];
  const variant = structuredClone(sourceVariant);
  variant.id = meta.defaultVariantId;
  variant.displayName = meta.name;
  delete variant.agentId;
  delete variant.variantLabel;
  delete variant.mentionPatterns;
  delete variant.avatar;
  delete variant.color;

  if (variant.caution === undefined && sourceRole.caution !== undefined) {
    variant.caution = sourceRole.caution;
  }
  if (variant.restrictions === undefined && Array.isArray(sourceRole.restrictions)) {
    variant.restrictions = [...sourceRole.restrictions];
  }
  const features = sourceRole.features as { sessionChain?: unknown } | undefined;
  if (variant.sessionChain === undefined && typeof features?.sessionChain === 'boolean') {
    variant.sessionChain = features.sessionChain;
  }
  return variant;
}

function resolveSimplifiedVariantTargetRoleId(
  role: Record<string, unknown>,
  variant: Record<string, unknown>,
): string | undefined {
  const agentId = resolveVariantAgentId(role, variant);
  if (agentId && LEGACY_AGENT_TO_SIMPLIFIED_ROLE[agentId]) return LEGACY_AGENT_TO_SIMPLIFIED_ROLE[agentId];
  return resolveSimplifiedRoleId(role);
}

function scoreSimplifiedVariantCandidate(
  sourceRole: Record<string, unknown>,
  sourceVariant: Record<string, unknown>,
  targetRoleId: string,
  order: number,
): number {
  const meta = SIMPLIFIED_ROLE_METADATA[targetRoleId];
  const sourceRoleId = typeof sourceRole.id === 'string' ? sourceRole.id : undefined;
  const sourceAgentId = resolveVariantAgentId(sourceRole, sourceVariant);
  const sourceVariantId = typeof sourceVariant.id === 'string' ? sourceVariant.id : undefined;
  const sourceDefaultVariantId =
    typeof sourceRole.defaultVariantId === 'string' ? sourceRole.defaultVariantId : undefined;

  let score = 0;
  if (sourceRoleId === targetRoleId) score += 1000;
  if (sourceAgentId === meta.agentId) score += 500;
  if (sourceVariantId === meta.defaultVariantId) score += 200;
  if (sourceRoleId === PRIMARY_SIMPLIFIED_SOURCE_ROLE[targetRoleId]) score += 100;
  if (sourceVariantId && sourceVariantId === sourceDefaultVariantId) score += 20;
  return score * 10000 - order;
}

function createSimplifiedRole(targetRoleId: string): Record<string, unknown> {
  const meta = SIMPLIFIED_ROLE_METADATA[targetRoleId];
  if (!meta) throw new Error(`Unknown simplified role: ${targetRoleId}`);
  return {
    id: targetRoleId,
    agentId: meta.agentId,
    name: meta.name,
    displayName: meta.name,
    nickname: meta.nickname,
    avatar: meta.avatar,
    color: meta.color,
    mentionPatterns: meta.mentionPatterns,
    roleDescription: meta.roleDescription,
    teamStrengths: meta.teamStrengths,
    caution: null,
    defaultVariantId: meta.defaultVariantId,
    ...(meta.features ? { features: meta.features } : {}),
    variants: [],
  };
}

function migrateCatalogRoleFamilies(
  catalog: AgentStudioConfig,
  externalStandaloneRoleIds?: ReadonlySet<string>,
): { catalog: AgentStudioConfig; dirty: boolean } {
  if (!shouldMigrateToSimplifiedRoles(catalog, externalStandaloneRoleIds)) {
    return { catalog, dirty: false };
  }

  const before = JSON.stringify(catalog);
  const next = structuredClone(catalog) as AgentStudioConfig;
  const candidateByRole = new Map<
    string,
    { role: Record<string, unknown>; variant: Record<string, unknown>; score: number }
  >();
  let candidateOrder = 0;

  for (const role of next.roles as unknown as Record<string, unknown>[]) {
    const variants = Array.isArray(role.variants) ? (role.variants as Record<string, unknown>[]) : [];
    for (const variant of variants) {
      const targetRoleId = resolveSimplifiedVariantTargetRoleId(role, variant);
      if (!targetRoleId) continue;
      const score = scoreSimplifiedVariantCandidate(role, variant, targetRoleId, candidateOrder++);
      const existing = candidateByRole.get(targetRoleId);
      if (!existing || score > existing.score) {
        candidateByRole.set(targetRoleId, { role, variant, score });
      }
    }
  }

  const orderedRoles: Record<string, unknown>[] = [];
  for (const targetRoleId of SIMPLIFIED_ROLE_ORDER) {
    const candidate = candidateByRole.get(targetRoleId);
    if (!candidate) continue;
    const targetRole = createSimplifiedRole(targetRoleId);
    targetRole.variants = [normalizeSimplifiedVariant(candidate.role, candidate.variant, targetRoleId)];
    orderedRoles.push(targetRole);
  }

  const writableNext = next as unknown as {
    roles: AgentStudioConfig['roles'];
    roster?: Record<string, RosterEntry>;
  };
  writableNext.roles = orderedRoles as unknown as AgentStudioConfig['roles'];

  if ('roster' in writableNext) {
    const previousRoster = { ...(writableNext.roster as Record<string, RosterEntry>) };
    const roster: Record<string, RosterEntry> = {};

    if (previousRoster[OWNER_ROSTER_KEY]) {
      roster[OWNER_ROSTER_KEY] = previousRoster[OWNER_ROSTER_KEY];
    }

    for (const role of orderedRoles) {
      const family = typeof role.id === 'string' ? role.id : undefined;
      if (!family) continue;
      const meta = SIMPLIFIED_ROLE_METADATA[family];
      const agentId = meta.agentId;
      const existing = previousRoster[agentId];
      roster[agentId] = {
        family,
        roles:
          existing?.roles && existing.roles.length > 0
            ? existing.roles
            : (SIMPLIFIED_DEFAULT_ROSTER_ROLES[agentId] ?? ['assistant']),
        lead: SIMPLIFIED_LEAD_AGENT_IDS.has(agentId),
        available: existing?.available ?? true,
        evaluation: resolveSimplifiedRosterEvaluation(existing?.evaluation, meta.defaultEvaluation),
      };
    }
    writableNext.roster = roster;
  }

  return { catalog: next, dirty: JSON.stringify(next) !== before };
}

/**
 * baiyuxi-agent-studio#340: One-time catalog variant migration — rewrites file on disk then never runs again.
 *   1. old `provider` (clientId value) → `clientId` (P5 field rename)
 *   2. old `ocProviderName` → `provider` (P5 field rename)
 *   3. old `providerProfileId` → `accountRef` (P5 field rename)
 *   4. drop legacy variants whose agentId is now a standalone top-level role
 *      (e.g. `lead-architect.variants[opus-47]` after opus-47 was promoted to its own role) —
 *      otherwise toAllAgentConfigs throws Duplicate agentId on startup.
 *
 * `externalStandaloneRoleIds` lets the caller surface role.ids from the template
 * even when the runtime catalog hasn't picked them up yet — without it, a legacy
 * catalog merged with a new-shape template still trips the duplicate-agentId crash.
 *
 * Bootstrap creates an empty catalog; template roles are used as a menu when adding members.
 */
function migrateCatalogVariants(
  catalog: AgentStudioConfig,
  externalStandaloneRoleIds?: ReadonlySet<string>,
  externalRoleIdByAgentId?: ReadonlyMap<string, string>,
): { catalog: AgentStudioConfig; dirty: boolean } {
  let dirty = false;
  const next = structuredClone(catalog) as AgentStudioConfig;

  // Step 4 prep: union the catalog's own role ids with any external ones (template)
  // so legacy variants are dropped even when the catalog itself hasn't grown the new role yet.
  const standaloneRoleIds = new Set<string>(externalStandaloneRoleIds ?? []);
  for (const role of next.roles as unknown as Record<string, unknown>[]) {
    if (typeof role.id === 'string') standaloneRoleIds.add(role.id);
  }

  const usedRoleIds = new Set<string>();
  for (const role of next.roles as unknown as Record<string, unknown>[]) {
    const roleId = typeof role.id === 'string' ? role.id : undefined;
    if (!roleId) continue;
    if (!usedRoleIds.has(roleId)) {
      usedRoleIds.add(roleId);
      continue;
    }

    const agentId = typeof role.agentId === 'string' ? role.agentId : undefined;
    const preferredRoleId = agentId ? externalRoleIdByAgentId?.get(agentId) : undefined;
    const fallbackBase =
      preferredRoleId && !usedRoleIds.has(preferredRoleId)
        ? preferredRoleId
        : agentId && !usedRoleIds.has(agentId)
          ? agentId
          : roleId;
    let candidate = fallbackBase;
    let suffix = 2;
    while (usedRoleIds.has(candidate)) {
      candidate = `${fallbackBase}-${suffix++}`;
    }
    role.id = candidate;
    usedRoleIds.add(candidate);
    dirty = true;
  }

  const roleFamilyMigration = migrateCatalogRoleFamilies(next, externalStandaloneRoleIds);
  if (roleFamilyMigration.dirty) {
    dirty = true;
  }
  const migratedNext = roleFamilyMigration.catalog;

  for (const role of migratedNext.roles as unknown as Record<string, unknown>[]) {
    const variants = Array.isArray(role.variants) ? (role.variants as Record<string, unknown>[]) : [];
    for (const variant of variants) {
      // P5 step 1: old `provider` holding a ClientId value → `clientId`
      if (typeof variant.provider === 'string' && CLIENT_ID_VALUES.has(variant.provider)) {
        if (!variant.clientId) {
          variant.clientId = variant.provider;
          delete variant.provider;
          dirty = true;
        } else if (variant.clientId === variant.provider) {
          // Redundant provider (same as clientId). Only delete if ocProviderName
          // needs to take its place; otherwise keep it so template merge can't
          // leak a stale provider from the base config.
          if (typeof variant.ocProviderName === 'string') {
            delete variant.provider;
            dirty = true;
          }
        }
      }

      // P5 step 2: old `ocProviderName` → `provider`
      if (typeof variant.ocProviderName === 'string' && variant.provider === undefined) {
        variant.provider = variant.ocProviderName;
        delete variant.ocProviderName;
        dirty = true;
      }

      const client = resolveBuiltinClientForProvider((variant.clientId ?? variant.provider) as ClientId);
      if (!client) continue;

      const existingAccountRef = typeof variant.accountRef === 'string' ? variant.accountRef.trim() : '';
      const legacyProfileId = typeof variant.providerProfileId === 'string' ? variant.providerProfileId.trim() : '';

      // P5 step 3: providerProfileId → accountRef
      if (legacyProfileId && !existingAccountRef) {
        variant.accountRef = legacyProfileId;
        delete variant.providerProfileId;
        dirty = true;
        continue;
      }
      if (legacyProfileId) {
        delete variant.providerProfileId;
        dirty = true;
      }

      // baiyuxi-agent-studio#340: Do NOT backfill accountRef for unbound runtime variants.
      // Runtime catalog entries are authoritative; missing accountRef stays missing
      // until the user explicitly binds one in the editor.
    }
  }

  // Step 4: drop legacy variants whose agentId now belongs to a standalone top-level role.
  // Triggered when a agent (e.g. opus-47) was previously a sub-variant of another role
  // (lead-architect) and later got promoted to its own role. Without this normalization,
  // toAllAgentConfigs() throws Duplicate agentId at startup once both forms coexist.
  for (const role of migratedNext.roles as unknown as Record<string, unknown>[]) {
    const roleId = typeof role.id === 'string' ? role.id : undefined;
    const roleDefaultAgentId = typeof role.agentId === 'string' ? role.agentId : undefined;
    const variants = Array.isArray(role.variants) ? (role.variants as Record<string, unknown>[]) : [];
    if (variants.length === 0) continue;
    const filtered = variants.filter((variant) => {
      const variantAgentId = (typeof variant.agentId === 'string' ? variant.agentId : undefined) ?? roleDefaultAgentId;
      if (!variantAgentId) return true;
      // Keep variants whose agentId matches their own role's id (legitimate single-variant role).
      if (variantAgentId === roleId) return true;
      // Drop only when agentId points to a *different* standalone top-level role.
      return !standaloneRoleIds.has(variantAgentId);
    });
    if (filtered.length !== variants.length) {
      role.variants = filtered;
      dirty = true;
    }
  }

  return { catalog: migratedNext, dirty };
}

/** One-time migration: strip legacy `source` field from variants. Idempotent.
 *  Template and runtime catalog are independent data sources — source field is obsolete. */
function stripLegacySourceField(catalogPath: string): void {
  let raw: string;
  try {
    raw = readFileSync(catalogPath, 'utf-8');
  } catch {
    return;
  }
  const catalog = JSON.parse(raw) as AgentStudioConfig;
  const next = structuredClone(catalog) as AgentStudioConfig;
  let dirty = false;
  for (const role of next.roles as unknown as Record<string, unknown>[]) {
    const variants = Array.isArray(role.variants) ? (role.variants as Record<string, unknown>[]) : [];
    for (const variant of variants) {
      if ('source' in variant) {
        delete variant.source;
        dirty = true;
      }
    }
  }
  if (!dirty) return;
  writeFileAtomic(catalogPath, `${JSON.stringify(next, null, 2)}\n`);
}

const OWNER_ROSTER_KEY = 'owner';

function buildOwnerRosterEntry(): RosterEntry {
  return {
    family: 'owner',
    roles: ['owner'],
    lead: false,
    available: true,
    evaluation: 'co-creator / 大当家',
  };
}

function createEmptyRuntimeCatalog(template: AgentStudioConfig): AgentStudioConfig {
  const ownerEntry = buildOwnerRosterEntry();
  if ('roster' in template) {
    return {
      ...template,
      roles: [],
      roster: { [OWNER_ROSTER_KEY]: ownerEntry },
    };
  }
  return {
    ...template,
    roles: [],
  };
}

/** Ensure the owner entry exists in an existing catalog. Returns true if backfilled. */
function ensureOwnerInRoster(catalogPath: string): boolean {
  let raw: string;
  try {
    raw = readFileSync(catalogPath, 'utf-8');
  } catch {
    return false;
  }
  const catalog = JSON.parse(raw) as AgentStudioConfig;
  if (!('roster' in catalog)) return false;
  const roster = catalog.roster as Record<string, unknown>;
  if (roster[OWNER_ROSTER_KEY]) return false;
  roster[OWNER_ROSTER_KEY] = buildOwnerRosterEntry();
  writeFileAtomic(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
  return true;
}

export function resolveAgentCatalogPath(projectRoot: string): string {
  return safePath(projectRoot, CONFIG_SUBDIR, AGENT_CATALOG_FILENAME);
}

/**
 * Best-effort read of role.id values from a sibling agent-template.json.
 * Returns an empty set if the template is missing or unreadable — migration
 * still works against catalog-only ids in that case.
 */
function readTemplateRoleMetadata(projectRoot: string): {
  roleIds: Set<string>;
  roleIdByAgentId: Map<string, string>;
} {
  const roleIds = new Set<string>();
  const roleIdByAgentId = new Map<string, string>();
  let templateRaw: string;
  try {
    templateRaw = readFileSync(safePath(projectRoot, 'agent-template.json'), 'utf-8');
  } catch {
    return { roleIds, roleIdByAgentId };
  }
  try {
    const json = JSON.parse(templateRaw) as { roles?: Array<{ id?: unknown; agentId?: unknown }> };
    for (const role of json.roles ?? []) {
      if (typeof role.id !== 'string') continue;
      roleIds.add(role.id);
      if (typeof role.agentId === 'string' && !roleIdByAgentId.has(role.agentId)) {
        roleIdByAgentId.set(role.agentId, role.id);
      }
    }
  } catch {
    // Malformed template — treat as no external ids.
  }
  return { roleIds, roleIdByAgentId };
}

export function readAgentCatalogRaw(projectRoot: string): string | null {
  const catalogPath = resolveAgentCatalogPath(projectRoot);
  if (!existsSync(catalogPath)) return null;
  const raw = readFileSync(catalogPath, 'utf-8');
  try {
    const parsed = JSON.parse(raw) as AgentStudioConfig;
    // Hand the migration template role.ids so it can detect legacy variants
    // that were promoted to standalone roles in template but not yet here.
    const templateRoleMetadata = readTemplateRoleMetadata(projectRoot);
    const migrated = migrateCatalogVariants(parsed, templateRoleMetadata.roleIds, templateRoleMetadata.roleIdByAgentId);
    if (migrated.dirty) {
      const nextRaw = `${JSON.stringify(migrated.catalog, null, 2)}\n`;
      writeFileAtomic(catalogPath, nextRaw);
      return nextRaw;
    }
  } catch {
    // Leave invalid JSON handling to the loader so callers see the original parse error.
  }
  return raw;
}

export function readAgentCatalog(projectRoot: string): AgentStudioConfig | null {
  const raw = readAgentCatalogRaw(projectRoot);
  if (raw === null) return null;
  return JSON.parse(raw) as AgentStudioConfig;
}

function readBootstrapSourceConfig(templatePath: string): { catalog: AgentStudioConfig; sourcePath: string } {
  return {
    catalog: JSON.parse(readFileSync(templatePath, 'utf-8')) as AgentStudioConfig,
    sourcePath: templatePath,
  };
}

export function bootstrapAgentCatalog(projectRoot: string, templatePath: string): string {
  const catalogPath = resolveAgentCatalogPath(projectRoot);
  if (existsSync(catalogPath)) {
    readAgentCatalogRaw(projectRoot);
    // Strip legacy source field from variants (obsolete after F171).
    stripLegacySourceField(catalogPath);
    // Ensure owner is always present in roster.
    ensureOwnerInRoster(catalogPath);
    return catalogPath;
  }

  const { catalog: template } = readBootstrapSourceConfig(templatePath);
  const { catalog: migratedCatalog } = migrateCatalogVariants(template);

  // Always start empty — first-run wizard guides users to add their first agent.
  // Template roles are used as a menu when adding members, not seeded on startup.
  const runtimeCatalog = createEmptyRuntimeCatalog(migratedCatalog);

  mkdirSync(dirname(catalogPath), { recursive: true });
  writeFileAtomic(catalogPath, `${JSON.stringify(runtimeCatalog, null, 2)}\n`);
  return catalogPath;
}

export function writeAgentCatalog(projectRoot: string, catalog: AgentStudioConfig): string {
  const catalogPath = resolveAgentCatalogPath(projectRoot);
  mkdirSync(dirname(catalogPath), { recursive: true });
  writeFileAtomic(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
  return catalogPath;
}
