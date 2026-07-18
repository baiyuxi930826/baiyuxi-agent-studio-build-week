import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  AGENT_KEY_TOOLS,
  applyReadonlyFilter,
  buildCollabTools,
  buildLimbTools,
  buildMemoryTools,
  DESKTOP_FABLE_PHASE0_ALLOWED_TOOLS,
  parseToolsetEnv,
  READONLY_ALLOWED_TOOLS,
  type ToolsetEnv,
} from '../src/server-toolsets.js';

const fakeTool = (name: string) => ({
  name,
  description: `desc:${name}`,
  inputSchema: {},
  handler: async () => ({ content: [] }),
});

const ALL_FAKE_NAMES = [
  // collab
  'agent_studio_post_message',
  'agent_studio_cross_post_message',
  'agent_studio_create_rich_block',
  'agent_studio_get_thread_context',
  'agent_studio_list_threads',
  'agent_studio_get_message',
  'agent_studio_publish_verdict',
  'agent_studio_backfill_events',
  'agent_studio_workspace_navigate',
  'agent_studio_preview_open',
  'agent_studio_teleport',
  'agent_studio_list_events',
  'agent_studio_register_external_runtime_session',
  'agent_studio_shell_exec',
  // memory
  'agent_studio_search_evidence',
  'agent_studio_graph_resolve',
  'agent_studio_list_recent',
  'agent_studio_list_session_chain',
  'agent_studio_read_session_digest',
  'agent_studio_read_session_events',
  'agent_studio_read_invocation_detail',
  'agent_studio_read_file_slice',
  'agent_studio_run_perspective',
  'agent_studio_list_external_runtime_sessions',
  'agent_studio_read_external_runtime_session',
  // outside any whitelist
  'agent_studio_create_task',
  'agent_studio_hold_ball',
];

const ALL_FAKE_TOOLS = ALL_FAKE_NAMES.map(fakeTool);

