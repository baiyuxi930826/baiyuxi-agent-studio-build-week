import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { agentRegistry } from '../dist/registry/AgentRegistry.js';
import { normalizeAgentId } from '../dist/registry/normalize-agent-id.js';
import { createAgentId } from '../dist/types/ids.js';

/** Minimal agent config fixture for testing */
const TEST_CAT_FIXTURES = {
  opus: {
    id: createAgentId('opus'),
    name: 'Lead Architect',
    displayName: 'Lead Architect',
    nickname: '宪宪',
    avatar: '/avatars/opus.png',
    color: { primary: '#9B7EBD', secondary: '#E8D5F5' },
    mentionPatterns: ['@opus', '@Lead Architect', '@宪宪'],
    clientId: 'anthropic',
    defaultModel: 'claude-sonnet-4-20250514',
    mcpSupport: true,
    roleDescription: 'Lead architect',
    personality: 'thoughtful',
  },
  codex: {
    id: createAgentId('codex'),
    name: 'Code Reviewer',
    displayName: 'Code Reviewer',
    nickname: '砚砚',
    avatar: '/avatars/codex.png',
    color: { primary: '#5B8C5A', secondary: '#D0E8CF' },
    mentionPatterns: ['@codex', '@Code Reviewer', '@砚砚'],
    clientId: 'openai',
    defaultModel: 'o3-mini',
    mcpSupport: true,
    roleDescription: 'Code reviewer',
    personality: 'meticulous',
  },
  gemini25: {
    id: createAgentId('gemini25'),
    name: 'Frontend Designer',
    displayName: 'Frontend Designer',
    nickname: '烁烁',
    avatar: '/avatars/gemini25.png',
    color: { primary: '#42A5F5', secondary: '#BBDEFB' },
    mentionPatterns: ['@gemini25', '@gemini-25', '@Andygemini25'],
    clientId: 'google',
    defaultModel: 'gemini-3.5-flash',
    mcpSupport: true,
    roleDescription: 'Creative visual designer',
    personality: 'energetic',
  },
  gemini35: {
    id: createAgentId('gemini35'),
    name: 'Frontend Designer',
    displayName: 'Frontend Designer Gemini 3.5',
    nickname: '烁烁',
    avatar: '/avatars/gemini35.png',
    color: { primary: '#42A5F5', secondary: '#BBDEFB' },
    mentionPatterns: ['@gemini35', '@gemini-35', '@gemini3.5', '@flash', '@Andyflash', '@Andygemini35'],
    clientId: 'google',
    defaultModel: 'Gemini 3.5 Flash (High)',
    mcpSupport: true,
    roleDescription: 'Creative visual designer',
    personality: 'energetic',
  },
};

/** Build a AgentConfig from test fixtures + overrides */
function makeAgentConfig(base, overrides = {}) {
  return { ...TEST_CAT_FIXTURES[base], ...overrides };
}

