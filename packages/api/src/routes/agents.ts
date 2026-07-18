/**
 * Agents API Routes
 * GET /api/agents - 获取所有 Agent 信息
 * GET /api/agents/:id/status - 获取 Agent 状态
 */

import { resolve } from 'node:path';
import {
  type AgentConfig,
  agentRegistry,
  CLI_EFFORT_VALUES,
  type CliConfig,
  type ClientId,
  type ContextBudget,
  getCliEffortOptionsForProvider,
  getDefaultCliEffortForProvider,
  isValidCliEffortForProvider,
  type RosterEntry,
} from '@agent-studio/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  builtinAccountIdForClient,
  resolveBuiltinClientForProvider,
  resolveByAccountRef,
  validateModelFormatForProvider,
  validateRuntimeProviderBinding,
} from '../config/account-resolver.js';
import { resolveBoundAccountRefForAgent } from '../config/agent-account-binding.js';
import { bootstrapAgentCatalog, resolveAgentCatalogPath } from '../config/agent-catalog-store.js';
import { getAcpConfig, getRoster, loadAgentConfig, toAllAgentConfigs } from '../config/agent-config-loader.js';
import { configEventBus, createChangeSetId } from '../config/config-event-bus.js';
import { resolveProjectTemplatePath } from '../config/project-template-path.js';
import { getResolvedAgents } from '../config/resolved-agents.js';
import { createRuntimeAgent, deleteRuntimeAgent, updateRuntimeAgent } from '../config/runtime-agent-catalog.js';
import { deleteRuntimeOverride, getRuntimeOverride, setRuntimeOverride } from '../config/session-strategy-overrides.js';
import { resolveActiveProjectRoot } from '../utils/active-project-root.js';
import { resolveHeaderUserId } from '../utils/request-identity.js';

const colorSchema = z.object({
  primary: z.string().min(1),
  secondary: z.string().min(1),
});

const contextBudgetSchema = z.object({
  maxPromptTokens: z.number().int().positive(),
  maxContextTokens: z.number().int().positive(),
  maxMessages: z.number().int().positive(),
  maxContentLengthPerMsg: z.number().int().positive(),
});

const cliEffortSchema = z.enum(CLI_EFFORT_VALUES);
const cliSchema = z.object({
  command: z.string().min(1).optional(),
  outputFormat: z.string().min(1).optional(),
  defaultArgs: z.array(z.string().min(1)).optional(),
  effort: cliEffortSchema.nullable().optional(),
});

const clientSchema = z.enum([
  'anthropic',
  'openai',
  'google',
  'kimi',
  'dare',
  'antigravity',
  'opencode',
  'agentrunner',
]);
const agentIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_-]*$/, 'agentId must use lowercase letters, numbers, "_" or "-" and start with a letter');

const voiceConfigSchema = z.object({
  voice: z.string().min(1),
  langCode: z.string().min(1),
  speed: z.number().positive().optional(),
  refAudio: z.string().min(1).optional(),
  refText: z.string().min(1).optional(),
  instruct: z.string().min(1).optional(),
  temperature: z.number().min(0).max(2).optional(),
});

