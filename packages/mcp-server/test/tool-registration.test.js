/**
 * MCP Tool Registration Tests
 * 回归测试: 确认所有预期工具都注册到 MCP server
 *
 * 背景: request_permission / check_permission_status 的 handler 和 schema
 * 早就存在，但 createServer() 漏了 server.tool() 注册。
 * 本测试守住"注册层"，修复前会 Red，修复后 Green。
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const EXPECTED_TOOLS = [
  // Callback tools (chat + task + ack)
  'agent_studio_post_message',
  'agent_studio_get_pending_mentions',
  'agent_studio_ack_mentions',
  'agent_studio_get_thread_context',
  // #699: Message lookup by ID
  'agent_studio_get_message',
  'agent_studio_get_thread_agents',
  'agent_studio_list_threads',
  'agent_studio_feat_index',
  'agent_studio_cross_post_message',
  'agent_studio_list_tasks',
  'agent_studio_update_task',
  // F160 Phase A: create-task
  'agent_studio_create_task',
  'agent_studio_create_rich_block',
  'agent_studio_generate_document',
  'agent_studio_workspace_navigate',
  'agent_studio_preview_open',
  // F227: generic teleport to a thread message
  'agent_studio_teleport',
  // F227 Task 7: Event Memory timeline read + corpus backfill
  'agent_studio_list_events',
  'agent_studio_backfill_events',
  'agent_studio_get_rich_block_rules',
  'agent_studio_register_pr_tracking',
  'agent_studio_register_issue_tracking',
  'agent_studio_unregister_tracking',
  // F211 Phase B: IDE-direct external runtime session registration
  'agent_studio_register_external_runtime_session',
  // Guide tools (agent_studio_guide_resolve legacy alias removed in F193 Phase D AC-D2)
  'agent_studio_update_guide_state',
  'agent_studio_get_available_guides',
  'agent_studio_start_guide',
  'agent_studio_guide_control',
  // Workflow SOP tools (F073 P1)
  'agent_studio_update_workflow',
  // Multi-mention orchestration (F086 M1)
  'agent_studio_multi_mention',
  // F079 Gap 4: Agent-initiated voting
  'agent_studio_start_vote',
  // Permission tools (this is the regression guard)
  'agent_studio_request_permission',
  'agent_studio_check_permission_status',
  // Bootcamp tools (F087)
  'agent_studio_update_bootcamp_state',
  'agent_studio_bootcamp_env_check',
  // F128: Agent-initiated thread proposal
  'agent_studio_propose_thread',
  // F225: Agent-initiated session handoff proposal
  'agent_studio_propose_session_handoff',
  // F231 Phase C: Agent-initiated profile-update proposal
  'agent_studio_propose_profile_update',
  // Callback-scoped memory tools
  'agent_studio_retain_memory_callback',
  // Direct evidence tools (agent_studio_reflect removed in F193 Phase D AC-D1)
  'agent_studio_search_evidence',
  'agent_studio_run_perspective',
  'agent_studio_read_file_slice',
  // F188 Phase F AC-F1: agent-facing graph navigation
  'agent_studio_graph_resolve',
  // F188 Phase F AC-F2: time-based browse for cold-start
  'agent_studio_list_recent',
  // F188 Phase I AC-I4: library lifecycle MCP tools
  'agent_studio_library_list',
  'agent_studio_library_dry_run',
  'agent_studio_library_create',
  'agent_studio_library_rebuild',
  'agent_studio_library_archive',
  'agent_studio_library_verify',
  // F152 Phase C: Distillation tools
  'agent_studio_mark_generalizable',
  'agent_studio_nominate_for_global',
  'agent_studio_review_distillation',
  // Signal Hunter tools (F21 S5) + F091 Study tools
  'signal_list_inbox',
  'signal_get_article',
  'signal_search',
  'signal_mark_read',
  'signal_summarize',
  'signal_start_study',
  'signal_save_notes',
  'signal_list_studies',
  'signal_generate_podcast',
  'signal_update_article',
  'signal_delete_article',
  'signal_link_thread',
  // Session chain tools
  'agent_studio_list_session_chain',
  'agent_studio_read_session_events',
  'agent_studio_read_session_digest',
  'agent_studio_read_invocation_detail',
  'agent_studio_list_external_runtime_sessions',
  'agent_studio_read_external_runtime_session',
  // Limb tools
  'limb_list_available',
  'limb_invoke',
  'limb_pair_list',
  'limb_pair_approve',
  // F101 Phase I: Game action tool
  'agent_studio_submit_game_action',
  // F139 Phase 3A: Schedule tools
  'agent_studio_list_schedule_templates',
  'agent_studio_preview_scheduled_task',
  'agent_studio_register_scheduled_task',
  'agent_studio_remove_scheduled_task',
  'agent_studio_hold_ball',
  'agent_studio_list_labels',
  // F061 Bug-F workaround: MCP shell exec for read-only commands
  'agent_studio_shell_exec',
  // F195 Phase B: Audio capture + transcription tools
  'agent_studio_audio_list_sources',
  'agent_studio_audio_capture_start',
  'agent_studio_audio_capture_stop',
  'agent_studio_audio_capture_status',
  'agent_studio_audio_read_transcript',
  'agent_studio_audio_enroll_speakers',
  // F195 Phase C3: Advisory mode tools
  'agent_studio_audio_set_advisory_mode',
  'agent_studio_audio_set_talking_points',
  // F207 Phase B0: finance fact layer
  'agent_studio_finance_query',
  // F192 Phase H AC-H4: verdict publishing pipeline (eval agent → MCP → handler)
  'agent_studio_publish_verdict',
  // F168 Phase B Task 6: declare awaiting_external state for a community case
  'agent_studio_community_await_external',
];

const EXPECTED_COLLAB_TOOLS = [
  'agent_studio_post_message',
  'agent_studio_get_pending_mentions',
  'agent_studio_ack_mentions',
  'agent_studio_get_thread_context',
  // #699: Message lookup by ID
  'agent_studio_get_message',
  'agent_studio_get_thread_agents',
  'agent_studio_list_threads',
  'agent_studio_feat_index',
  'agent_studio_cross_post_message',
  'agent_studio_list_tasks',
  'agent_studio_update_task',
  'agent_studio_create_task',
  'agent_studio_create_rich_block',
  'agent_studio_generate_document',
  'agent_studio_workspace_navigate',
  'agent_studio_preview_open',
  // F227: generic teleport to a thread message
  'agent_studio_teleport',
  // F227 Task 7: Event Memory timeline read + corpus backfill
  'agent_studio_list_events',
  'agent_studio_backfill_events',
  'agent_studio_get_rich_block_rules',
  'agent_studio_request_permission',
  'agent_studio_check_permission_status',
  'agent_studio_register_pr_tracking',
  'agent_studio_register_issue_tracking',
  'agent_studio_unregister_tracking',
  // F211 Phase B: IDE-direct external runtime session registration
  'agent_studio_register_external_runtime_session',
  // F192 Phase H AC-H4: agent_studio_publish_verdict registered in collab toolset
  'agent_studio_publish_verdict',
  // agent_studio_guide_resolve legacy alias removed in F193 Phase D AC-D2
  'agent_studio_update_guide_state',
  'agent_studio_get_available_guides',
  'agent_studio_start_guide',
  'agent_studio_guide_control',
  'agent_studio_update_workflow',
  'agent_studio_multi_mention',
  'agent_studio_start_vote',
  'agent_studio_update_bootcamp_state',
  'agent_studio_bootcamp_env_check',
  // F128: Agent-initiated thread proposal
  'agent_studio_propose_thread',
  // F225: Agent-initiated session handoff proposal
  'agent_studio_propose_session_handoff',
  // F231 Phase C: Agent-initiated profile-update proposal
  'agent_studio_propose_profile_update',
  'agent_studio_submit_game_action',
  // F139 Phase 3A: Schedule tools
  'agent_studio_list_schedule_templates',
  'agent_studio_preview_scheduled_task',
  'agent_studio_register_scheduled_task',
  'agent_studio_remove_scheduled_task',
  'agent_studio_hold_ball',
  'agent_studio_list_labels',
  // F061 Bug-F workaround: MCP shell exec for read-only commands
  'agent_studio_shell_exec',
  // F168 Phase B Task 6: declare awaiting_external state for a community case
  'agent_studio_community_await_external',
];

const EXPECTED_MEMORY_TOOLS = [
  'agent_studio_retain_memory_callback',
  'agent_studio_mark_generalizable',
  'agent_studio_nominate_for_global',
  'agent_studio_review_distillation',
  'agent_studio_search_evidence',
  'agent_studio_run_perspective',
  'agent_studio_read_file_slice',
  'agent_studio_graph_resolve', // F188 Phase F AC-F1
  'agent_studio_library_list', // F188 Phase I AC-I4
  'agent_studio_library_dry_run', // F188 Phase I AC-I4
  'agent_studio_library_create', // F188 Phase I AC-I4
  'agent_studio_library_rebuild', // F188 Phase I AC-I4
  'agent_studio_library_archive', // F188 Phase I AC-I4
  'agent_studio_library_verify', // F188 Phase J AC-J7
  'agent_studio_list_recent', // F188 Phase F AC-F2
  // agent_studio_reflect removed in F193 Phase D AC-D1
  'agent_studio_list_session_chain',
  'agent_studio_read_session_events',
  'agent_studio_read_session_digest',
  'agent_studio_read_invocation_detail',
  'agent_studio_list_external_runtime_sessions',
  'agent_studio_read_external_runtime_session',
];

const EXPECTED_SIGNAL_TOOLS = [
  'signal_list_inbox',
  'signal_get_article',
  'signal_search',
  'signal_mark_read',
  'signal_summarize',
  'signal_start_study',
  'signal_save_notes',
  'signal_list_studies',
  'signal_generate_podcast',
  'signal_update_article',
  'signal_delete_article',
  'signal_link_thread',
];

// F193 Phase C: limb tools (Lead Architect专属能力 namespace) get their own server.
const EXPECTED_LIMB_TOOLS = ['limb_list_available', 'limb_invoke', 'limb_pair_list', 'limb_pair_approve'];

// F207 Phase B0: finance fact tools get their own read-only data-plane server.
const EXPECTED_FINANCE_TOOLS = ['agent_studio_finance_query'];

function assertUnique(values, label) {
  assert.equal(new Set(values).size, values.length, `${label} must not contain duplicate tool names`);
}

describe('MCP Server Tool Registration', () => {
  test('expected tool lists stay duplicate-free', () => {
    assertUnique(EXPECTED_TOOLS, 'EXPECTED_TOOLS');
    assertUnique(EXPECTED_COLLAB_TOOLS, 'EXPECTED_COLLAB_TOOLS');
    assertUnique(EXPECTED_MEMORY_TOOLS, 'EXPECTED_MEMORY_TOOLS');
    assertUnique(EXPECTED_SIGNAL_TOOLS, 'EXPECTED_SIGNAL_TOOLS');
    assertUnique(EXPECTED_LIMB_TOOLS, 'EXPECTED_LIMB_TOOLS');
    assertUnique(EXPECTED_FINANCE_TOOLS, 'EXPECTED_FINANCE_TOOLS');
  });

  test('all expected tools are registered via createServer()', async () => {
    const { createServer } = await import('../dist/index.js');
    const server = createServer();

    // _registeredTools is a plain object keyed by tool name
    const registeredNames = Object.keys(server._registeredTools);

    for (const name of EXPECTED_TOOLS) {
      assert.ok(registeredNames.includes(name), `Tool "${name}" is NOT registered on the MCP server`);
    }
  });

  test('no unexpected tools are registered', async () => {
    const { createServer } = await import('../dist/index.js');
    const server = createServer();

    const registeredNames = Object.keys(server._registeredTools);

    for (const name of registeredNames) {
      assert.ok(
        EXPECTED_TOOLS.includes(name),
        `Unexpected tool "${name}" found — add it to EXPECTED_TOOLS if intentional`,
      );
    }
  });

  test('permission tools have correct input schemas', async () => {
    const { createServer } = await import('../dist/index.js');
    const server = createServer();

    const reqTool = server._registeredTools.agent_studio_request_permission;
    assert.ok(reqTool, 'request_permission tool should exist');

    const checkTool = server._registeredTools.agent_studio_check_permission_status;
    assert.ok(checkTool, 'check_permission_status tool should exist');
  });

  test('post_message schema exposes threadId as optional (F178 agent-key auth)', async () => {
    const { createServer } = await import('../dist/index.js');
    const server = createServer();

    const postTool = server._registeredTools.agent_studio_post_message;
    assert.ok(postTool, 'post_message tool should exist');
    const shapeKeys = Object.keys(postTool.inputSchema.shape);
    assert.ok(
      shapeKeys.includes('threadId'),
      'post_message must expose threadId for agent-key auth (F178 — no default invocation thread)',
    );
    assert.ok(
      postTool.inputSchema._def.shape().threadId.isOptional(),
      'post_message threadId must be optional (backward-compatible for invocation auth)',
    );
    assert.ok(
      shapeKeys.includes('agentKeyAgentId'),
      'post_message must expose agentKeyAgentId for shared persistent MCP variant identity',
    );
    assert.ok(
      postTool.inputSchema._def.shape().agentKeyAgentId.isOptional(),
      'post_message agentKeyAgentId stays schema-optional for invocation auth; shared persistent agent-key auth requires it at runtime',
    );
  });

  test('cross_post_message schema must REQUIRE threadId', async () => {
    const { createServer } = await import('../dist/index.js');
    const server = createServer();

    const crossTool = server._registeredTools.agent_studio_cross_post_message;
    assert.ok(crossTool, 'cross_post_message tool should exist');
    const shapeKeys = Object.keys(crossTool.inputSchema.shape);
    assert.ok(shapeKeys.includes('threadId'), 'cross_post_message must have threadId in schema');
    assert.ok(
      crossTool.inputSchema._def.shape().threadId.isOptional() === false,
      'cross_post_message threadId must be required (not optional)',
    );
    assert.ok(
      shapeKeys.includes('agentKeyAgentId'),
      'cross_post_message must expose agentKeyAgentId for shared persistent MCP variant identity',
    );
  });

  test('thread-context and list-threads expose agentKeyAgentId for shared persistent MCP identity', async () => {
    const { createServer } = await import('../dist/index.js');
    const server = createServer();

    const contextTool = server._registeredTools.agent_studio_get_thread_context;
    const listTool = server._registeredTools.agent_studio_list_threads;
    assert.ok(contextTool, 'get_thread_context tool should exist');
    assert.ok(listTool, 'list_threads tool should exist');
    assert.ok(Object.keys(contextTool.inputSchema.shape).includes('agentKeyAgentId'));
    assert.ok(contextTool.inputSchema._def.shape().agentKeyAgentId.isOptional());
    assert.ok(Object.keys(listTool.inputSchema.shape).includes('agentKeyAgentId'));
    assert.ok(listTool.inputSchema._def.shape().agentKeyAgentId.isOptional());
  });

  test('Hub action tools expose agentKeyAgentId for shared persistent MCP identity', async () => {
    const { createServer } = await import('../dist/index.js');
    const server = createServer();

    const workspaceTool = server._registeredTools.agent_studio_workspace_navigate;
    const previewTool = server._registeredTools.agent_studio_preview_open;
    assert.ok(workspaceTool, 'workspace_navigate tool should exist');
    assert.ok(previewTool, 'preview_open tool should exist');
    assert.ok(Object.keys(workspaceTool.inputSchema.shape).includes('agentKeyAgentId'));
    assert.ok(workspaceTool.inputSchema._def.shape().agentKeyAgentId.isOptional());
    assert.ok(Object.keys(previewTool.inputSchema.shape).includes('agentKeyAgentId'));
    assert.ok(previewTool.inputSchema._def.shape().agentKeyAgentId.isOptional());
  });

  test('deprecated file tools are not registered', async () => {
    const { createServer } = await import('../dist/index.js');
    const server = createServer();
    const registeredNames = Object.keys(server._registeredTools);

    assert.ok(!registeredNames.includes('read_file'));
    assert.ok(!registeredNames.includes('write_file'));
    assert.ok(!registeredNames.includes('list_files'));
  });

  test('src/index.ts stays under 350 lines (hard limit)', () => {
    const sourcePath = new URL('../src/index.ts', import.meta.url);
    const source = readFileSync(sourcePath, 'utf-8');
    const lineCount = source.split('\n').length;
    assert.ok(lineCount <= 350, `mcp-server/src/index.ts exceeds 350 lines: ${lineCount}`);
  });

  test('createCollabServer registers only collab tool surface', async () => {
    const { createCollabServer } = await import('../dist/collab.js');
    const server = createCollabServer();
    const registered = Object.keys(server._registeredTools);

    assert.deepEqual([...registered].sort(), [...EXPECTED_COLLAB_TOOLS].sort());
  });

  test('createMemoryServer registers only memory tool surface', async () => {
    const { createMemoryServer } = await import('../dist/memory.js');
    const server = createMemoryServer();
    const registered = Object.keys(server._registeredTools);

    assert.deepEqual([...registered].sort(), [...EXPECTED_MEMORY_TOOLS].sort());
  });

  test('createSignalsServer registers only signals tool surface', async () => {
    const { createSignalsServer } = await import('../dist/signals.js');
    const server = createSignalsServer();
    const registered = Object.keys(server._registeredTools);

    assert.deepEqual([...registered].sort(), [...EXPECTED_SIGNAL_TOOLS].sort());
  });

  test('F193 AC-C1: createLimbServer registers only limb tool surface', async () => {
    const { createLimbServer } = await import('../dist/limb.js');
    const server = createLimbServer();
    const registered = Object.keys(server._registeredTools);

    assert.deepEqual([...registered].sort(), [...EXPECTED_LIMB_TOOLS].sort());
  });

  test('F207 AC-B5: createFinanceServer registers only finance fact tool surface', async () => {
    const { createFinanceServer } = await import('../dist/finance.js');
    const server = createFinanceServer();
    const registered = Object.keys(server._registeredTools);

    assert.deepEqual([...registered].sort(), [...EXPECTED_FINANCE_TOOLS].sort());
  });
});

// --- F061 Phase 2: READONLY_ALLOWED_TOOLS whitelist ---

const KNOWN_WRITE_TOOLS = [
  'agent_studio_post_message',
  'agent_studio_ack_mentions',
  'agent_studio_cross_post_message',
  'agent_studio_multi_mention',
  'agent_studio_update_task',
  'agent_studio_create_task',
  'agent_studio_create_rich_block',
  'agent_studio_generate_document',
  'agent_studio_workspace_navigate',
  'agent_studio_preview_open',
  // F227: generic teleport (write — agent-key gated, not in readonly)
  'agent_studio_teleport',
  // F227 Task 7: backfill is a write (agent-key gated, not in readonly)
  'agent_studio_backfill_events',
  'agent_studio_request_permission',
  'agent_studio_register_pr_tracking',
  'agent_studio_register_issue_tracking',
  'agent_studio_unregister_tracking',
  'agent_studio_register_external_runtime_session',
  'agent_studio_update_workflow',
  'agent_studio_start_vote',
  'agent_studio_update_bootcamp_state',
  'agent_studio_bootcamp_env_check', // writes bootcampState.envCheck via callbackPost
  // agent_studio_guide_resolve legacy alias removed in F193 Phase D AC-D2
  'agent_studio_update_guide_state',
  'agent_studio_start_guide',
  'agent_studio_guide_control',
  'agent_studio_retain_memory_callback',
  'agent_studio_mark_generalizable',
  'agent_studio_nominate_for_global',
  'agent_studio_review_distillation', // POST approve/reject → writes global knowledge
  'agent_studio_submit_game_action',
  'agent_studio_register_scheduled_task',
  'agent_studio_remove_scheduled_task',
  'agent_studio_hold_ball', // callbackPost → writes scheduled task
  // F192 Phase H AC-H4: publish verdict creates branch + commit + PR (write)
  'agent_studio_publish_verdict',
  'agent_studio_feat_index', // requires callback credentials unavailable in readonly
  'signal_mark_read',
  'signal_summarize',
  'signal_start_study',
  'signal_save_notes',
  'signal_generate_podcast',
  'signal_update_article',
  'signal_delete_article',
  'signal_link_thread',
  'limb_invoke',
  'limb_pair_approve',
];

const EXPECTED_READONLY_TOOLS = [
  'agent_studio_search_evidence',
  'agent_studio_run_perspective',
  'agent_studio_read_file_slice',
  'agent_studio_graph_resolve', // F188 Phase F AC-F1
  'agent_studio_list_recent', // F188 Phase F AC-F2
  // agent_studio_reflect removed in F193 Phase D AC-D1
  'agent_studio_get_rich_block_rules',
  'agent_studio_list_session_chain',
  'agent_studio_read_session_events',
  'agent_studio_read_session_digest',
  'agent_studio_read_invocation_detail',
  'agent_studio_list_external_runtime_sessions',
  'agent_studio_read_external_runtime_session',
  'signal_list_inbox',
  'signal_get_article',
  'signal_search',
  'signal_list_studies',
  // F061 Bug-F workaround: read-only shell exec whitelist enforced at handler level
  'agent_studio_shell_exec',
  // F207 Phase B0: read-only finance fact layer wrapper
  'agent_studio_finance_query',
];

describe('F061 READONLY_ALLOWED_TOOLS whitelist', () => {
  test('whitelist excludes all known write tools', async () => {
    const { READONLY_ALLOWED_TOOLS } = await import('../dist/server-toolsets.js');
    for (const name of KNOWN_WRITE_TOOLS) {
      assert.ok(!READONLY_ALLOWED_TOOLS.has(name), `Write tool "${name}" must NOT be in readonly whitelist`);
    }
  });

  test('whitelist includes all expected readonly tools', async () => {
    const { READONLY_ALLOWED_TOOLS } = await import('../dist/server-toolsets.js');
    for (const name of EXPECTED_READONLY_TOOLS) {
      assert.ok(READONLY_ALLOWED_TOOLS.has(name), `Readonly tool "${name}" must be in whitelist`);
    }
  });

  test('whitelist is a subset of all registered tools', async () => {
    const { READONLY_ALLOWED_TOOLS } = await import('../dist/server-toolsets.js');
    const { createServer } = await import('../dist/index.js');
    const server = createServer();
    const allRegistered = new Set(Object.keys(server._registeredTools));
    for (const name of READONLY_ALLOWED_TOOLS) {
      assert.ok(allRegistered.has(name), `Whitelist tool "${name}" does not exist in registered tools`);
    }
  });

  test('readonly mode exposes agent-key tools when only AGENT_STUDIO_AGENT_KEY_FILES is configured', () => {
    const distIndexUrl = new URL('../dist/index.js', import.meta.url).href;
    const script = `
      process.env.AGENT_STUDIO_READONLY = 'true';
      delete process.env.AGENT_STUDIO_AGENT_KEY_SECRET;
      delete process.env.AGENT_STUDIO_AGENT_KEY_FILE;
      process.env.AGENT_STUDIO_AGENT_KEY_FILES = JSON.stringify({
        antigravity: '/tmp/antigravity.secret',
        'antig-opus': '/tmp/antig-opus.secret',
      });
      const { createServer } = await import(${JSON.stringify(distIndexUrl)});
      const server = createServer();
      const names = Object.keys(server._registeredTools);
      if (
        !names.includes('agent_studio_post_message') ||
        !names.includes('agent_studio_get_thread_context') ||
        !names.includes('agent_studio_workspace_navigate') ||
        !names.includes('agent_studio_preview_open') ||
        // F227: teleport is agent-key gated — must be visible in readonly+agent-key
        !names.includes('agent_studio_teleport') ||
        !names.includes('agent_studio_create_rich_block') ||
        // 砚砚 R9 P1: shared-MCP agents must see publish-verdict
        !names.includes('agent_studio_publish_verdict')
      ) {
        console.error(JSON.stringify(names.sort()));
        process.exit(1);
      }
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: process.cwd(),
      encoding: 'utf-8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
});