describe('normalizeAgentId (F154 AC-A3, AC-A7)', () => {
  before(() => {
    agentRegistry.reset();
    agentRegistry.register('opus', makeAgentConfig('opus'));
    agentRegistry.register(
      'opus-45',
      makeAgentConfig('opus', {
        id: createAgentId('opus-45'),
        name: 'Lead Architect Opus 4.5',
        displayName: 'Lead Architect Opus 4.5',
        nickname: undefined,
        mentionPatterns: ['@opus-45'],
      }),
    );
    agentRegistry.register('codex', makeAgentConfig('codex'));
    agentRegistry.register('gemini25', makeAgentConfig('gemini25'));
    agentRegistry.register('gemini35', makeAgentConfig('gemini35'));
  });
  after(() => agentRegistry.reset());

  // --- Exact agentId match ---
  it('exact agentId → ok', () => {
    const r = normalizeAgentId('opus');
    assert.equal(r.ok, true);
    assert.equal(r.agentId, 'opus');
  });

  // --- Exact alias match (strip @) ---
  it('alias with @ prefix → ok', () => {
    const r = normalizeAgentId('@宪宪');
    assert.equal(r.ok, true);
    assert.equal(r.agentId, 'opus');
  });

  it('alias without @ → ok', () => {
    const r = normalizeAgentId('宪宪');
    assert.equal(r.ok, true);
    assert.equal(r.agentId, 'opus');
  });

  // --- Case insensitive ---
  it('case insensitive alias → ok', () => {
    const r = normalizeAgentId('Opus');
    assert.equal(r.ok, true);
    assert.equal(r.agentId, 'opus');
  });

  it('case insensitive @ alias → ok', () => {
    const r = normalizeAgentId('@Codex');
    assert.equal(r.ok, true);
    assert.equal(r.agentId, 'codex');
  });

  // --- Gemini 3.5 alias tests ---
  it('gemini35 alias resolves to standalone gemini35 role (not gemini25)', () => {
    const r1 = normalizeAgentId('@gemini35');
    assert.equal(r1.ok, true);
    assert.equal(r1.agentId, 'gemini35');

    const r2 = normalizeAgentId('gemini-35');
    assert.equal(r2.ok, true);
    assert.equal(r2.agentId, 'gemini35');

    // Legacy alias preserved: @Andygemini35 was on gemini25, now belongs to gemini35
    const r3 = normalizeAgentId('@Andygemini35');
    assert.equal(r3.ok, true);
    assert.equal(r3.agentId, 'gemini35');

    const r4 = normalizeAgentId('@gemini25');
    assert.equal(r4.ok, true);
    assert.equal(r4.agentId, 'gemini25');
  });

  // --- Not found ---
  it('unknown name → not-found', () => {
    const r = normalizeAgentId('unknown');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'not-found');
  });

  // --- Ambiguous partial match (AC-A7: reject + candidate list) ---
  it('ambiguous partial displayName → candidates list', () => {
    // "智能体" matches opus ("Lead Architect"), opus-45 ("Lead Architect Opus 4.5"), codex ("Code Reviewer")
    // and is NOT an exact alias for any agent → triggers partial match ambiguity
    const r = normalizeAgentId('智能体');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'ambiguous');
    assert.ok(r.candidates.length >= 2);
    assert.ok(r.candidates.includes('opus'));
    assert.ok(r.candidates.includes('codex'));
  });

  // --- Exact alias wins over partial displayName (AC-A7) ---
  it('exact alias "opus" wins over partial displayName match', () => {
    // "opus" is an exact agentId AND partial match for "Lead Architect Opus 4.5"
    // exact agentId should win
    const r = normalizeAgentId('opus');
    assert.equal(r.ok, true);
    assert.equal(r.agentId, 'opus');
  });

  // --- Nickname partial match (single) ---
  it('unique nickname partial → ok', () => {
    const r = normalizeAgentId('砚砚');
    assert.equal(r.ok, true);
    assert.equal(r.agentId, 'codex');
  });

  // --- Empty input ---
  it('empty string → not-found', () => {
    const r = normalizeAgentId('');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'not-found');
  });
});

describe('normalizeAgentId partial registry hardening', () => {
  before(() => {
    agentRegistry.reset();
    agentRegistry.register('opus', makeAgentConfig('opus'));
    agentRegistry.register('codex', makeAgentConfig('codex'));
    agentRegistry.register('legacy-partial', {
      id: createAgentId('legacy-partial'),
      name: 'Legacy Partial Agent',
      clientId: 'test-client',
    });
  });
  after(() => agentRegistry.reset());

  it('unknown input ignores partial configs without mentionPatterns', () => {
    const r = normalizeAgentId('nonexistent');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'not-found');
  });

  it('ambiguous input ignores partial configs without displayName', () => {
    const r = normalizeAgentId('智能体');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'ambiguous');
    assert.deepEqual(r.candidates.sort(), ['codex', 'opus']);
  });
});