const baseAgentSchema = z.object({
  agentId: agentIdSchema,
  name: z.string().min(1),
  displayName: z.string().min(1),
  variantLabel: z.string().optional(),
  nickname: z.string().optional(),
  avatar: z.preprocess(
    (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
    z.string().min(1).optional(),
  ),
  color: colorSchema,
  mentionPatterns: z.array(z.string().min(1)).min(1),
  accountRef: z.string().min(1).optional(),
  contextBudget: contextBudgetSchema.optional(),
  roleDescription: z.string().min(1),
  personality: z.string().optional(),
  teamStrengths: z.string().optional(),
  caution: z.string().nullable().optional(),
  strengths: z.array(z.string().min(1)).optional(),
  sessionChain: z.boolean().optional(),
  voiceConfig: voiceConfigSchema.optional(),
});

/** Strip trailing slashes from model names — prevents "MiniMax-M2.7/" artifacts.
 *  Empty string is allowed: OAuth/subscription accounts may omit model and
 *  let the CLI use its built-in default. api_key accounts are validated at
 *  runtime in validateAccountBindingOrThrow where authType is available. */
const modelSchema = z.string().transform((v) => v.replace(/\/+$/, ''));

const createNormalAgentSchema = baseAgentSchema.extend({
  clientId: clientSchema.exclude(['antigravity']),
  defaultModel: modelSchema,
  mcpSupport: z.boolean().optional(),
  cli: cliSchema.optional(),
  cliConfigArgs: z.array(z.string().min(1)).optional(),
  provider: z.string().min(1).optional(),
});

const createAntigravityAgentSchema = baseAgentSchema.extend({
  clientId: z.literal('antigravity'),
  defaultModel: modelSchema,
  mcpSupport: z.boolean().optional(),
  commandArgs: z.array(z.string().min(1)).min(1).optional(),
});

const createAgentSchema = z.discriminatedUnion('clientId', [createNormalAgentSchema, createAntigravityAgentSchema]);

const updateAgentSchema = z.object({
  name: z.string().min(1).optional(),
  displayName: z.string().min(1).optional(),
  variantLabel: z.string().nullable().optional(),
  nickname: z.string().optional(),
  avatar: z.string().min(1).optional(),
  color: colorSchema.optional(),
  mentionPatterns: z.array(z.string().min(1)).min(1).optional(),
  accountRef: z.string().min(1).nullable().optional(),
  contextBudget: contextBudgetSchema.nullable().optional(),
  roleDescription: z.string().min(1).optional(),
  personality: z.string().optional(),
  teamStrengths: z.string().optional(),
  caution: z.string().nullable().optional(),
  strengths: z.array(z.string().min(1)).optional(),
  sessionChain: z.boolean().optional(),
  available: z.boolean().optional(),
  clientId: clientSchema.optional(),
  defaultModel: modelSchema.optional(),
  mcpSupport: z.boolean().optional(),
  cli: cliSchema.optional(),
  commandArgs: z.array(z.string().min(1)).optional(),
  cliConfigArgs: z.array(z.string().min(1)).optional(),
  provider: z.string().min(1).nullable().optional(),
  voiceConfig: voiceConfigSchema.nullable().optional(),
});

type UpdateAgentRequestBody = z.infer<typeof updateAgentSchema>;

function resolveOperator(raw: unknown): string | null {
  if (typeof raw === 'string' && raw.trim().length > 0) return raw.trim();
  if (Array.isArray(raw)) {
    const first = raw.find((value) => typeof value === 'string' && value.trim().length > 0);
    if (typeof first === 'string') return first.trim();
  }
  return null;
}

function resolveProjectRoot(): string {
  return resolveActiveProjectRoot();
}

interface AgentResponseMetadata {
  roster: RosterEntry | null;
}

function buildAgentResponseMetadataResolver(projectRoot: string) {
  let roster: Record<string, RosterEntry> = {};
  try {
    roster = getRoster(loadAgentConfig(resolveAgentCatalogPath(projectRoot)));
  } catch {
    roster = {};
  }

  return (agentId: string): AgentResponseMetadata => ({ roster: roster[agentId] ?? null });
}

function defaultCliForClient(client: ClientId): { command: string; outputFormat: string } {
  switch (client) {
    case 'anthropic':
      return { command: 'claude', outputFormat: 'stream-json' };
    case 'openai':
      return { command: 'codex', outputFormat: 'json' };
    case 'google':
      return { command: 'gemini', outputFormat: 'stream-json' };
    case 'kimi':
      return { command: 'kimi', outputFormat: 'stream-json' };
    case 'dare':
      return { command: 'dare', outputFormat: 'json' };
    case 'opencode':
      return { command: 'opencode', outputFormat: 'json' };
    case 'antigravity':
      return { command: 'antigravity', outputFormat: 'json' };
    case 'a2a':
      return { command: 'a2a', outputFormat: 'json' };
    default:
      return { command: client, outputFormat: 'json' };
  }
}

type CliPatch = z.infer<typeof cliSchema>;

function buildResolvedCliConfig(client: ClientId, baseCli: CliConfig, patch?: CliPatch): CliConfig {
  const defaultArgs =
    patch?.defaultArgs !== undefined
      ? patch.defaultArgs.length > 0
        ? patch.defaultArgs
        : undefined
      : baseCli.defaultArgs && baseCli.defaultArgs.length > 0
        ? [...baseCli.defaultArgs]
        : undefined;

  const effortTouched = patch ? Object.hasOwn(patch, 'effort') : false;
  const nextEffort = effortTouched ? patch?.effort : baseCli.effort;
  if (nextEffort !== undefined && nextEffort !== null && !isValidCliEffortForProvider(client, nextEffort)) {
    const options = getCliEffortOptionsForProvider(client);
    if (!options) {
      throw new Error(`client "${client}" does not support cli.effort`);
    }
    throw new Error(`client "${client}" only supports cli.effort ${options.join(' / ')}`);
  }

  return {
    command: patch?.command ?? baseCli.command,
    outputFormat: patch?.outputFormat ?? baseCli.outputFormat,
    ...(defaultArgs ? { defaultArgs } : {}),
    ...(nextEffort !== undefined && nextEffort !== null ? { effort: nextEffort } : {}),
  };
}

function resolveAccountRef(body: { accountRef?: string | null }): string | undefined | null {
  if (body.accountRef !== undefined) return body.accountRef;
  return undefined;
}

/**
 * Resolve the target CLI config when patching a agent.
 *
 * Rules:
 * - Explicit body.cli takes precedence (including any effort value user sets)
 * - Provider switch: reset CLI to new provider's default (command, outputFormat, effort)
 * - antigravity commandArgs patch: preserve defaultArgs while using antigravity CLI
 */
function resolveNextCli(params: {
  body: UpdateAgentRequestBody;
  currentAgent: AgentConfig;
  effectiveClient: ClientId;
  hasCommandArgsPatch: boolean;
  nextCommandArgs: string[];
}): CliConfig | undefined {
  const { body, currentAgent, effectiveClient, hasCommandArgsPatch, nextCommandArgs } = params;
  const isClientSwitch = body.clientId !== undefined && body.clientId !== currentAgent.clientId;
  const defaultCli = defaultCliForClient(effectiveClient);
  const defaultEffort = getDefaultCliEffortForProvider(effectiveClient);

  if (body.cli !== undefined) {
    const baseCli =
      isClientSwitch || !currentAgent.cli
        ? {
            ...defaultCli,
            ...(defaultEffort ? { effort: defaultEffort } : {}),
          }
        : currentAgent.cli;
    return buildResolvedCliConfig(effectiveClient, baseCli, body.cli);
  }

  if (isClientSwitch) {
    return {
      ...defaultCli,
      ...(defaultEffort ? { effort: defaultEffort } : {}),
      ...(effectiveClient === 'antigravity' && hasCommandArgsPatch && nextCommandArgs.length > 0
        ? { defaultArgs: nextCommandArgs }
        : {}),
    };
  }

  if (effectiveClient === 'antigravity' && hasCommandArgsPatch) {
    return {
      ...defaultCliForClient('antigravity'),
      ...(nextCommandArgs.length > 0 ? { defaultArgs: nextCommandArgs } : {}),
    };
  }

  return undefined;
}

/**
 * Infer OpenCode provider from a bare model name.
 * Returns a known provider string or undefined (triggers validation error).
 */
function inferProviderFromModelName(model: string): string | undefined {
  const m = model.trim().toLowerCase();
  if (/^(gpt-|o[134]-|o[134]p|davinci|text-|chatgpt)/.test(m)) return 'openai';
  if (/^claude/.test(m)) return 'anthropic';
  if (/^gemini/.test(m)) return 'google';
  if (/^(moonshot|kimi)/.test(m)) return 'kimi';
  if (/^deepseek/.test(m)) return 'deepseek';
  if (/^(glm|chatglm)/.test(m)) return 'zhipu';
  if (/^(qwen|tongyi)/.test(m)) return 'dashscope';
  if (/^minimax/.test(m)) return 'minimax';
  return undefined;
}

function buildEffectiveAccountRefResolver() {
  return async (agent: AgentConfig & { contextBudget?: ContextBudget }): Promise<string | undefined> =>
    resolveBoundAccountRefForAgent('', agent.id, agent);
}

async function validateAccountBindingOrThrow(
  projectRoot: string,
  client: ClientId,
  accountRef?: string | null,
  defaultModel?: string | null,
  providerName?: string | null,
  options?: { legacyCompat?: boolean },
): Promise<void> {
  const trimmedAccountRef = accountRef?.trim();
  if (client === 'antigravity' && trimmedAccountRef) {
    throw new Error('antigravity client does not support accountRef');
  }
  if (client !== 'antigravity' && !trimmedAccountRef) {
    throw new Error(`client "${client}" requires a provider binding`);
  }
  if (!trimmedAccountRef) return;
  const runtimeProfile = resolveByAccountRef(projectRoot, trimmedAccountRef);
  if (!runtimeProfile) {
    throw new Error(`provider "${trimmedAccountRef}" not found`);
  }
  // api_key accounts require an explicit model; OAuth/subscription CLIs have defaults
  if (runtimeProfile.authType === 'api_key' && !defaultModel?.trim()) {
    throw new Error('API Key 认证类型需要指定 Model');
  }
  const compatibilityError = validateRuntimeProviderBinding(client, runtimeProfile, defaultModel);
  if (compatibilityError) {
    throw new Error(compatibilityError);
  }
  const modelFormatError = validateModelFormatForProvider(client, defaultModel, runtimeProfile.authType, providerName, {
    ...options,
    accountModels: runtimeProfile.models,
  });
  if (modelFormatError) {
    throw new Error(modelFormatError);
  }
}

async function toAgentResponse(
  agent: AgentConfig & { contextBudget?: ContextBudget },
  metadata: AgentResponseMetadata,
  resolveEffectiveAccountRef: (agent: AgentConfig & { contextBudget?: ContextBudget }) => Promise<string | undefined>,
) {
  return {
    id: agent.id,
    name: agent.name,
    displayName: agent.displayName,
    nickname: agent.nickname,
    color: agent.color,
    mentionPatterns: agent.mentionPatterns,
    roleId: agent.roleId,
    accountRef: await resolveEffectiveAccountRef(agent),
    clientId: agent.clientId,
    defaultModel: agent.defaultModel,
    cli: agent.cli,
    contextBudget: agent.contextBudget,
    avatar: agent.avatar,
    roleDescription: agent.roleDescription,
    personality: agent.personality,
    teamStrengths: agent.teamStrengths,
    caution: agent.caution,
    strengths: agent.strengths,
    sessionChain: agent.sessionChain,
    voiceConfig: agent.voiceConfig,
    commandArgs: agent.commandArgs,
    cliConfigArgs: agent.cliConfigArgs,
    provider: agent.provider,
    variantLabel: agent.variantLabel ?? undefined,
    isDefaultVariant: agent.isDefaultVariant ?? undefined,
    roleDisplayName: agent.roleDisplayName ?? undefined,
    mcpSupport: agent.mcpSupport,
    roster: metadata.roster
      ? {
          family: metadata.roster.family,
          roles: [...metadata.roster.roles],
          lead: metadata.roster.lead,
          available: metadata.roster.available,
          evaluation: metadata.roster.evaluation,
        }
      : null,
    adapterMode: agent.clientId === 'google' ? (getAcpConfig(agent.id as string) ? 'acp' : 'cli') : undefined,
  };
}

async function reconcileAgentRegistry(projectRoot: string, managedIdsBefore: ReadonlySet<string>) {
  const runtimeAgents = toAllAgentConfigs(loadAgentConfig(resolve(projectRoot, '.agent-studio', 'agent-catalog.json')));
  const extraAgents = agentRegistry.getAllConfigs();
  agentRegistry.reset();
  for (const [id, config] of Object.entries(runtimeAgents)) {
    agentRegistry.register(id, config);
  }
  for (const [id, config] of Object.entries(extraAgents)) {
    if (!runtimeAgents[id] && !managedIdsBefore.has(id)) agentRegistry.register(id, config);
  }
  return agentRegistry.getAllConfigs();
}

function getManagedCatalogIds(projectRoot: string): Set<string> {
  try {
    return new Set(
      Object.keys(toAllAgentConfigs(loadAgentConfig(resolve(projectRoot, '.agent-studio', 'agent-catalog.json')))),
    );
  } catch {
    return new Set();
  }
}

interface AgentsRoutesOptions {
  onCatalogChanged?: (agents: Record<string, AgentConfig>) => Promise<void> | void;
}

export const agentsRoutes: FastifyPluginAsync<AgentsRoutesOptions> = async (app, opts) => {
  // GET /api/agent-templates - 获取角色模板（纯灵魂层，不含 client/model 绑定）
  app.get('/api/agent-templates', async () => {
    try {
      const projectRoot = resolveProjectRoot();
      const templatePath = resolveProjectTemplatePath(projectRoot);
      const raw = JSON.parse(await import('node:fs').then((fs) => fs.promises.readFile(templatePath, 'utf-8'))) as {
        roleTemplates?: {
          id: string;
          name: string;
          nickname?: string;
          avatar: string;
          color: { primary: string; secondary: string };
          roleDescription: string;
          personality: string;
          teamStrengths?: string;
        }[];
        clientDefaults?: Record<string, { defaultModel: string; models: string[] }>;
      };
      if (raw.roleTemplates && raw.roleTemplates.length > 0) {
        return { templates: raw.roleTemplates, clientDefaults: raw.clientDefaults ?? {} };
      }
      // Fallback: extract from roles (legacy)
      const templateConfig = loadAgentConfig(templatePath);
      const allAgents = Object.values(toAllAgentConfigs(templateConfig));
      const templateAgents = allAgents.filter((c) => c.isDefaultVariant);
      return {
        templates: templateAgents.map((agent) => ({
          id: agent.roleId ?? agent.id,
          name: agent.roleDisplayName ?? agent.displayName ?? agent.name,
          nickname: agent.nickname,
          avatar: agent.avatar,
          color: agent.color,
          roleDescription: agent.roleDescription,
          personality: agent.personality,
          teamStrengths: agent.teamStrengths,
        })),
        clientDefaults: {},
      };
    } catch (err) {
      app.log.warn({ err }, 'Failed to load agent templates');
      return { templates: [], clientDefaults: {} };
    }
  });

  // GET /api/agents - 获取所有 Agent 配置
  app.get('/api/agents', async () => {
    const projectRoot = resolveProjectRoot();
    const resolveMetadata = buildAgentResponseMetadataResolver(projectRoot);
    const resolveEffectiveAccountRef = buildEffectiveAccountRefResolver();
    return {
      agents: await Promise.all(
        Object.values(getResolvedAgents(projectRoot)).map((agent) =>
          toAgentResponse(agent, resolveMetadata(agent.id), resolveEffectiveAccountRef),
        ),
      ),
    };
  });

  app.post('/api/agents', async (request, reply) => {
    const operator = resolveHeaderUserId(request);
    if (!operator) {
      reply.status(400);
      return { error: 'Identity required (X-Agent-Studio-User header)' };
    }

    const parsed = createAgentSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: 'Invalid request', details: parsed.error.issues };
    }

    const projectRoot = resolveProjectRoot();
    const managedIdsBefore = getManagedCatalogIds(projectRoot);
    const body = parsed.data;

    // Validate alias uniqueness across all existing members
    if (body.mentionPatterns?.length) {
      const allConfigs = agentRegistry.getAllConfigs();
      for (const pattern of body.mentionPatterns) {
        const normalized = pattern.toLowerCase();
        for (const [existingId, existingConfig] of Object.entries(allConfigs)) {
          if (existingConfig.mentionPatterns.some((p: string) => p.toLowerCase() === normalized)) {
            reply.status(400);
            return { error: `别名 "${pattern}" 已被成员 "${existingId}" 使用` };
          }
        }
      }
    }

    const accountRef = resolveAccountRef(body);
    try {
      /* Infer provider for opencode API-key accounts from the model name when no
         explicit provider is given. This avoids hard-coding 'openai' for all bare
         models — Anthropic/Google accounts get the correct adapter.
         Unknown model prefixes → undefined → validation error preserved. */
      const explicitProvider = 'provider' in body ? body.provider : undefined;
      const providerNameForValidation =
        explicitProvider ??
        (body.clientId === 'opencode' && body.defaultModel && !body.defaultModel.includes('/')
          ? inferProviderFromModelName(body.defaultModel)
          : undefined);
      await validateAccountBindingOrThrow(
        projectRoot,
        body.clientId,
        accountRef,
        body.defaultModel,
        providerNameForValidation,
      );
      const resolvedAvatar = body.avatar ?? '/avatars/default.svg';
      if (body.clientId === 'antigravity') {
        createRuntimeAgent(projectRoot, {
          agentId: body.agentId,
          name: body.name,
          displayName: body.displayName,
          variantLabel: body.variantLabel,
          nickname: body.nickname,
          avatar: resolvedAvatar,
          color: body.color,
          mentionPatterns: body.mentionPatterns,
          ...(accountRef !== undefined ? { accountRef: accountRef ?? undefined } : {}),
          contextBudget: body.contextBudget,
          roleDescription: body.roleDescription,
          personality: body.personality,
          teamStrengths: body.teamStrengths,
          caution: body.caution,
          strengths: body.strengths,
          sessionChain: body.sessionChain,
          clientId: 'antigravity',
          defaultModel: body.defaultModel,
          mcpSupport: body.mcpSupport ?? true,
          cli: {
            ...defaultCliForClient('antigravity'),
            ...(body.commandArgs ? { defaultArgs: body.commandArgs } : {}),
          },
          commandArgs: body.commandArgs,
          ...(body.voiceConfig ? { voiceConfig: body.voiceConfig } : {}),
        });
      } else {
        const resolvedCli = buildResolvedCliConfig(body.clientId, defaultCliForClient(body.clientId), body.cli);
        createRuntimeAgent(projectRoot, {
          agentId: body.agentId,
          name: body.name,
          displayName: body.displayName,
          variantLabel: body.variantLabel,
          nickname: body.nickname,
          avatar: resolvedAvatar,
          color: body.color,
          mentionPatterns: body.mentionPatterns,
          ...(accountRef !== undefined ? { accountRef: accountRef ?? undefined } : {}),
          contextBudget: body.contextBudget,
          roleDescription: body.roleDescription,
          personality: body.personality,
          teamStrengths: body.teamStrengths,
          caution: body.caution,
          strengths: body.strengths,
          sessionChain: body.sessionChain,
          clientId: body.clientId,
          defaultModel: body.defaultModel,
          mcpSupport:
            body.mcpSupport ??
            (body.clientId === 'anthropic' ||
              body.clientId === 'openai' ||
              body.clientId === 'google' ||
              body.clientId === 'opencode'),
          cli: resolvedCli,
          ...(body.cliConfigArgs ? { cliConfigArgs: body.cliConfigArgs } : {}),
          ...(body.provider || providerNameForValidation
            ? { provider: body.provider ?? providerNameForValidation }
            : {}),
          ...(body.voiceConfig ? { voiceConfig: body.voiceConfig } : {}),
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      reply.status(400);
      return { error: message };
    }

    const resolved = await reconcileAgentRegistry(projectRoot, managedIdsBefore);
    await configEventBus.emitChangeAsync({
      source: 'agent-config',
      scope: 'domain',
      changedKeys: [body.agentId],
      changeSetId: createChangeSetId(),
      timestamp: Date.now(),
    });
    const agent = resolved[body.agentId];
    const metadata = buildAgentResponseMetadataResolver(projectRoot);
    const resolveEffectiveAccountRef = buildEffectiveAccountRefResolver();
    reply.status(201);
    return { agent: await toAgentResponse(agent, metadata(agent.id), resolveEffectiveAccountRef), updatedBy: operator };
  });

  app.patch<{ Params: { id: string } }>('/api/agents/:id', async (request, reply) => {
    const operator = resolveHeaderUserId(request);
    if (!operator) {
      reply.status(400);
      return { error: 'Identity required (X-Agent-Studio-User header)' };
    }

    const parsed = updateAgentSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: 'Invalid request', details: parsed.error.issues };
    }

    const body = parsed.data;
    const projectRoot = resolveProjectRoot();

    // Validate alias uniqueness when mentionPatterns are being updated
    if (body.mentionPatterns?.length) {
      const allConfigs = agentRegistry.getAllConfigs();
      for (const pattern of body.mentionPatterns) {
        const normalized = pattern.toLowerCase();
        for (const [existingId, existingConfig] of Object.entries(allConfigs)) {
          if (existingId === request.params.id) continue; // skip self
          if (existingConfig.mentionPatterns.some((p: string) => p.toLowerCase() === normalized)) {
            reply.status(400);
            return { error: `别名 "${pattern}" 已被成员 "${existingId}" 使用` };
          }
        }
      }
    }

    const resolveEffectiveAccountRef = buildEffectiveAccountRefResolver();
    const currentAgent =
      getResolvedAgents(projectRoot)[request.params.id] ?? agentRegistry.tryGet(request.params.id)?.config;
    if (!currentAgent) {
      reply.status(404);
      return { error: `Agent "${request.params.id}" not found` };
    }
    const effectiveClient = body.clientId ?? currentAgent.clientId;
    const currentEffectiveAccountRef = await resolveEffectiveAccountRef(currentAgent);
    let targetAccountRef = resolveAccountRef(body);
    let effectiveAccountRef =
      targetAccountRef !== undefined ? (targetAccountRef ?? undefined) : currentEffectiveAccountRef;
    const effectiveDefaultModel = body.defaultModel !== undefined ? body.defaultModel : currentAgent.defaultModel;

    // Auto-rebase builtin binding when switching client families.
    // When the editor sends the old client's builtin accountRef during a provider switch,
    // rebase to the new client's builtin so validation doesn't reject the stale ref.
    const isClientSwitch = body.clientId !== undefined && body.clientId !== currentAgent.clientId;
    if (isClientSwitch && effectiveAccountRef) {
      const oldBuiltin = resolveBuiltinClientForProvider(currentAgent.clientId);
      if (oldBuiltin && builtinAccountIdForClient(oldBuiltin) === effectiveAccountRef) {
        const newBuiltin = resolveBuiltinClientForProvider(effectiveClient);
        if (newBuiltin) {
          effectiveAccountRef = builtinAccountIdForClient(newBuiltin) ?? undefined;
          targetAccountRef = effectiveAccountRef;
        }
      }
    }
    const providerConfigTouched =
      body.clientId !== undefined ||
      body.defaultModel !== undefined ||
      targetAccountRef !== undefined ||
      body.provider !== undefined;

    if (providerConfigTouched) {
      try {
        const effectiveProviderName = body.provider !== undefined ? body.provider : currentAgent.provider;
        // Legacy compat: existing opencode+api_key members without provider name
        // can still be edited for non-binding changes (name, model, etc.).
        // NOT allowed when: switching accountRef, or switching clientId to opencode
        // from another client — both create a new binding that must have provider name.
        // Compare against current binding — editor always sends accountRef even when unchanged.
        const isBindingChange =
          targetAccountRef !== undefined && (targetAccountRef ?? undefined) !== currentEffectiveAccountRef;
        const isClientSwitch = body.clientId !== undefined && body.clientId !== currentAgent.clientId;
        const isExistingOpencode = currentAgent.clientId === 'opencode';
        const legacyCompat =
          body.provider === undefined &&
          !currentAgent.provider &&
          !isBindingChange &&
          !isClientSwitch &&
          isExistingOpencode;
        await validateAccountBindingOrThrow(
          projectRoot,
          effectiveClient,
          effectiveAccountRef,
          effectiveDefaultModel,
          effectiveProviderName,
          { legacyCompat },
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        reply.status(400);
        return { error: message };
      }
    }

    const managedIdsBefore = getManagedCatalogIds(projectRoot);
    try {
      const hasCommandArgsPatch = body.commandArgs !== undefined;
      const nextCommandArgs = body.commandArgs ?? [];
      const nextCli = resolveNextCli({
        body,
        currentAgent,
        effectiveClient,
        hasCommandArgsPatch,
        nextCommandArgs,
      });
      updateRuntimeAgent(projectRoot, request.params.id, {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
        ...(body.variantLabel !== undefined ? { variantLabel: body.variantLabel } : {}),
        ...(body.nickname !== undefined ? { nickname: body.nickname } : {}),
        ...(body.avatar !== undefined ? { avatar: body.avatar } : {}),
        ...(body.color !== undefined ? { color: body.color } : {}),
        ...(body.mentionPatterns !== undefined ? { mentionPatterns: body.mentionPatterns } : {}),
        ...(targetAccountRef !== undefined ? { accountRef: targetAccountRef } : {}),
        ...(body.contextBudget !== undefined ? { contextBudget: body.contextBudget } : {}),
        ...(body.roleDescription !== undefined ? { roleDescription: body.roleDescription } : {}),
        ...(body.personality !== undefined ? { personality: body.personality } : {}),
        ...(body.teamStrengths !== undefined ? { teamStrengths: body.teamStrengths } : {}),
        ...(body.caution !== undefined ? { caution: body.caution } : {}),
        ...(body.strengths !== undefined ? { strengths: body.strengths } : {}),
        ...(body.sessionChain !== undefined ? { sessionChain: body.sessionChain } : {}),
        ...(body.clientId !== undefined ? { clientId: body.clientId } : {}),
        ...(body.defaultModel !== undefined ? { defaultModel: body.defaultModel } : {}),
        ...(body.mcpSupport !== undefined ? { mcpSupport: body.mcpSupport } : {}),
        ...(hasCommandArgsPatch
          ? {
              commandArgs: body.commandArgs,
            }
          : {}),
        ...(nextCli !== undefined ? { cli: nextCli } : {}),
        ...(body.available !== undefined ? { available: body.available } : {}),
        ...(body.cliConfigArgs !== undefined ? { cliConfigArgs: body.cliConfigArgs } : {}),
        ...(body.provider !== undefined
          ? body.provider === null
            ? { provider: null }
            : { provider: body.provider }
          : {}),
        ...(body.voiceConfig !== undefined
          ? body.voiceConfig === null
            ? { voiceConfig: null }
            : { voiceConfig: body.voiceConfig }
          : {}),
      });
      const resolved = await reconcileAgentRegistry(projectRoot, managedIdsBefore);
      await configEventBus.emitChangeAsync({
        source: 'agent-config',
        scope: 'domain',
        changedKeys: [request.params.id],
        changeSetId: createChangeSetId(),
        timestamp: Date.now(),
      });
      const agent = resolved[request.params.id];
      const metadata = buildAgentResponseMetadataResolver(projectRoot);
      return {
        agent: await toAgentResponse(agent, metadata(agent.id), resolveEffectiveAccountRef),
        updatedBy: operator,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/not found/i.test(message)) {
        reply.status(404);
      } else {
        reply.status(400);
      }
      return { error: message };
    }
  });

  app.delete<{ Params: { id: string } }>('/api/agents/:id', async (request, reply) => {
    const operator = resolveHeaderUserId(request);
    if (!operator) {
      reply.status(400);
      return { error: 'Identity required (X-Agent-Studio-User header)' };
    }

    const projectRoot = resolveProjectRoot();
    const currentAgent =
      getResolvedAgents(projectRoot)[request.params.id] ?? agentRegistry.tryGet(request.params.id)?.config;
    if (!currentAgent) {
      reply.status(404);
      return { error: `Agent "${request.params.id}" not found` };
    }
    const managedIdsBefore = getManagedCatalogIds(projectRoot);
    const overrideBackup = getRuntimeOverride(request.params.id);
    try {
      await deleteRuntimeOverride(request.params.id);
      try {
        deleteRuntimeAgent(projectRoot, request.params.id);
      } catch (err) {
        if (overrideBackup) {
          await setRuntimeOverride(request.params.id, overrideBackup);
        }
        throw err;
      }
      await reconcileAgentRegistry(projectRoot, managedIdsBefore);
      await configEventBus.emitChangeAsync({
        source: 'agent-config',
        scope: 'domain',
        changedKeys: [request.params.id],
        changeSetId: createChangeSetId(),
        timestamp: Date.now(),
      });
      return { deleted: true, id: request.params.id, updatedBy: operator };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/not found/i.test(message)) {
        reply.status(404);
      } else {
        reply.status(400);
      }
      return { error: message };
    }
  });

  // GET /api/agents/:id/status - 获取 Agent 状态
  app.get<{ Params: { id: string } }>('/api/agents/:id/status', async (request, reply) => {
    const { id } = request.params;
    const projectRoot = resolveProjectRoot();
    const agent = getResolvedAgents(projectRoot)[id] ?? agentRegistry.tryGet(id)?.config;

    if (!agent) {
      reply.status(404);
      return { error: 'Agent not found' };
    }

    // Agent status is currently tracked via WebSocket events (ThinkingIndicator/ParallelStatusBar).
    // This endpoint returns placeholder data; Redis-backed polling status is a future enhancement.
    // See: InvocationTracker for per-thread tracking, not per-agent.
    return {
      id: agent.id,
      displayName: agent.displayName,
      status: 'idle',
      lastActive: Date.now(),
    };
  });
};