describe('applyReadonlyFilter — env modes', () => {
  it('no env at all (default) → pass-through, all tools kept', () => {
    const env: ToolsetEnv = {};
    const out = applyReadonlyFilter(ALL_FAKE_TOOLS, env);
    assert.equal(out.length, ALL_FAKE_TOOLS.length);
  });

  it('readonly=true, no agent-key → only READONLY_ALLOWED_TOOLS', () => {
    const env: ToolsetEnv = { readonly: true };
    const out = applyReadonlyFilter(ALL_FAKE_TOOLS, env);
    const outNames = new Set(out.map((t) => t.name));
    for (const name of ALL_FAKE_NAMES) {
      const expected = READONLY_ALLOWED_TOOLS.has(name);
      assert.equal(outNames.has(name), expected, `tool ${name}: expected ${expected}`);
    }
  });

  it('readonly=true + hasAgentKey=true → READONLY ∪ AGENT_KEY', () => {
    const env: ToolsetEnv = { readonly: true, hasAgentKey: true };
    const out = applyReadonlyFilter(ALL_FAKE_TOOLS, env);
    const outNames = new Set(out.map((t) => t.name));
    for (const name of ALL_FAKE_NAMES) {
      const expected = READONLY_ALLOWED_TOOLS.has(name) || AGENT_KEY_TOOLS.has(name);
      assert.equal(outNames.has(name), expected, `tool ${name}: expected ${expected}`);
    }
  });

  it('desktopMode=fable-phase0 → only DESKTOP_FABLE_PHASE0_ALLOWED_TOOLS (mode precedence)', () => {
    const env: ToolsetEnv = { desktopMode: 'fable-phase0' };
    const out = applyReadonlyFilter(ALL_FAKE_TOOLS, env);
    const outNames = new Set(out.map((t) => t.name));
    for (const name of ALL_FAKE_NAMES) {
      const expected = DESKTOP_FABLE_PHASE0_ALLOWED_TOOLS.has(name);
      assert.equal(outNames.has(name), expected, `tool ${name}: expected ${expected}`);
    }
  });

  it('desktopMode highest precedence — NOT union with READONLY/AGENT_KEY', () => {
    // shell_exec is in READONLY_ALLOWED, but must NOT appear under fable-phase0
    const env: ToolsetEnv = {
      desktopMode: 'fable-phase0',
      readonly: true,
      hasAgentKey: true,
    };
    const out = applyReadonlyFilter(ALL_FAKE_TOOLS, env);
    const outNames = new Set(out.map((t) => t.name));
    assert.equal(outNames.has('agent_studio_shell_exec'), false, 'shell_exec must not leak via READONLY');
    assert.equal(outNames.has('agent_studio_read_file_slice'), false, 'read_file_slice must not leak via READONLY');
    assert.equal(outNames.has('agent_studio_publish_verdict'), false, 'publish_verdict must not leak via AGENT_KEY');
    assert.equal(outNames.has('agent_studio_backfill_events'), false, 'backfill must not leak via AGENT_KEY');
    assert.equal(
      outNames.has('agent_studio_workspace_navigate'),
      false,
      'workspace_navigate must not leak via AGENT_KEY',
    );
    assert.equal(outNames.has('agent_studio_teleport'), false, 'teleport must not leak via AGENT_KEY');
    assert.equal(
      outNames.has('agent_studio_create_rich_block'),
      false,
      'create_rich_block must not leak via AGENT_KEY',
    );
    // 10 项白名单全在
    assert.equal(outNames.has('agent_studio_post_message'), true);
    assert.equal(outNames.has('agent_studio_search_evidence'), true);
    // V2→V3 adjustment §1: raw transcript/invocation detail 不在白名单
    assert.equal(outNames.has('agent_studio_read_session_events'), false, 'read_session_events excluded (V3 §1)');
    assert.equal(outNames.has('agent_studio_read_invocation_detail'), false, 'read_invocation_detail excluded (V3 §1)');
  });

  it('unknown desktopMode → fail-fast throw (codex adjustment §3)', () => {
    const env: ToolsetEnv = { desktopMode: 'unknown-profile' };
    assert.throws(
      () => applyReadonlyFilter(ALL_FAKE_TOOLS, env),
      /Unknown AGENT_STUDIO_DESKTOP_MODE: "unknown-profile"/,
    );
  });

  it('unknown desktopMode throws even with readonly/agent-key set', () => {
    const env: ToolsetEnv = { desktopMode: 'typo', readonly: true, hasAgentKey: true };
    assert.throws(() => applyReadonlyFilter(ALL_FAKE_TOOLS, env), /Unknown AGENT_STUDIO_DESKTOP_MODE/);
  });
});

describe('DESKTOP_FABLE_PHASE0_ALLOWED_TOOLS — V3 spec', () => {
  it('contains exactly 10 tools', () => {
    assert.equal(DESKTOP_FABLE_PHASE0_ALLOWED_TOOLS.size, 10, 'V3 spec locked at 10 tools');
  });

  it('contains 5 collab message tools + 5 memory cold-start tools', () => {
    const expected = [
      // collab
      'agent_studio_post_message',
      'agent_studio_cross_post_message',
      'agent_studio_get_thread_context',
      'agent_studio_list_threads',
      'agent_studio_get_message',
      // memory
      'agent_studio_search_evidence',
      'agent_studio_graph_resolve',
      'agent_studio_list_recent',
      'agent_studio_list_session_chain',
      'agent_studio_read_session_digest',
    ];
    for (const name of expected) {
      assert.equal(DESKTOP_FABLE_PHASE0_ALLOWED_TOOLS.has(name), true, `expected ${name} in whitelist`);
    }
  });

  it('explicitly excludes V1 P0 blockers (shell_exec, read_file_slice)', () => {
    assert.equal(DESKTOP_FABLE_PHASE0_ALLOWED_TOOLS.has('agent_studio_shell_exec'), false);
    assert.equal(DESKTOP_FABLE_PHASE0_ALLOWED_TOOLS.has('agent_studio_read_file_slice'), false);
  });

  it('explicitly excludes V2→V3 §1 adjustments (raw transcript)', () => {
    assert.equal(DESKTOP_FABLE_PHASE0_ALLOWED_TOOLS.has('agent_studio_read_session_events'), false);
    assert.equal(DESKTOP_FABLE_PHASE0_ALLOWED_TOOLS.has('agent_studio_read_invocation_detail'), false);
  });

  it('explicitly excludes out-of-scope writes (publish_verdict, backfill, hub actions)', () => {
    const excluded = [
      'agent_studio_publish_verdict',
      'agent_studio_backfill_events',
      'agent_studio_workspace_navigate',
      'agent_studio_preview_open',
      'agent_studio_teleport',
      'agent_studio_register_external_runtime_session',
      'agent_studio_run_perspective',
      'agent_studio_create_rich_block',
      'agent_studio_list_events',
      'agent_studio_list_external_runtime_sessions',
      'agent_studio_read_external_runtime_session',
    ];
    for (const name of excluded) {
      assert.equal(DESKTOP_FABLE_PHASE0_ALLOWED_TOOLS.has(name), false, `${name} must be excluded from Phase 0`);
    }
  });
});

