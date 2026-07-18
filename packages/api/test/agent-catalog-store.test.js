import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

const { bootstrapAgentCatalog, resolveAgentCatalogPath, writeAgentCatalog } = await import(
  '../dist/config/agent-catalog-store.js'
);
const { createRuntimeAgent, deleteRuntimeAgent, readRuntimeAgentCatalog, updateRuntimeAgent } = await import(
  '../dist/config/runtime-agent-catalog.js'
);

function validConfig() {
  return {
    version: 2,
    roles: [
      {
        id: 'lead-architect',
        agentId: 'opus',
        name: 'Lead Architect',
        displayName: 'Lead Architect',
        avatar: '/avatars/opus.png',
        color: { primary: '#9B7EBD', secondary: '#E8DFF5' },
        mentionPatterns: ['@opus', '@Lead Architect'],
        roleDescription: '主架构师',
        defaultVariantId: 'opus-default',
        variants: [
          {
            id: 'opus-default',
            provider: 'anthropic',
            defaultModel: 'claude-sonnet-4-5-20250929',
            mcpSupport: true,
            cli: { command: 'claude', outputFormat: 'stream-json' },
          },
        ],
      },
    ],
    roster: {
      opus: {
        family: 'lead-architect',
        roles: ['architect'],
        lead: true,
        available: true,
        evaluation: 'primary',
      },
    },
    reviewPolicy: {
      requireDifferentFamily: true,
      preferActiveInThread: true,
      preferLead: true,
      excludeUnavailable: true,
    },
    coCreator: {
      name: 'Co-worker',
      aliases: ['共创伙伴'],
      mentionPatterns: ['@co-worker', '@owner'],
    },
  };
}

function makeF127BootstrapTemplate() {
  return {
    version: 2,
    roles: [
      {
        id: 'lead-architect',
        agentId: 'opus',
        name: 'Lead Architect',
        displayName: 'Lead Architect',
        avatar: '/avatars/opus.png',
        color: { primary: '#9B7EBD', secondary: '#E8DFF5' },
        mentionPatterns: ['@opus', '@Lead Architect'],
        roleDescription: 'Claude 系主力',
        defaultVariantId: 'opus-default',
        variants: [
          {
            id: 'opus-default',
            provider: 'anthropic',
            defaultModel: 'claude-opus-4-6',
            mcpSupport: true,
            cli: { command: 'claude', outputFormat: 'stream-json' },
          },
          {
            id: 'opus-sonnet',
            agentId: 'sonnet',
            displayName: 'Lead Architect',
            mentionPatterns: ['@sonnet'],
            provider: 'anthropic',
            defaultModel: 'claude-sonnet-4',
            mcpSupport: true,
            cli: { command: 'claude', outputFormat: 'stream-json' },
          },
        ],
      },
      {
        id: 'code-reviewer',
        agentId: 'codex',
        name: 'Code Reviewer',
        displayName: 'Code Reviewer',
        avatar: '/avatars/codex.png',
        color: { primary: '#5B8C5A', secondary: '#D4E6D3' },
        mentionPatterns: ['@codex', '@Code Reviewer'],
        roleDescription: 'Codex 系主力',
        defaultVariantId: 'codex-default',
        variants: [
          {
            id: 'codex-default',
            provider: 'openai',
            defaultModel: 'gpt-5.4',
            mcpSupport: true,
            cli: { command: 'codex', outputFormat: 'json' },
          },
          {
            id: 'codex-spark',
            agentId: 'spark',
            displayName: 'Code Reviewer',
            mentionPatterns: ['@spark'],
            provider: 'openai',
            defaultModel: 'gpt-5.3-codex-spark',
            mcpSupport: true,
            cli: { command: 'codex', outputFormat: 'json' },
          },
        ],
      },
      {
        id: 'frontend-designer',
        agentId: 'gemini',
        name: 'Frontend Designer',
        displayName: 'Frontend Designer',
        avatar: '/avatars/gemini.png',
        color: { primary: '#5B9BD5', secondary: '#D6E9F8' },
        mentionPatterns: ['@gemini', '@Frontend Designer'],
        roleDescription: 'Gemini 系主力',
        defaultVariantId: 'gemini-default',
        variants: [
          {
            id: 'gemini-default',
            provider: 'google',
            defaultModel: 'gemini-3.1-pro',
            mcpSupport: true,
            cli: { command: 'gemini', outputFormat: 'stream-json' },
          },
        ],
      },
      {
        id: 'runtime-engineer',
        agentId: 'dare',
        name: 'Runtime Engineer',
        displayName: 'Runtime Engineer',
        avatar: '/avatars/dare.png',
        color: { primary: '#6B7280', secondary: '#E5E7EB' },
        mentionPatterns: ['@dare', '@Runtime Engineer'],
        roleDescription: 'Dare 框架智能体',
        defaultVariantId: 'dare-default',
        variants: [
          {
            id: 'dare-default',
            provider: 'dare',
            defaultModel: 'glm-4.7',
            mcpSupport: true,
            cli: { command: 'dare', outputFormat: 'json' },
          },
        ],
      },
      {
        id: 'tooling-engineer',
        agentId: 'opencode',
        name: 'Nora',
        displayName: 'Nora',
        avatar: '/avatars/opencode.png',
        color: { primary: '#C08457', secondary: '#FDE7D3' },
        mentionPatterns: ['@opencode', '@Nora'],
        roleDescription: 'OpenCode',
        defaultVariantId: 'opencode-default',
        variants: [
          {
            id: 'opencode-default',
            provider: 'opencode',
            defaultModel: 'claude-opus-4-6',
            mcpSupport: true,
            cli: { command: 'opencode', outputFormat: 'json' },
          },
        ],
      },
    ],
    roster: {
      opus: { family: 'lead-architect', roles: ['architect'], lead: true, available: true, evaluation: 'claude' },
      sonnet: { family: 'lead-architect', roles: ['assistant'], lead: false, available: true, evaluation: 'claude-2' },
      codex: { family: 'code-reviewer', roles: ['reviewer'], lead: true, available: true, evaluation: 'codex' },
      spark: { family: 'code-reviewer', roles: ['coder'], lead: false, available: true, evaluation: 'spark' },
      gemini: { family: 'frontend-designer', roles: ['designer'], lead: true, available: true, evaluation: 'gemini' },
      dare: { family: 'runtime-engineer', roles: ['coding'], lead: true, available: true, evaluation: 'dare' },
      opencode: { family: 'tooling-engineer', roles: ['coding'], lead: true, available: true, evaluation: 'opencode' },
    },
    reviewPolicy: {
      requireDifferentFamily: true,
      preferActiveInThread: true,
      preferLead: true,
      excludeUnavailable: true,
    },
    coCreator: {
      name: 'Co-worker',
      aliases: ['共创伙伴'],
      mentionPatterns: ['@co-worker', '@owner'],
    },
  };
}

