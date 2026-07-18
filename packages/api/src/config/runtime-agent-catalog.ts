import { mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  AgentColor,
  AgentRole,
  AgentStudioConfig,
  AgentVariant,
  CliConfig,
  ClientId,
  CoCreatorConfig,
  ContextBudget,
  VoiceConfig,
} from '@agent-studio/shared';
import { createAgentId } from '@agent-studio/shared';
import { clearBudgetCache } from './agent-budgets.js';
import { bootstrapAgentCatalog, readAgentCatalog, resolveAgentCatalogPath } from './agent-catalog-store.js';
import { _resetCachedConfig, loadAgentConfig, toAllAgentConfigs } from './agent-config-loader.js';
import { clearVoiceCache } from './agent-voices.js';
import { resolveProjectTemplatePath } from './project-template-path.js';

export interface RuntimeAgentInput {
  agentId: string;
  roleId?: string;
  name: string;
  displayName: string;
  variantLabel?: string;
  nickname?: string;
  avatar: string;
  color: AgentColor;
  mentionPatterns: string[];
  accountRef?: string;
  roleDescription: string;
  personality?: string;
  teamStrengths?: string;
  caution?: string | null;
  strengths?: string[];
  sessionChain?: boolean;
  clientId: ClientId;
  defaultModel: string;
  mcpSupport: boolean;
  cli: CliConfig;
  commandArgs?: string[];
  cliConfigArgs?: string[];
  contextBudget?: ContextBudget;
  voiceConfig?: VoiceConfig;
  /** baiyuxi-agent-studio#340 P5: Model provider name (renamed from ocProviderName). */
  provider?: string;
}

export interface RuntimeAgentUpdate {
  name?: string;
  displayName?: string;
  variantLabel?: string | null;
  nickname?: string;
  avatar?: string;
  color?: AgentColor;
  mentionPatterns?: string[];
  accountRef?: string | null;
  roleDescription?: string;
  personality?: string;
  teamStrengths?: string;
  caution?: string | null;
  strengths?: string[];
  sessionChain?: boolean;
  clientId?: ClientId;
  defaultModel?: string;
  mcpSupport?: boolean;
  cli?: CliConfig;
  commandArgs?: string[];
  cliConfigArgs?: string[];
  contextBudget?: ContextBudget | null;
  voiceConfig?: VoiceConfig | null;
  /** baiyuxi-agent-studio#340 P5: Model provider name (renamed from ocProviderName). */
  provider?: string | null;
  available?: boolean;
}

export interface RuntimeCoCreatorUpdate {
  name?: string;
  aliases?: string[];
  mentionPatterns?: string[];
  timeZone?: string;
  avatar?: string | null;
  color?: AgentColor | null;
}

interface RoleVariantLocation {
  roleIndex: number;
  variantIndex: number;
  role: AgentRole;
  variant: AgentVariant;
  resolvedAgentId: string;
  isDefaultVariant: boolean;
}

function normalizeMentionPatterns(_agentId: string, mentionPatterns: readonly string[]): string[] {
  const values = mentionPatterns
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0)
    .map((pattern) => (pattern.startsWith('@') ? pattern : `@${pattern}`));
  return Array.from(new Set(values));
}

function normalizeCoCreatorMentionPatterns(mentionPatterns: readonly string[]): string[] {
  const values = mentionPatterns
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0)
    .map((pattern) => (pattern.startsWith('@') ? pattern : `@${pattern}`));
  return Array.from(new Set(values));
}

function readOrBootstrapCatalog(projectRoot: string): AgentStudioConfig {
  const templatePath = resolveProjectTemplatePath(projectRoot);
  bootstrapAgentCatalog(projectRoot, templatePath);
  const catalog = readAgentCatalog(projectRoot);
  if (!catalog) {
    throw new Error(`Runtime agent catalog missing at ${projectRoot}`);
  }
  return catalog;
}