describe('parseToolsetEnv — env shape', () => {
  it('detects AGENT_STUDIO_READONLY=true', () => {
    const env = parseToolsetEnv({ AGENT_STUDIO_READONLY: 'true' } as NodeJS.ProcessEnv);
    assert.equal(env.readonly, true);
    assert.equal(env.hasAgentKey, false);
    assert.equal(env.desktopMode, undefined);
  });

  it('does NOT treat AGENT_STUDIO_READONLY=1 as true (strict string match)', () => {
    const env = parseToolsetEnv({ AGENT_STUDIO_READONLY: '1' } as NodeJS.ProcessEnv);
    assert.equal(env.readonly, false);
  });

  it('detects agent-key via any of the 3 env vars', () => {
    assert.equal(parseToolsetEnv({ AGENT_STUDIO_AGENT_KEY_SECRET: 's' } as NodeJS.ProcessEnv).hasAgentKey, true);
    assert.equal(parseToolsetEnv({ AGENT_STUDIO_AGENT_KEY_FILE: '/p' } as NodeJS.ProcessEnv).hasAgentKey, true);
    assert.equal(parseToolsetEnv({ AGENT_STUDIO_AGENT_KEY_FILES: '{}' } as NodeJS.ProcessEnv).hasAgentKey, true);
  });

  it('trims desktopMode + treats empty/whitespace as undefined', () => {
    assert.equal(parseToolsetEnv({} as NodeJS.ProcessEnv).desktopMode, undefined);
    assert.equal(parseToolsetEnv({ AGENT_STUDIO_DESKTOP_MODE: '   ' } as NodeJS.ProcessEnv).desktopMode, undefined);
    assert.equal(
      parseToolsetEnv({ AGENT_STUDIO_DESKTOP_MODE: '  fable-phase0  ' } as NodeJS.ProcessEnv).desktopMode,
      'fable-phase0',
    );
  });
});

describe('buildLimbTools — F178 Phase D cloud-review P1 (limb defense-in-depth)', () => {
  it('default env: limb tools fully exposed (antigravity contract intact)', () => {
    const out = buildLimbTools({});
    assert.ok(out.length > 0, 'limb tools must be available by default for antigravity');
  });

  it('readonly + agent-key env (antigravity profile): limb still exposed', () => {
    const out = buildLimbTools({ readonly: true, hasAgentKey: true });
    assert.ok(out.length > 0, 'antigravity readonly + agent-key must still get limb tools');
  });

  it('desktopMode=fable-phase0: limb tools fully denied (strict whitelist)', () => {
    const out = buildLimbTools({ desktopMode: 'fable-phase0' });
    assert.equal(out.length, 0, 'fable Desktop must NOT expose limb_invoke / limb_pair_approve');
  });

  it('desktopMode=fable-phase0 + readonly + agent-key: still denied (mode highest precedence)', () => {
    const out = buildLimbTools({ desktopMode: 'fable-phase0', readonly: true, hasAgentKey: true });
    assert.equal(
      out.length,
      0,
      'mode precedence MUST hold even with agent-key — defense-in-depth for legacy createServer path',
    );
  });

  it('unknown desktopMode → throw fail-fast (cloud-review round 3 P2)', () => {
    // Standalone limb.ts entry path must NOT silently register full limb
    // surface when DESKTOP_MODE is mistyped (e.g. env var set globally).
    assert.throws(() => buildLimbTools({ desktopMode: 'fable-phaseO' }), /Unknown AGENT_STUDIO_DESKTOP_MODE/);
  });

  it('unknown desktopMode + readonly + agent-key → still throws', () => {
    assert.throws(
      () => buildLimbTools({ desktopMode: 'oopsie', readonly: true, hasAgentKey: true }),
      /Unknown AGENT_STUDIO_DESKTOP_MODE/,
    );
  });
});