function makeSiblingTemplate(seedAgentId) {
  const config = validConfig();
  config.roles[0].agentId = seedAgentId;
  config.roles[0].displayName = '影子智能体';
  config.roles[0].mentionPatterns = [`@${seedAgentId}`];
  config.roster = {
    [seedAgentId]: {
      family: 'lead-architect',
      roles: ['architect'],
      lead: true,
      available: true,
      evaluation: 'shadow',
    },
  };
  return config;
}

describe('agent-catalog-store', () => {
  // Isolate provider profiles to a clean tmpdir so tests don't read from ~/.agent-studio/
  let savedGlobalRoot;
  const isolationRoot = mkdtempSync(join(tmpdir(), 'agent-catalog-store-isolation-'));
  before(() => {
    savedGlobalRoot = process.env.AGENT_STUDIO_GLOBAL_CONFIG_ROOT;
    process.env.AGENT_STUDIO_GLOBAL_CONFIG_ROOT = isolationRoot;
  });
  beforeEach(() => {
    process.env.AGENT_STUDIO_GLOBAL_CONFIG_ROOT = isolationRoot;
  });
  after(() => {
    if (savedGlobalRoot === undefined) delete process.env.AGENT_STUDIO_GLOBAL_CONFIG_ROOT;
    else process.env.AGENT_STUDIO_GLOBAL_CONFIG_ROOT = savedGlobalRoot;
  });

  it('bootstraps an empty catalog by default (first-run quest)', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'agent-catalog-store-f127-default-'));
    const templatePath = join(projectRoot, 'agent-template.json');
    const template = makeF127BootstrapTemplate();
    writeFileSync(templatePath, JSON.stringify(template, null, 2));

    const catalogPath = bootstrapAgentCatalog(projectRoot, templatePath);
    const runtimeCatalog = JSON.parse(readFileSync(catalogPath, 'utf-8'));

    assert.deepEqual(runtimeCatalog.roles, []);
    assert.deepEqual(runtimeCatalog.roster, {
      owner: { family: 'owner', roles: ['owner'], lead: false, available: true, evaluation: 'co-creator / 大当家' },
    });
    // Non-role config (reviewPolicy, coCreator) is preserved from template.
    assert.deepEqual(runtimeCatalog.reviewPolicy, template.reviewPolicy);
    assert.deepEqual(runtimeCatalog.coCreator, template.coCreator);
  });

  it('creates catalog file at .agent-studio/agent-catalog.json', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'agent-catalog-store-'));
    const templatePath = join(projectRoot, 'agent-template.json');
    writeFileSync(templatePath, JSON.stringify(validConfig(), null, 2));

    const catalogPath = bootstrapAgentCatalog(projectRoot, templatePath);
    assert.equal(catalogPath, resolveAgentCatalogPath(projectRoot));
    assert.ok(existsSync(catalogPath), 'runtime catalog should be created');
  });

  it('keeps existing .agent-studio/agent-catalog.json runtime edits and leaves unbound variants alone', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'agent-catalog-store-'));
    const templatePath = join(projectRoot, 'agent-template.json');
    writeFileSync(templatePath, JSON.stringify(validConfig(), null, 2));

    const runtimeConfig = validConfig();
    runtimeConfig.roles[0].displayName = '运行时Lead Architect';
    mkdirSync(join(projectRoot, '.agent-studio'), { recursive: true });
    writeFileSync(join(projectRoot, '.agent-studio', 'agent-catalog.json'), JSON.stringify(runtimeConfig, null, 2));

    const catalogPath = bootstrapAgentCatalog(projectRoot, templatePath);
    const hydrated = JSON.parse(readFileSync(catalogPath, 'utf-8'));
    assert.equal(hydrated.roles[0]?.displayName, '运行时Lead Architect');
    // baiyuxi-agent-studio#340: migration does NOT backfill accountRef — unbound variants stay unbound
    assert.equal(hydrated.roles[0]?.variants[0]?.accountRef, undefined);
  });

  it('keeps existing custom runtime agents unbound during catalog migration', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'agent-catalog-store-custom-runtime-'));
    const templatePath = join(projectRoot, 'agent-template.json');
    writeFileSync(templatePath, JSON.stringify(validConfig(), null, 2));

    const runtimeConfig = validConfig();
    runtimeConfig.roles.push({
      id: 'custom-openai',
      agentId: 'custom-openai',
      name: '自定义智能体',
      displayName: '自定义智能体',
      avatar: '/avatars/custom.png',
      color: { primary: '#22c55e', secondary: '#dcfce7' },
      mentionPatterns: ['@custom-openai'],
      roleDescription: '自定义运行时智能体',
      defaultVariantId: 'custom-openai-default',
      variants: [
        {
          id: 'custom-openai-default',
          provider: 'openai',
          defaultModel: 'gpt-5.4-mini',
          mcpSupport: false,
          cli: { command: 'codex', outputFormat: 'json' },
        },
      ],
    });
    runtimeConfig.roster['custom-openai'] = {
      family: 'custom-openai',
      roles: ['assistant'],
      lead: false,
      available: true,
      evaluation: 'runtime custom',
    };

    mkdirSync(join(projectRoot, '.agent-studio'), { recursive: true });
    writeFileSync(join(projectRoot, '.agent-studio', 'agent-catalog.json'), JSON.stringify(runtimeConfig, null, 2));

    const catalogPath = bootstrapAgentCatalog(projectRoot, templatePath);
    const hydrated = JSON.parse(readFileSync(catalogPath, 'utf-8'));
    const customBreed = hydrated.roles.find((role) => role.agentId === 'custom-openai');
    assert.ok(customBreed, 'custom runtime role should be preserved');
    assert.equal(customBreed?.variants[0]?.accountRef, undefined);
  });

  it('creates a new runtime member without corrupting v2 top-level fields', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'agent-catalog-store-'));
    const templatePath = join(projectRoot, 'agent-template.json');
    writeFileSync(templatePath, JSON.stringify(validConfig(), null, 2));
    writeAgentCatalog(projectRoot, validConfig());

    await createRuntimeAgent(projectRoot, {
      agentId: 'spark-lite',
      roleId: 'spark-lite',
      name: '火花智能体',
      displayName: '火花智能体',
      avatar: '/avatars/spark.png',
      color: { primary: '#f97316', secondary: '#fed7aa' },
      mentionPatterns: ['@spark-lite', '@火花智能体'],
      roleDescription: '快速执行',
      personality: '利落',
      clientId: 'openai',
      defaultModel: 'gpt-5.4-mini',
      mcpSupport: false,
      cli: { command: 'codex', outputFormat: 'json' },
    });

    const catalog = readRuntimeAgentCatalog(projectRoot);
    assert.equal(catalog.version, 2);
    assert.equal(catalog.coCreator?.name, 'Co-worker');
    assert.equal(catalog.reviewPolicy?.preferLead, true);
    assert.ok(catalog.roster?.opus, 'existing roster must be preserved');
    assert.deepEqual(catalog.roster?.['spark-lite'], {
      family: 'spark-lite',
      roles: ['assistant'],
      lead: false,
      available: true,
      evaluation: '火花智能体 runtime member',
    });
    const created = catalog.roles.find((role) => role.agentId === 'spark-lite');
    assert.ok(created, 'spark-lite role should be created');
    assert.equal(created.displayName, '火花智能体');
    assert.deepEqual(created.mentionPatterns, ['@spark-lite', '@火花智能体']);
    assert.equal(created.variants[0]?.clientId, 'openai');
  });

  it('persists voiceConfig when creating a runtime member', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'agent-catalog-store-'));
    const templatePath = join(projectRoot, 'agent-template.json');
    writeFileSync(templatePath, JSON.stringify(validConfig(), null, 2));
    writeAgentCatalog(projectRoot, validConfig());

    await createRuntimeAgent(projectRoot, {
      agentId: 'voice-agent',
      roleId: 'voice-agent',
      name: '声音智能体',
      displayName: '声音智能体',
      avatar: '/avatars/voice.png',
      color: { primary: '#0f766e', secondary: '#ccfbf1' },
      mentionPatterns: ['@voice-agent'],
      roleDescription: '声音配置验证',
      clientId: 'openai',
      defaultModel: 'gpt-5.4',
      mcpSupport: true,
      cli: { command: 'codex', outputFormat: 'json' },
      voiceConfig: {
        voice: 'clone-voice',
        langCode: 'zh',
        refAudio: '/uploads/ref-audio-1234-abcd.wav',
        refText: '参考文本',
        instruct: 'calm',
        speed: 1.1,
      },
    });

    const catalog = readRuntimeAgentCatalog(projectRoot);
    const created = catalog.roles.find((role) => role.agentId === 'voice-agent');
    assert.ok(created, 'voice-agent role should be created');
    assert.deepEqual(created.variants[0]?.voiceConfig, {
      voice: 'clone-voice',
      langCode: 'zh',
      refAudio: '/uploads/ref-audio-1234-abcd.wav',
      refText: '参考文本',
      instruct: 'calm',
      speed: 1.1,
    });
  });

  it('updates an existing runtime member in place', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'agent-catalog-store-'));
    const templatePath = join(projectRoot, 'agent-template.json');
    writeFileSync(templatePath, JSON.stringify(validConfig(), null, 2));
    writeAgentCatalog(projectRoot, validConfig());

    await updateRuntimeAgent(projectRoot, 'opus', {
      displayName: '运行时Lead Architect',
      mentionPatterns: ['@opus', '@Lead Architect', '@运行时Ethan'],
      defaultModel: 'claude-opus-4-1',
      personality: '更严格',
    });

    const catalog = readRuntimeAgentCatalog(projectRoot);
    const updated = catalog.roles.find((role) => role.agentId === 'opus');
    assert.ok(updated, 'opus role should still exist');
    assert.equal(updated.displayName, '运行时Lead Architect');
    assert.deepEqual(updated.mentionPatterns, ['@opus', '@Lead Architect', '@运行时Ethan']);
    assert.equal(updated.variants[0]?.defaultModel, 'claude-opus-4-1');
    assert.equal(updated.variants[0]?.personality, '更严格');
    assert.equal(catalog.coCreator?.mentionPatterns[0], '@co-worker');
  });

  it('persists and clears voiceConfig when updating a runtime member', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'agent-catalog-store-'));
    const templatePath = join(projectRoot, 'agent-template.json');
    writeFileSync(templatePath, JSON.stringify(validConfig(), null, 2));
    writeAgentCatalog(projectRoot, validConfig());

    await updateRuntimeAgent(projectRoot, 'opus', {
      voiceConfig: {
        voice: 'updated-clone',
        langCode: 'zh',
        refAudio: '/uploads/ref-audio-5678-efab.mp3',
        refText: '更新后的参考文本',
      },
    });

    let catalog = readRuntimeAgentCatalog(projectRoot);
    let updated = catalog.roles.find((role) => role.agentId === 'opus');
    assert.ok(updated, 'opus role should still exist');
    assert.deepEqual(updated.variants[0]?.voiceConfig, {
      voice: 'updated-clone',
      langCode: 'zh',
      refAudio: '/uploads/ref-audio-5678-efab.mp3',
      refText: '更新后的参考文本',
    });

    await updateRuntimeAgent(projectRoot, 'opus', { voiceConfig: null });

    catalog = readRuntimeAgentCatalog(projectRoot);
    updated = catalog.roles.find((role) => role.agentId === 'opus');
    assert.ok(updated, 'opus role should still exist after clearing voiceConfig');
    assert.equal(updated.variants[0]?.voiceConfig, undefined);
  });

  it('keeps sessionChain updates scoped to non-default variants', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'agent-catalog-store-'));
    const templatePath = join(projectRoot, 'agent-template.json');
    const template = validConfig();
    template.roles[0].features = { sessionChain: true };
    template.roles[0].variants.push({
      id: 'opus-sonnet',
      agentId: 'opus-sonnet',
      provider: 'anthropic',
      defaultModel: 'claude-sonnet-4-5-20250929',
      mcpSupport: true,
      cli: { command: 'claude', outputFormat: 'stream-json' },
    });
    writeFileSync(templatePath, JSON.stringify(template, null, 2));
    writeAgentCatalog(projectRoot, template);

    await updateRuntimeAgent(projectRoot, 'opus-sonnet', { sessionChain: false });

    const catalog = readRuntimeAgentCatalog(projectRoot);
    const role = catalog.roles.find((item) => item.id === 'lead-architect');
    assert.ok(role, 'lead-architect role should still exist');
    assert.equal(role.features?.sessionChain, true);
    const sonnetVariant = role.variants.find((variant) => variant.id === 'opus-sonnet');
    assert.ok(sonnetVariant, 'opus-sonnet variant should still exist');
    assert.equal(sonnetVariant.sessionChain, false);
    const defaultVariant = role.variants.find((variant) => variant.id === 'opus-default');
    assert.ok(defaultVariant, 'opus-default variant should still exist');
    assert.equal(defaultVariant.sessionChain, undefined);
  });

  it('keeps roleDescription updates scoped to non-default variants', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'agent-catalog-store-'));
    const templatePath = join(projectRoot, 'agent-template.json');
    const template = validConfig();
    template.roles[0].variants.push({
      id: 'opus-sonnet',
      agentId: 'opus-sonnet',
      provider: 'anthropic',
      defaultModel: 'claude-sonnet-4-5-20250929',
      mcpSupport: true,
      cli: { command: 'claude', outputFormat: 'stream-json' },
    });
    writeFileSync(templatePath, JSON.stringify(template, null, 2));
    writeAgentCatalog(projectRoot, template);

    await updateRuntimeAgent(projectRoot, 'opus-sonnet', { roleDescription: '副手架构师' });

    const catalog = readRuntimeAgentCatalog(projectRoot);
    const role = catalog.roles.find((item) => item.id === 'lead-architect');
    assert.ok(role, 'lead-architect role should still exist');
    assert.equal(role.roleDescription, '主架构师');
    const sonnetVariant = role.variants.find((variant) => variant.id === 'opus-sonnet');
    assert.ok(sonnetVariant, 'opus-sonnet variant should still exist');
    assert.equal(sonnetVariant.roleDescription, '副手架构师');
    const defaultVariant = role.variants.find((variant) => variant.id === 'opus-default');
    assert.ok(defaultVariant, 'opus-default variant should still exist');
    assert.equal(defaultVariant.roleDescription, undefined);
  });

  it('keeps roleDescription updates scoped to the default variant', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'agent-catalog-store-'));
    const templatePath = join(projectRoot, 'agent-template.json');
    const template = validConfig();
    template.roles[0].variants.push({
      id: 'opus-sonnet',
      agentId: 'opus-sonnet',
      provider: 'anthropic',
      defaultModel: 'claude-sonnet-4-5-20250929',
      mcpSupport: true,
      cli: { command: 'claude', outputFormat: 'stream-json' },
    });
    writeFileSync(templatePath, JSON.stringify(template, null, 2));
    writeAgentCatalog(projectRoot, template);

    await updateRuntimeAgent(projectRoot, 'opus', { roleDescription: '默认成员专属职责' });

    const catalog = readRuntimeAgentCatalog(projectRoot);
    const role = catalog.roles.find((item) => item.id === 'lead-architect');
    assert.ok(role, 'lead-architect role should still exist');
    assert.equal(role.roleDescription, '主架构师');
    const defaultVariant = role.variants.find((variant) => variant.id === 'opus-default');
    assert.ok(defaultVariant, 'opus-default variant should still exist');
    assert.equal(defaultVariant.roleDescription, '默认成员专属职责');
    const sonnetVariant = role.variants.find((variant) => variant.id === 'opus-sonnet');
    assert.ok(sonnetVariant, 'opus-sonnet variant should still exist');
    assert.equal(sonnetVariant.roleDescription, undefined);
  });

  it('keeps sessionChain updates scoped to the default variant', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'agent-catalog-store-'));
    const templatePath = join(projectRoot, 'agent-template.json');
    const template = validConfig();
    template.roles[0].features = { sessionChain: true };
    template.roles[0].variants.push({
      id: 'opus-sonnet',
      agentId: 'opus-sonnet',
      provider: 'anthropic',
      defaultModel: 'claude-sonnet-4-5-20250929',
      mcpSupport: true,
      cli: { command: 'claude', outputFormat: 'stream-json' },
    });
    writeFileSync(templatePath, JSON.stringify(template, null, 2));
    writeAgentCatalog(projectRoot, template);

    await updateRuntimeAgent(projectRoot, 'opus', { sessionChain: false });

    const catalog = readRuntimeAgentCatalog(projectRoot);
    const role = catalog.roles.find((item) => item.id === 'lead-architect');
    assert.ok(role, 'lead-architect role should still exist');
    assert.equal(role.features?.sessionChain, true);
    const defaultVariant = role.variants.find((variant) => variant.id === 'opus-default');
    assert.ok(defaultVariant, 'opus-default variant should still exist');
    assert.equal(defaultVariant.sessionChain, false);
    const sonnetVariant = role.variants.find((variant) => variant.id === 'opus-sonnet');
    assert.ok(sonnetVariant, 'opus-sonnet variant should still exist');
    assert.equal(sonnetVariant.sessionChain, undefined);
  });

  it('does not overwrite runtime catalog when validation fails', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'agent-catalog-store-'));
    const templatePath = join(projectRoot, 'agent-template.json');
    writeFileSync(templatePath, JSON.stringify(validConfig(), null, 2));
    writeAgentCatalog(projectRoot, validConfig());

    // Trigger eager migration (F136 Phase 4d backfills accountRef on first read)
    readRuntimeAgentCatalog(projectRoot);
    const catalogPath = resolveAgentCatalogPath(projectRoot);
    const beforeRaw = readFileSync(catalogPath, 'utf-8');

    // Empty defaultModel is now allowed (OAuth/subscription CLIs use built-in defaults;
    // api_key accounts are validated at the route level in validateAccountBindingOrThrow).
    updateRuntimeAgent(projectRoot, 'opus', { defaultModel: '' });
    const afterRaw = readFileSync(catalogPath, 'utf-8');
    const afterConfig = JSON.parse(afterRaw);
    const variant = afterConfig.roles[0].variants[0];
    assert.equal(variant.defaultModel, '', 'empty defaultModel should persist for OAuth accounts');
  });

  it('rejects runtime members that reuse an alias from another agent', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'agent-catalog-store-'));
    const templatePath = join(projectRoot, 'agent-template.json');
    writeFileSync(templatePath, JSON.stringify(validConfig(), null, 2));
    writeAgentCatalog(projectRoot, validConfig());

    // Trigger eager migration (F136 Phase 4d backfills accountRef on first read)
    readRuntimeAgentCatalog(projectRoot);
    const catalogPath = resolveAgentCatalogPath(projectRoot);
    const beforeRaw = readFileSync(catalogPath, 'utf-8');

    assert.throws(() => {
      createRuntimeAgent(projectRoot, {
        agentId: 'spark-lite',
        roleId: 'spark-lite',
        name: '火花智能体',
        displayName: '火花智能体',
        avatar: '/avatars/spark.png',
        color: { primary: '#f97316', secondary: '#fed7aa' },
        mentionPatterns: ['@opus', '@spark-lite'],
        roleDescription: '快速执行',
        clientId: 'openai',
        defaultModel: 'gpt-5.4',
        mcpSupport: false,
        cli: { command: 'codex', outputFormat: 'json' },
      });
    }, /mention alias "@opus" is already used by agent "opus"/i);

    const afterRaw = readFileSync(catalogPath, 'utf-8');
    assert.equal(afterRaw, beforeRaw, 'failed create must not mutate runtime catalog');
  });

  it('deletes a runtime-created member without touching the rest of the catalog', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'agent-catalog-store-'));
    const templatePath = join(projectRoot, 'agent-template.json');
    writeFileSync(templatePath, JSON.stringify(validConfig(), null, 2));
    writeAgentCatalog(projectRoot, validConfig());

    await createRuntimeAgent(projectRoot, {
      agentId: 'temp-agent',
      roleId: 'temp-agent',
      name: '临时智能体',
      displayName: '临时智能体',
      avatar: '/avatars/temp.png',
      color: { primary: '#64748b', secondary: '#cbd5e1' },
      mentionPatterns: ['@temp-agent'],
      roleDescription: '临时成员',
      personality: '临时',
      clientId: 'dare',
      defaultModel: 'dare-1',
      mcpSupport: false,
      cli: { command: 'dare', outputFormat: 'json' },
    });

    await deleteRuntimeAgent(projectRoot, 'temp-agent');

    const catalog = readRuntimeAgentCatalog(projectRoot);
    assert.equal(
      catalog.roles.some((role) => role.agentId === 'temp-agent'),
      false,
    );
    assert.equal(
      catalog.roles.some((role) => role.agentId === 'opus'),
      true,
    );
    assert.ok(catalog.roster?.opus, 'existing v2 metadata must stay intact');
  });

  it('allows deletion of any agent regardless of legacy source field', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'agent-catalog-store-delete-any-'));
    const templatePath = join(projectRoot, 'agent-template.json');
    writeFileSync(templatePath, JSON.stringify(validConfig(), null, 2));
    writeAgentCatalog(projectRoot, validConfig());

    deleteRuntimeAgent(projectRoot, 'opus');

    const catalog = readRuntimeAgentCatalog(projectRoot);
    assert.equal(
      catalog.roles.some((role) => role.agentId === 'opus'),
      false,
    );
  });

  it('ignores sibling AGENT_TEMPLATE_PATH prefixes during runtime agent operations', async () => {
    const parentRoot = mkdtempSync(join(tmpdir(), 'agent-catalog-store-boundary-'));
    const projectRoot = join(parentRoot, 'baiyuxi-agent-studio');
    const siblingRoot = join(parentRoot, 'baiyuxi-agent-studio-old');
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(siblingRoot, { recursive: true });

    const templatePath = join(projectRoot, 'agent-template.json');
    const siblingTemplatePath = join(siblingRoot, 'agent-template.json');
    writeFileSync(templatePath, JSON.stringify(validConfig(), null, 2));
    writeFileSync(siblingTemplatePath, JSON.stringify(makeSiblingTemplate('shadow-seed'), null, 2));
    writeAgentCatalog(projectRoot, validConfig());

    const previousTemplatePath = process.env.AGENT_TEMPLATE_PATH;
    process.env.AGENT_TEMPLATE_PATH = siblingTemplatePath;
    try {
      await createRuntimeAgent(projectRoot, {
        agentId: 'temp-agent',
        roleId: 'temp-agent',
        name: '临时智能体',
        displayName: '临时智能体',
        avatar: '/avatars/temp.png',
        color: { primary: '#64748b', secondary: '#cbd5e1' },
        mentionPatterns: ['@temp-agent'],
        roleDescription: '临时成员',
        personality: '临时',
        clientId: 'dare',
        defaultModel: 'dare-1',
        mcpSupport: false,
        cli: { command: 'dare', outputFormat: 'json' },
      });
    } finally {
      if (previousTemplatePath === undefined) delete process.env.AGENT_TEMPLATE_PATH;
      else process.env.AGENT_TEMPLATE_PATH = previousTemplatePath;
    }

    const catalog = readRuntimeAgentCatalog(projectRoot);
    assert.equal(
      catalog.roles.some((role) => role.agentId === 'opus'),
      true,
      'local catalog roles should be preserved',
    );
    assert.equal(
      catalog.roles.some((role) => role.agentId === 'shadow-seed'),
      false,
      'sibling template must not leak into this project',
    );
  });

  it('does not treat sibling-template seeds as local seeds during delete checks', async () => {
    const parentRoot = mkdtempSync(join(tmpdir(), 'agent-catalog-store-delete-boundary-'));
    const projectRoot = join(parentRoot, 'baiyuxi-agent-studio');
    const siblingRoot = join(parentRoot, 'baiyuxi-agent-studio-old');
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(siblingRoot, { recursive: true });

    const templatePath = join(projectRoot, 'agent-template.json');
    const siblingTemplatePath = join(siblingRoot, 'agent-template.json');
    writeFileSync(templatePath, JSON.stringify(validConfig(), null, 2));
    writeFileSync(siblingTemplatePath, JSON.stringify(makeSiblingTemplate('shadow-seed'), null, 2));
    writeAgentCatalog(projectRoot, validConfig());

    await createRuntimeAgent(projectRoot, {
      agentId: 'shadow-seed',
      roleId: 'shadow-seed',
      name: '影子临时智能体',
      displayName: '影子临时智能体',
      avatar: '/avatars/shadow.png',
      color: { primary: '#334155', secondary: '#cbd5f5' },
      mentionPatterns: ['@shadow-seed'],
      roleDescription: '用于路径边界验证',
      clientId: 'dare',
      defaultModel: 'dare-1',
      mcpSupport: false,
      cli: { command: 'dare', outputFormat: 'json' },
    });

    const previousTemplatePath = process.env.AGENT_TEMPLATE_PATH;
    process.env.AGENT_TEMPLATE_PATH = siblingTemplatePath;
    try {
      await deleteRuntimeAgent(projectRoot, 'shadow-seed');
    } finally {
      if (previousTemplatePath === undefined) delete process.env.AGENT_TEMPLATE_PATH;
      else process.env.AGENT_TEMPLATE_PATH = previousTemplatePath;
    }

    const catalog = readRuntimeAgentCatalog(projectRoot);
    assert.equal(
      catalog.roles.some((role) => role.agentId === 'shadow-seed'),
      false,
      'runtime agent matching a sibling seed id should still be deletable',
    );
  });

  // baiyuxi-agent-studio#340: removed api_key bootstrap model fallback test — filterBootstrapCatalog + bootstrapBindings deleted

  it('drops legacy variants whose agentId is a standalone role in the template', () => {
    // Real-world repro: template has been updated to a new shape (opus-47 promoted to
    // its own top-level role), but the runtime catalog is still on the *old* shape
    // (opus-47 nested under lead-architect.variants). Without consulting template role.ids,
    // migration would not detect the legacy variant — toAllAgentConfigs() then throws
    // Duplicate agentId once template+catalog are deep-merged.
    const projectRoot = mkdtempSync(join(tmpdir(), 'agent-catalog-store-template-driven-'));
    const templatePath = join(projectRoot, 'agent-template.json');

    // Template = new shape with opus-47 as a standalone role
    const templateConfig = validConfig();
    templateConfig.roles.push({
      id: 'opus-47',
      agentId: 'opus-47',
      name: 'Lead Architect Opus 4.7',
      displayName: 'Lead Architect',
      avatar: '/avatars/opus-47.png',
      color: { primary: '#7B1FA2', secondary: '#E1BEE7' },
      mentionPatterns: ['@opus-47'],
      roleDescription: 'Opus 4.7',
      defaultVariantId: 'opus-47-default',
      variants: [
        {
          id: 'opus-47-default',
          agentId: 'opus-47',
          clientId: 'anthropic',
          defaultModel: 'claude-opus-4-7',
          mcpSupport: true,
          cli: { command: 'claude', outputFormat: 'stream-json' },
        },
      ],
    });
    writeFileSync(templatePath, JSON.stringify(templateConfig, null, 2));

    // Runtime catalog = legacy shape — opus-47 still nested under lead-architect, NO standalone role
    const runtimeConfig = validConfig();
    runtimeConfig.roles[0].variants.push({
      id: 'legacy-opus-47',
      agentId: 'opus-47',
      variantLabel: 'Opus 4.7 (legacy)',
      displayName: 'Lead Architect',
      mentionPatterns: ['@opus-47'],
      provider: 'anthropic',
      defaultModel: 'claude-opus-4-7',
      mcpSupport: true,
      cli: { command: 'claude', outputFormat: 'stream-json' },
    });
    mkdirSync(join(projectRoot, '.agent-studio'), { recursive: true });
    writeFileSync(join(projectRoot, '.agent-studio', 'agent-catalog.json'), JSON.stringify(runtimeConfig, null, 2));

    bootstrapAgentCatalog(projectRoot, templatePath);
    const hydrated = JSON.parse(readFileSync(resolveAgentCatalogPath(projectRoot), 'utf-8'));

    const leadArchitect = hydrated.roles.find((b) => b.id === 'lead-architect');
    assert.equal(
      leadArchitect.variants.find((v) => v.agentId === 'opus-47'),
      undefined,
      'legacy lead-architect/variants[opus-47] should be removed because template promoted opus-47 to its own role',
    );
    // Default variant whose agentId matches its own role must NOT be dropped
    assert.ok(
      leadArchitect.variants.find((v) => v.id === 'opus-default'),
      'opus-default (agentId matches own role) should be preserved',
    );
    // Catalog itself does NOT need to grow the standalone role — deep merge with
    // template will surface it. Migration is purely about removing the legacy duplicate.
    assert.equal(
      hydrated.roles.find((b) => b.id === 'opus-47'),
      undefined,
      'catalog should not grow the standalone role by itself; deep merge handles that',
    );
  });
});