function invalidateRuntimeCatalogCaches(): void {
  _resetCachedConfig();
  clearBudgetCache();
  clearVoiceCache();
}

function validatePersistedCatalog(projectRoot: string): AgentStudioConfig {
  invalidateRuntimeCatalogCaches();
  return loadAgentConfig(join(projectRoot, '.agent-studio', 'agent-catalog.json'));
}

function assertUniqueMentionAliases(catalog: AgentStudioConfig): void {
  const aliasHolders = new Map<string, string>();
  for (const [agentId, config] of Object.entries(toAllAgentConfigs(catalog))) {
    for (const mentionPattern of config.mentionPatterns) {
      const trimmed = mentionPattern.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      const holder = aliasHolders.get(key);
      if (holder && holder !== agentId) {
        throw new Error(`mention alias "${trimmed}" is already used by agent "${holder}"`);
      }
      aliasHolders.set(key, agentId);
    }
  }

  const coCreatorMentionPatterns = catalog.version === 2 ? (catalog.coCreator?.mentionPatterns ?? []) : [];
  for (const mentionPattern of coCreatorMentionPatterns) {
    const trimmed = mentionPattern.trim();
    if (!trimmed) continue;
    const holder = aliasHolders.get(trimmed.toLowerCase());
    if (holder) {
      throw new Error(`co-creator mention alias "${trimmed}" conflicts with agent "${holder}"`);
    }
  }
}

function writeAndValidateCatalog(projectRoot: string, catalog: unknown): AgentStudioConfig {
  const candidate = catalog as AgentStudioConfig;
  assertUniqueMentionAliases(candidate);
  const catalogPath = resolveAgentCatalogPath(projectRoot);
  const tempPath = `${catalogPath}.tmp-${process.pid}-${Date.now()}`;
  mkdirSync(dirname(catalogPath), { recursive: true });
  writeFileSync(tempPath, `${JSON.stringify(candidate, null, 2)}\n`, 'utf-8');
  try {
    loadAgentConfig(tempPath);
    renameSync(tempPath, catalogPath);
  } catch (err) {
    try {
      unlinkSync(tempPath);
    } catch {
      // best-effort cleanup
    }
    throw err;
  }
  return validatePersistedCatalog(projectRoot);
}

function findRoleVariant(catalog: AgentStudioConfig, agentId: string): RoleVariantLocation | null {
  for (const [roleIndex, role] of catalog.roles.entries()) {
    for (const [variantIndex, variant] of role.variants.entries()) {
      const resolvedAgentId = variant.agentId ?? role.agentId;
      if (resolvedAgentId !== agentId) continue;
      return {
        roleIndex,
        variantIndex,
        role,
        variant,
        resolvedAgentId,
        isDefaultVariant: variant.id === role.defaultVariantId,
      };
    }
  }
  return null;
}