describe('buildCollabTools / buildMemoryTools — real toolset assertions (codex §4)', () => {
  it('Desktop mode collab: only 5 collab tools registered', () => {
    const env: ToolsetEnv = { desktopMode: 'fable-phase0' };
    const out = buildCollabTools(env);
    const outNames = new Set(out.map((t) => t.name));
    const expectedCollab = [
      'agent_studio_post_message',
      'agent_studio_cross_post_message',
      'agent_studio_get_thread_context',
      'agent_studio_list_threads',
      'agent_studio_get_message',
    ];
    for (const name of expectedCollab) {
      assert.equal(outNames.has(name), true, `${name} expected in Desktop collab`);
    }
    // Dangerous tools absent
    assert.equal(outNames.has('agent_studio_shell_exec'), false);
    assert.equal(outNames.has('agent_studio_publish_verdict'), false);
    assert.equal(outNames.has('agent_studio_backfill_events'), false);
    assert.equal(outNames.has('agent_studio_workspace_navigate'), false);
    assert.equal(outNames.has('agent_studio_teleport'), false);
    // Memory tools should NOT bleed into collab build
    assert.equal(outNames.has('agent_studio_search_evidence'), false);
  });

  it('Desktop mode memory: only 5 memory tools registered', () => {
    const env: ToolsetEnv = { desktopMode: 'fable-phase0' };
    const out = buildMemoryTools(env);
    const outNames = new Set(out.map((t) => t.name));
    const expectedMemory = [
      'agent_studio_search_evidence',
      'agent_studio_graph_resolve',
      'agent_studio_list_recent',
      'agent_studio_list_session_chain',
      'agent_studio_read_session_digest',
    ];
    for (const name of expectedMemory) {
      assert.equal(outNames.has(name), true, `${name} expected in Desktop memory`);
    }
    // Dangerous tools absent
    assert.equal(outNames.has('agent_studio_read_file_slice'), false);
    assert.equal(outNames.has('agent_studio_read_session_events'), false);
    assert.equal(outNames.has('agent_studio_read_invocation_detail'), false);
    // Collab tools should NOT bleed into memory build
    assert.equal(outNames.has('agent_studio_post_message'), false);
  });

  it('legacy READONLY=true + AGENT_KEY: existing collab behavior unchanged (no regression)', () => {
    const env: ToolsetEnv = { readonly: true, hasAgentKey: true };
    const out = buildCollabTools(env);
    const outNames = new Set(out.map((t) => t.name));
    // AGENT_KEY tools allowed
    assert.equal(outNames.has('agent_studio_post_message'), true);
    assert.equal(outNames.has('agent_studio_publish_verdict'), true);
    // READONLY tools allowed
    assert.equal(outNames.has('agent_studio_shell_exec'), true);
  });

  it('default (no env) collab/memory build pass-through full source', () => {
    const collab = buildCollabTools({});
    const memory = buildMemoryTools({});
    const collabNames = new Set(collab.map((t) => t.name));
    const memoryNames = new Set(memory.map((t) => t.name));
    // Sanity: real toolset includes these baseline tools
    assert.equal(collabNames.has('agent_studio_post_message'), true);
    assert.equal(memoryNames.has('agent_studio_search_evidence'), true);
  });
});