function createRoleFromInput(input: RuntimeAgentInput): AgentRole {
  const variantId = `${input.agentId}-default`;
  return {
    id: input.roleId?.trim() || input.agentId,
    agentId: createAgentId(input.agentId),
    name: input.name,
    displayName: input.displayName,
    ...(input.nickname != null && input.nickname.trim().length > 0 ? { nickname: input.nickname.trim() } : {}),
    avatar: input.avatar,
    color: input.color,
    mentionPatterns: normalizeMentionPatterns(input.agentId, input.mentionPatterns),
    roleDescription: input.roleDescription,
    defaultVariantId: variantId,
    ...(input.sessionChain !== undefined ? { features: { sessionChain: input.sessionChain } } : {}),
    variants: [
      {
        id: variantId,
        clientId: input.clientId,
        ...(input.variantLabel != null && input.variantLabel.trim().length > 0
          ? { variantLabel: input.variantLabel.trim() }
          : {}),
        defaultModel: input.defaultModel,
        mcpSupport: input.mcpSupport,
        cli: input.cli,
        ...(input.accountRef != null && input.accountRef.trim().length > 0
          ? { accountRef: input.accountRef.trim() }
          : {}),
        ...(input.commandArgs && input.commandArgs.length > 0 ? { commandArgs: input.commandArgs } : {}),
        ...(input.cliConfigArgs && input.cliConfigArgs.length > 0 ? { cliConfigArgs: input.cliConfigArgs } : {}),
        ...(input.provider ? { provider: input.provider } : {}),
        ...(input.contextBudget ? { contextBudget: input.contextBudget } : {}),
        ...(input.voiceConfig !== undefined ? { voiceConfig: input.voiceConfig } : {}),
        ...(input.personality != null && input.personality.trim().length > 0 ? { personality: input.personality } : {}),
        ...(input.teamStrengths != null && input.teamStrengths.trim().length > 0
          ? { teamStrengths: input.teamStrengths.trim() }
          : {}),
        ...(input.caution !== undefined
          ? { caution: input.caution && input.caution.trim().length > 0 ? input.caution.trim() : null }
          : {}),
        ...(input.strengths ? { strengths: input.strengths } : {}),
      },
    ],
  } as unknown as AgentRole;
}

function cloneCatalog(catalog: AgentStudioConfig): Record<string, any> {
  return structuredClone(catalog) as Record<string, any>;
}

function buildDefaultRuntimeRosterEntry(
  agentId: string,
  family: string,
  displayName: string,
  available: boolean,
): { family: string; roles: string[]; lead: false; available: boolean; evaluation: string } {
  return {
    family,
    roles: ['assistant'],
    lead: false,
    available,
    evaluation: `${displayName} runtime member`,
  };
}

export function readRuntimeAgentCatalog(projectRoot: string): AgentStudioConfig {
  return readOrBootstrapCatalog(projectRoot);
}

export function createRuntimeAgent(projectRoot: string, input: RuntimeAgentInput): AgentStudioConfig {
  const catalog = cloneCatalog(readOrBootstrapCatalog(projectRoot));
  if (findRoleVariant(catalog as unknown as AgentStudioConfig, input.agentId)) {
    throw new Error(`Agent "${input.agentId}" already exists in runtime catalog`);
  }
  const nextRole = createRoleFromInput(input) as unknown as Record<string, any>;
  catalog.roles = [...catalog.roles, nextRole];
  if (catalog.version === 2) {
    catalog.roster = {
      ...catalog.roster,
      [input.agentId]: buildDefaultRuntimeRosterEntry(
        input.agentId,
        String(nextRole.id ?? input.agentId),
        String(nextRole.displayName ?? nextRole.name ?? input.agentId),
        true,
      ),
    };
  }
  return writeAndValidateCatalog(projectRoot, catalog);
}

export function updateRuntimeAgent(projectRoot: string, agentId: string, patch: RuntimeAgentUpdate): AgentStudioConfig {
  const catalog = cloneCatalog(readOrBootstrapCatalog(projectRoot));
  const located = findRoleVariant(catalog as unknown as AgentStudioConfig, agentId);
  if (!located) {
    throw new Error(`Agent "${agentId}" not found in runtime catalog`);
  }

  const role = catalog.roles[located.roleIndex] as Record<string, any>;
  const variant = role.variants[located.variantIndex] as Record<string, any>;

  if (patch.name !== undefined) role.name = patch.name;
  if (patch.nickname !== undefined) {
    if (patch.nickname && patch.nickname.trim().length > 0) {
      role.nickname = patch.nickname.trim();
    } else {
      delete role.nickname;
    }
  }
  if (patch.roleDescription !== undefined) {
    if (located.isDefaultVariant) {
      variant.roleDescription = patch.roleDescription;
    } else {
      variant.roleDescription = patch.roleDescription;
    }
  }

  if (patch.displayName !== undefined) {
    if (located.isDefaultVariant) {
      role.displayName = patch.displayName;
      delete variant.displayName;
    } else {
      variant.displayName = patch.displayName;
    }
  }

  if (patch.variantLabel !== undefined) {
    if (patch.variantLabel && patch.variantLabel.trim().length > 0) {
      variant.variantLabel = patch.variantLabel.trim();
    } else {
      delete variant.variantLabel;
    }
  }

  if (patch.avatar !== undefined) {
    if (located.isDefaultVariant) {
      role.avatar = patch.avatar;
      delete variant.avatar;
    } else {
      variant.avatar = patch.avatar;
    }
  }

  if (patch.color !== undefined) {
    if (located.isDefaultVariant) {
      role.color = patch.color;
      delete variant.color;
    } else {
      variant.color = patch.color;
    }
  }

  if (patch.mentionPatterns !== undefined) {
    const normalized = normalizeMentionPatterns(agentId, patch.mentionPatterns);
    if (located.isDefaultVariant) {
      role.mentionPatterns = normalized;
      delete variant.mentionPatterns;
    } else {
      variant.mentionPatterns = normalized;
    }
  }

  if (patch.accountRef !== undefined) {
    if (patch.accountRef && patch.accountRef.trim().length > 0) {
      variant.accountRef = patch.accountRef.trim();
    } else {
      delete variant.accountRef;
    }
  }
  if (patch.personality !== undefined) {
    if (patch.personality && patch.personality.trim().length > 0) {
      variant.personality = patch.personality;
    } else {
      delete variant.personality;
    }
  }
  if (patch.teamStrengths !== undefined) {
    if (patch.teamStrengths && patch.teamStrengths.trim().length > 0) {
      variant.teamStrengths = patch.teamStrengths.trim();
    } else {
      delete variant.teamStrengths;
    }
  }
  if (patch.caution !== undefined) {
    variant.caution = patch.caution && patch.caution.trim().length > 0 ? patch.caution.trim() : null;
  }
  if (patch.strengths !== undefined) {
    if (patch.strengths.length > 0) {
      variant.strengths = patch.strengths;
    } else {
      delete variant.strengths;
    }
  }
  if (patch.sessionChain !== undefined) {
    if (located.isDefaultVariant) {
      variant.sessionChain = patch.sessionChain;
    } else {
      variant.sessionChain = patch.sessionChain;
    }
  }
  if (patch.clientId !== undefined) variant.clientId = patch.clientId;
  if (patch.defaultModel !== undefined) variant.defaultModel = patch.defaultModel;
  if (patch.mcpSupport !== undefined) variant.mcpSupport = patch.mcpSupport;
  if (patch.cli !== undefined) variant.cli = patch.cli;
  if (patch.contextBudget !== undefined) {
    if (patch.contextBudget) {
      variant.contextBudget = patch.contextBudget;
    } else {
      delete variant.contextBudget;
    }
  }
  if (patch.voiceConfig !== undefined) {
    if (patch.voiceConfig) {
      variant.voiceConfig = patch.voiceConfig;
    } else {
      delete variant.voiceConfig;
    }
  }
  if (patch.commandArgs !== undefined) {
    if (patch.commandArgs.length > 0) {
      variant.commandArgs = patch.commandArgs;
    } else {
      delete variant.commandArgs;
    }
  }
  if (patch.cliConfigArgs !== undefined) {
    if (patch.cliConfigArgs.length > 0) {
      variant.cliConfigArgs = patch.cliConfigArgs;
    } else {
      delete variant.cliConfigArgs;
    }
  }
  if (patch.provider !== undefined) {
    if (patch.provider) {
      variant.provider = patch.provider;
    } else {
      delete variant.provider;
    }
  }
  if (patch.available !== undefined && catalog.version === 2) {
    const existingEntry = catalog.roster[agentId];
    catalog.roster = {
      ...catalog.roster,
      [agentId]: existingEntry
        ? { ...existingEntry, available: patch.available }
        : buildDefaultRuntimeRosterEntry(
            agentId,
            String(role.id ?? agentId),
            String(role.displayName ?? role.name ?? agentId),
            patch.available,
          ),
    };
  }

  return writeAndValidateCatalog(projectRoot, catalog);
}

export function updateRuntimeCoCreator(projectRoot: string, patch: RuntimeCoCreatorUpdate): AgentStudioConfig {
  const catalog = cloneCatalog(readOrBootstrapCatalog(projectRoot));
  if (catalog.version !== 2) {
    throw new Error('Owner config requires a version 2 runtime catalog');
  }

  const currentOwner = (catalog.coCreator ?? {
    name: 'co-creator',
    aliases: [],
    mentionPatterns: ['@co-creator', '@co-creator'],
  }) as CoCreatorConfig;

  const nextOwner: Record<string, unknown> = {
    ...currentOwner,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.aliases !== undefined
      ? {
          aliases: Array.from(new Set(patch.aliases.map((alias) => alias.trim()).filter((alias) => alias.length > 0))),
        }
      : {}),
    ...(patch.mentionPatterns !== undefined
      ? {
          mentionPatterns: normalizeCoCreatorMentionPatterns(patch.mentionPatterns),
        }
      : {}),
  };

  if (patch.timeZone !== undefined) {
    nextOwner.timeZone = patch.timeZone.trim();
  }

  if (patch.avatar !== undefined) {
    if (patch.avatar && patch.avatar.trim().length > 0) {
      nextOwner.avatar = patch.avatar.trim();
    } else {
      delete nextOwner.avatar;
    }
  }

  if (patch.color !== undefined) {
    if (patch.color) {
      nextOwner.color = patch.color;
    } else {
      delete nextOwner.color;
    }
  }

  const normalizedOwner: CoCreatorConfig = {
    name: String(nextOwner.name ?? currentOwner.name),
    aliases: Array.isArray(nextOwner.aliases) ? (nextOwner.aliases as string[]) : [...currentOwner.aliases],
    mentionPatterns: Array.isArray(nextOwner.mentionPatterns)
      ? (nextOwner.mentionPatterns as string[])
      : [...currentOwner.mentionPatterns],
    ...(typeof nextOwner.timeZone === 'string' ? { timeZone: nextOwner.timeZone } : {}),
    ...(typeof nextOwner.avatar === 'string' ? { avatar: nextOwner.avatar } : {}),
    ...(nextOwner.color ? { color: nextOwner.color as AgentColor } : {}),
  };

  catalog.coCreator = normalizedOwner;
  return writeAndValidateCatalog(projectRoot, catalog);
}

export function deleteRuntimeAgent(projectRoot: string, agentId: string): AgentStudioConfig {
  const catalog = cloneCatalog(readOrBootstrapCatalog(projectRoot));
  const located = findRoleVariant(catalog as unknown as AgentStudioConfig, agentId);
  if (!located) {
    throw new Error(`Agent "${agentId}" not found in runtime catalog`);
  }
  const role = catalog.roles[located.roleIndex] as Record<string, any>;
  if (role.variants.length === 1) {
    catalog.roles = catalog.roles.filter((_: unknown, index: number) => index !== located.roleIndex);
  } else {
    role.variants = role.variants.filter((_: unknown, index: number) => index !== located.variantIndex);
    if (located.isDefaultVariant) {
      role.defaultVariantId = role.variants[0]?.id ?? role.defaultVariantId;
    }
  }

  if (catalog.version === 2 && agentId in catalog.roster) {
    const nextRoster = { ...catalog.roster };
    delete nextRoster[agentId];
    catalog.roster = nextRoster;
  }

  return writeAndValidateCatalog(projectRoot, catalog);
}

export function refreshRuntimeAgentCatalogCaches(): void {
  invalidateRuntimeCatalogCaches();
}
