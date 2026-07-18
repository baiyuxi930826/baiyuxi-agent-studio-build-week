/**
 * System Prompt Builder
 * 为每次 CLI 调用构建身份注入 prompt（~150-200 tokens）
 *
 * 纯函数，无副作用。读取 agentRegistry 生成身份上下文。
 */

import type {
  AgentConfig,
  AgentId,
  CompiledPackBlocks,
  ConciergeConfig,
  WorldContextEnvelope,
} from '@agent-studio/shared';
import { agentRegistry } from '@agent-studio/shared';
import {
  agentHasRole,
  getCoCreatorConfig,
  getReviewPolicy,
  getRoster,
  isAgentAvailable,
  isAgentLead,
} from '../../../../config/agent-config-loader.js';
import { getAgentModel } from '../../../../config/agent-models.js';
// F167 Phase F P1 (cloud Codex): roster model cell must resolve via getAgentModel
// (env AGENT_{AGENTID}_MODEL → registry → defaults), not from static config.defaultModel,
// otherwise env overrides cause exactly the handle/model drift Phase F is killing.
import { buildConciergePromptLines } from '../../../concierge/ConciergePromptSection.js';
import { buildGuidePromptLines } from '../../../guides/GuidePromptSection.js';
import type {
  BootcampStateV1,
  ThreadMentionRoutingFeedback,
  ThreadParticipantActivity,
  ThreadRoutingPolicyV1,
} from '../stores/ports/ThreadStore.js';
import { loadCompiledGovernanceL0, loadCompiledGovernanceL0Sync } from './governance-l0.js';
import { RICH_BLOCK_SHORT } from './rich-block-rules.js';
// L0-budget-defense PR-B-impl (ADR-038 件套 ④): staging is wired in
// invoke-single-agent (mirrors F225 contextHintPrefix), NOT here. See note
// at the buildLiveStaticIdentity removal site below for the rationale.

/**
 * Context for a single agent invocation
 */
export interface InvocationContext {
  /** Which agent is being invoked */
  agentId: AgentId;
  /** independent = sole responder, serial = part of a chain, parallel = concurrent ideation */
  mode: 'independent' | 'serial' | 'parallel';
  /** 1-based position in chain (only for serial mode) */
  chainIndex?: number;
  /** Total agents in chain (only for serial mode) */
  chainTotal?: number;
  /** Other agents in this invocation (for teammate awareness) */
  teammates: readonly AgentId[];
  /** Whether MCP tools are available for this agent */
  mcpAvailable: boolean;
  /** Prompt-level tags like 'critique' (from IntentParser) */
  promptTags?: readonly string[];
  /** Whether A2A collaboration prompt should be injected (only in serial/execute mode) */
  a2aEnabled?: boolean;
  /**
   * F042: Direct-message sender (A2A).
   * When present, the invoked agent MUST reply to this agent (not the user).
   */
  directMessageFrom?: AgentId;
  /**
   * F167 L1: ping-pong streak warning.
   * When present (streak >= 2), inject a warning prompt reminding the agent
   * that they've been bouncing the same pair back and forth — consider
   * third-party input / wrap up / escalate to co-creator instead of another volley.
   */
  pingPongWarning?: {
    /** The other agent in the ping-pong pair (not this agent). */
    pairedWith: AgentId;
    /** Current streak count (≥2, <4). */
    count: number;
  };
  /**
   * F193 AC-B2: Cross-thread reply hint.
   * When present (cross-post triggered invocation per F052), inject reply
   * guidance so the receiving agent knows: (1) source thread id, (2) sender agent
   * handle, (3) reply path (cross_post_message — local @ won't route back).
   *
   * Hydrated from trigger message id (worklist a2aTriggerMessageId / queue
   * path backfill) → StoredMessage.extra.crossPost + StoredMessage.agentId.
   * MUST be structured (not parsed from prompt text) — ContextAssembler
   * only renders slice(0,8) truncated thread + lacks senderAgentId.
   *
   * KD-1 boundary: only set for invocation-token cross-thread RELAY path.
   * Agent-key target-thread write does NOT inject this (no source thread).
   */
  crossThreadReplyHint?: {
    /** Full source thread id (not truncated). */
    sourceThreadId: string;
    /** Sender agent handle (agentId). */
    senderAgentId: AgentId;
  };
  /**
   * F046 D3: One-shot feedback injected when previous @mention was not routed.
   * Consumed from threadStore before invocation and cleared after injection.
   */
  mentionRoutingFeedback?: ThreadMentionRoutingFeedback;
  /** F042 Wave 3: Thread-level participant activity for @ disambiguation.
   *  Sorted by lastMessageAt desc. Injected per-invocation to survive compression. */
  activeParticipants?: readonly ThreadParticipantActivity[];
  /** F042: Thread-scoped routing policy summary (intent/scope). Injected per-invocation. */
  routingPolicy?: ThreadRoutingPolicyV1;
  /**
   * F073 P4: SOP stage hint from Mission Hub workflow-sop.
   * Injected per-invocation so all agents (Claude/Codex/Gemini) see current stage.
   * 告示牌哲学：智能体看了自己决定行动，不被系统推着走。
   */
  sopStageHint?: {
    readonly stage: string;
    readonly suggestedSkill: string;
    readonly suggestedSkillSource?: string;
    readonly featureId: string;
  };
  /**
   * F091: Active Signal articles in discussion context.
   * Injected when co-creator links a Signal article in the thread.
   */
  activeSignals?: readonly {
    readonly id: string;
    readonly title: string;
    readonly source: string;
    readonly tier: number;
    readonly contentSnippet: string;
    readonly note?: string | undefined;
    readonly relatedDiscussions?:
      | readonly {
          readonly sessionId: string;
          readonly snippet: string;
          readonly score: number;
        }[]
      | undefined;
  }[];
  /**
   * F092: Voice companion mode.
   * When true, agents should prioritize audio rich blocks for spoken output.
   */
  voiceMode?: boolean;
  /**
   * Thread ID — injected for tools that need it (e.g. bootcamp state updates).
   */
  threadId?: string;
  /**
   * F087: Bootcamp state for operator onboarding threads.
   * When present, agents inject bootcamp-guide behavior per phase.
   */
  bootcampState?: BootcampStateV1;
  /**
   * F155: Matched guide candidate from routing-layer keyword match.
   * When present, agents load guide-interaction skill and offer the guide.
   */
  guideCandidate?: {
    id: string;
    name: string;
    estimatedTime: string;
    status: 'offered' | 'awaiting_choice' | 'active' | 'completed';
    /** True only on the first routing-layer match before any guideState has been persisted. */
    isNewOffer?: boolean;
    /** When user clicked an interactive selection, carries the chosen label. */
    userSelection?: string;
  };
  /**
   * F087: Number of agents currently registered in this account.
   * Injected alongside bootcampState so the model knows team size without querying /api/agents.
   */
  bootcampMemberCount?: number;
  /**
   * F129: Compiled pack blocks from active packs.
   * Injected into static identity via buildStaticIdentity → packBlocks.
   */
  packBlocks?: CompiledPackBlocks | null;
  /**
   * F163 AC-A3: Pre-fetched always_on + constitutional docs for physical injection.
   * Populated from SqliteEvidenceStore.queryAlwaysOn() at bootstrap time.
   */
  alwaysOnDocs?: readonly { anchor: string; title: string; summary: string }[];
  /**
   * F093: World context envelope for world-building mode.
   * When present, injects world state (characters, scene, canon) into the prompt.
   */
  worldContext?: WorldContextEnvelope;
  /**
   * F229: Concierge thread marker.
   * When 'concierge', ConciergePromptSection is injected into the invocation context.
   */
  threadKind?: 'concierge';
  /**
   * F229: Per-user concierge configuration.
   * Required when threadKind === 'concierge'. Provides displayName / personaTone / dutyAgentProfileId.
   */
  conciergeConfig?: ConciergeConfig;
}

/** Get all agent configs from agentRegistry (.agent-studio/agent-catalog.json) */
function getAllConfigs(): Record<string, AgentConfig> {
  return agentRegistry.getAllConfigs();
}

/** Get a single agent config by ID */
function getConfig(agentId: string): AgentConfig | undefined {
  return agentRegistry.tryGet(agentId)?.config;
}

interface CallableAgentEntry {
  readonly id: string;
  readonly config: AgentConfig;
}

interface CallableMentionsResult {
  readonly mentions: string[];
  readonly hasDuplicateDisplayNames: boolean;
  readonly uniqueHandleExample: string | null;
}

function pickVariantMention(id: string, config: AgentConfig): string {
  const expected = `@${id}`.toLowerCase();
  const byId = config.mentionPatterns.find((p) => p.toLowerCase() === expected);
  if (byId) return byId;
  if (config.mentionPatterns.length > 0) {
    return [...config.mentionPatterns].sort((a, b) => a.length - b.length)[0]!;
  }
  return `@${id}`;
}

function pickDisplayNameMention(config: AgentConfig): string | null {
  const expected = `@${config.displayName}`.toLowerCase();
  return config.mentionPatterns.find((p) => p.toLowerCase() === expected) ?? null;
}

function pickDisplayNameOrVariantMention(id: string, config: AgentConfig): string {
  // Do not synthesize @displayName unless the registry actually routes it.
  // Example: opus-47 shares displayName="Ethan（任务主控与实现）" but only registers @opus-47.
  return pickDisplayNameMention(config) ?? pickVariantMention(id, config);
}

function buildCallableMentions(currentAgentId: AgentId): CallableMentionsResult {
  const entries: CallableAgentEntry[] = Object.entries(getAllConfigs())
    .filter(([id]) => id !== currentAgentId && isAgentAvailable(id))
    .map(([id, config]) => ({ id, config }));

  if (entries.length === 0) {
    return { mentions: [], hasDuplicateDisplayNames: false, uniqueHandleExample: null };
  }

  const byDisplayName = new Map<string, CallableAgentEntry[]>();
  for (const entry of entries) {
    const group = byDisplayName.get(entry.config.displayName);
    if (group) {
      group.push(entry);
    } else {
      byDisplayName.set(entry.config.displayName, [entry]);
    }
  }

  const hasDuplicateDisplayNames = Array.from(byDisplayName.values()).some((group) => group.length > 1);
  const mentions: string[] = [];
  const seen = new Set<string>();
  let uniqueHandleExample: string | null = null;

  for (const entry of entries) {
    const group = byDisplayName.get(entry.config.displayName) ?? [];
    const mention =
      group.length <= 1 || entry.config.isDefaultVariant
        ? pickDisplayNameOrVariantMention(entry.id, entry.config)
        : pickVariantMention(entry.id, entry.config);
    if (group.length > 1 && !entry.config.isDefaultVariant && uniqueHandleExample == null) {
      uniqueHandleExample = mention;
    }
    if (!seen.has(mention)) {
      seen.add(mention);
      mentions.push(mention);
    }
  }

  return { mentions, hasDuplicateDisplayNames, uniqueHandleExample };
}

function formatHandleFreeLabel(agentId: string, config: AgentConfig | undefined): string {
  if (!config) return agentId;
  // F167 identity anti-spoofing: carry variantLabel when present to disambiguate same-role variants
  // (e.g. "Ethan（任务主控与实现）(opus)"), preventing A2A handoff identity confusion.
  const variantPart = config.variantLabel ? ` ${config.variantLabel}` : '';
  return `${config.displayName}${variantPart}(${agentId})`;
}

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
};

/**
 * Skills-as-source-of-truth: MCP tools section is minimal.
 * Full specs live in agent-studio-skills/refs/ (rich-blocks.md, mcp-callbacks.md).
 */
const MCP_TOOLS_SECTION = `
MCP 工具（异步汇报；token 有效期有限）：

**记忆工具：**
- agent_studio_search_evidence: 首选入口；depth=raw 可看消息级细节
- agent_studio_library_*: collection管理(list/create/rebuild/archive)

**drill-down：**
- agent_studio_list_session_chain: 列出 session 链
- agent_studio_read_session_digest: 读 session 摘要
- agent_studio_read_session_events: 读 session 事件（raw/chat/handoff）
- agent_studio_read_invocation_detail: 读单次 invocation 全事件

**四肢控制面（Limb — 插件/设备能力调用）：**
- limb_list_available: 列出当前在线节点及能力（含插件提供的服务型节点）
- limb_invoke: 调用节点能力；nodeId 从 limb_list_available 获取，不要猜

**协作工具：**
- agent_studio_post_message: 本 thread 异步（agent-key 才传 threadId）
- agent_studio_cross_post_message: 跨 thread（targetAgents/行首@二选一）。最小路径：list_threads → cross_post_message(threadId, targetAgents, content) → get_thread_context 验证
agent_studio_register_pr_tracking/agent_studio_register_issue_tracking/agent_studio_unregister_tracking
- agent_studio_get_pending_mentions: @提及
- agent_studio_get_thread_context: thread 上下文
- agent_studio_list_threads: thread 摘要
- agent_studio_create_task: 🧶 毛线球（持久任务）
- agent_studio_update_task: 更新任务状态
- agent_studio_create_rich_block: rich block（inline）
- agent_studio_generate_document: 文档生成→IM投递
- agent_studio_get_rich_block_rules: rich block 规则
- agent_studio_multi_mention: 并行拉智能体讨论（先搜后问）
- agent_studio_propose_thread: 提议新建 thread（不直接创建）。返回 proposalId，审批通过后才建；审批前不要 cross_post。可选 projectPath 定子 thread 项目归属（跨 repo 必传；无效 400）。可选 reportingMode：final-only（默认）| none | state-transitions | blocking-ack。triage→none，汇总→final-only。

${RICH_BLOCK_SHORT}
需要富呈现时优先 rich block；首次使用前先 call get_rich_block_rules。
规范：agent-studio-skills/refs/rich-blocks.md。`;

// --- shared-rules.md → compiled governance L0 support (#747) ---
let _governanceDigestResolved = loadCompiledGovernanceL0Sync().content;

/**
 * Preload governance overlay at startup. Call once before first prompt build.
 * Checks for shared-rules.local-override.md (replaces digest) or
 * shared-rules.local.md (appends to digest).
 */
export async function initGovernanceOverlay(): Promise<void> {
  const result = await loadCompiledGovernanceL0();
  _governanceDigestResolved = result.content;
  if (result.source !== 'base') {
    console.log(`[governance] shared-rules ${result.source}: ${result.overlayPath}`);
  }
}

export function getGovernanceDigest(): string {
  return _governanceDigestResolved;
}

/** Per-role workflow triggers: when to proactively @ other agents.
 *  Keyed by roleId so all variants of a role share the same workflow. */
const MERGE_GATE_SOURCE_PROVENANCE_TRIGGER =
  '- MG provenance override: external finding fixed -> wait for PR truth, do not ping stale reviewer.';

const WORKFLOW_TRIGGERS: Record<string, string> = {
  'architecture-development': [
    '## 工作流（主动 @ 触发点）',
    '- 完成开发/修复 -> @owen 请 review',
    '- 修完 review 意见 -> @owen 确认修复',
    MERGE_GATE_SOURCE_PROVENANCE_TRIGGER,
    '- 遇到视觉/体验问题 -> @andy 征询',
    '- 遇到资料/文档问题 -> @nora 协助整理',
  ].join('\n'),
  'code-review': [
    '## 工作流（主动 @ 触发点）',
    '- 完成 review -> @ethan 通知结果',
    '- 修完 bug/feature -> @ethan 请 review',
    MERGE_GATE_SOURCE_PROVENANCE_TRIGGER,
    '- 发现需要架构决策 -> @ethan 征询',
    '- 发现需要界面判断 -> @andy 征询',
  ].join('\n'),
  'frontend-visual': [
    '## 工作流（主动 @ 触发点）',
    '- 完成设计/视觉资产 -> @ethan / @owen 请确认',
    '- 遇到技术实现问题 -> @ethan 征询',
    '- 需要资料支持或竞品对比 -> @nora 协助整理',
    '',
    '### 执行纪律',
    '- 加载 Skill 后直接执行第一步（产出 > 复述）',
    '- 涉及 UI/前端验证时：通过截图产出证据',
  ].join('\n'),
  'research-docs': [
    '## 工作流（主动 @ 触发点）',
    '- 完成资料整理/文档草稿 -> @ethan 请确认方案方向',
    '- 文档涉及代码质量、风险或测试结论 -> @owen 请复核',
    '- 文档涉及界面、截图或视觉证据 -> @andy 请补证据',
    '',
    '### 执行纪律',
    '- 给出出处、范围和不确定性，不把推测写成事实',
    '- 输出结构化结论，避免只堆资料',
  ].join('\n'),
};

/**
 * F-Ground-3: Build teammate roster table.
 * Lists all other agents with @mention, strengths, and caution.
 * Excludes the current agent. Returns null if no teammates.
 */
function buildTeammateRoster(currentAgentId: AgentId): string | null {
  const allConfigs = getAllConfigs();
  const entries = Object.entries(allConfigs).filter(([id]) => id !== currentAgentId && isAgentAvailable(id));
  if (entries.length === 0) return null;

  const rows: string[] = [];
  for (const [id, config] of entries) {
    const label = config.variantLabel
      ? `${config.displayName} ${config.variantLabel}`
      : config.nickname
        ? `${config.displayName}/${config.nickname}`
        : config.displayName;
    const mention = pickVariantMention(id, config);
    // F167 Phase F (KD-21): surface resolved runtime model next to the @mention so
    // sender's 认知真相 aligns with runtime catalog. Handle is identity constant;
    // model is runtime-resolved metadata — the two must be visibly decoupled to
    // prevent cargo-cult projection (e.g. "云端 codex bot" → 本地 @codex 快照).
    // P1 fix (cloud Codex review): resolve via getAgentModel so env overrides show through,
    // not the static template's defaultModel. Fall back to defaultModel only on error.
    let resolvedModel: string;
    try {
      resolvedModel = getAgentModel(id);
    } catch {
      resolvedModel = config.defaultModel ?? '';
    }
    const mentionCell = resolvedModel ? `${mention} · ${resolvedModel}` : mention;
    const strengths = config.teamStrengths ?? config.roleDescription;
    // F167 Phase E (KD-20): surface hard restrictions alongside caution — data-driven
    // replacement for the retired L3 role-gate. Sender sees e.g. "禁止写代码" so they
    // self-regulate which agent to @ for which task; no harness-side regex.
    const restrictionsNote =
      config.restrictions && config.restrictions.length > 0 ? `**硬限制**：${config.restrictions.join('、')}` : null;
    const cautionCell = [config.caution ?? null, restrictionsNote].filter(Boolean).join('；') || '—';
    rows.push(`| ${label} | ${mentionCell} | ${strengths} | ${cautionCell} |`);
  }

  return [
    '## 队友名册',
    '| Agent 能力通道 | @mention · 当前模型 | 擅长 | 注意 |',
    '|------|---------|------|------|',
    ...rows,
  ].join('\n');
}

/**
 * Options for building the static identity prompt.
 * MCP section is included here (not in invocationContext) because it's
 * session-level — injected once on new session, skipped on --resume.
 */
export interface StaticIdentityOptions {
  /**
   * Whether native MCP tools are available (Claude with --mcp-config).
   * When true, MCP_TOOLS_SECTION is included in static identity because
   * Claude's --append-system-prompt survives context compression.
   *
   * Non-Claude agents (Codex/Gemini) use HTTP callback instructions which
   * must stay in per-message prompt because their systemPrompt is in
   * session history and MAY be lost on compression.
   */
  mcpAvailable?: boolean;
  /**
   * F129: Compiled pack blocks to inject.
   * Dual-track priority (ADR-021):
   *   Identity (core) > Pack Masks > Governance L0 > Pack Guardrails > Pack Defaults > Workflows
   */
  packBlocks?: CompiledPackBlocks | null;
}

/**
 * Build static identity prompt — persistent across invocations.
 * Includes: identity, personality, rules, A2A format, workflow triggers,
 * co-creator reference, and MCP tool documentation (session-level).
 * Suitable for --system-prompt / --append-system-prompt injection.
 */
export function buildStaticIdentity(agentId: AgentId, options?: StaticIdentityOptions): string {
  const config = getConfig(agentId as string);
  if (!config) return '';

  const providerLabel = PROVIDER_LABELS[config.clientId] ?? config.clientId;
  const lines: string[] = [];

  // Identity
  const nameLabel = config.nickname
    ? `${config.displayName}/${config.nickname}（${config.name}）`
    : `${config.displayName}（${config.name}）`;
  lines.push(
    `你是 ${nameLabel}，由 ${providerLabel} 提供的 Agent 能力通道。`,
    ...(config.nickname ? [`昵称 "${config.nickname}" 的由来见 docs/stories/agent-names/。`] : []),
    `角色：${config.roleDescription}`,
    `性格：${config.personality}`,
    '',
  );

  // F167 Phase E (KD-20): self-awareness — if this agent has hard restrictions,
  // declare them inline so the agent can recognize illegitimate @-mentions and
  // push back / retreat (instead of accepting and failing). Data-driven from
  // agent-config.restrictions — no harness gate, the agent self-regulates.
  if (config.restrictions && config.restrictions.length > 0) {
    lines.push(
      `你的硬限制：${config.restrictions.join('、')}。被 @ 做这类任务时请 push back 或退回给 @ 你的智能体。`,
      '',
    );
  }

  // F129: Pack masks — role overlay (never changes core identity, see KD-3)
  if (options?.packBlocks?.masksBlock) {
    lines.push(options.packBlocks.masksBlock, '');
  }

  // A2A collaboration format (always included — agents should know how to @ even in single-agent mode)
  const { mentions: callableMentions, hasDuplicateDisplayNames, uniqueHandleExample } = buildCallableMentions(agentId);
  if (callableMentions.length > 0) {
    const exampleTarget = callableMentions[0]!;
    lines.push('## 协作');
    lines.push(`你可以 @队友: ${callableMentions.join(' / ')}`);
    if (hasDuplicateDisplayNames) {
      const example = uniqueHandleExample ?? '@opus';
      lines.push(`同族多分身时：默认 \`@显示名\`，其它用**唯一句柄**（例如 \`${example}\`）。`);
      lines.push(`同名队友并存时，请优先使用唯一句柄（例如 \`${example}\`）避免歧义。`);
    }
    lines.push('格式：另起一行行首写 @Agent 名称（行中无效，多智能体各占一行），上文或下文写请求均可。');
    lines.push(`[正确] ${exampleTarget}\\n请帮忙  [正确] 内容...\\n${exampleTarget}`);
    // F167 Phase F KD-22: model 在 narrative context 会把 @句柄写句中以为会路由。
    // 注意：parseA2AMentions 会 **剥离** markdown 前缀 (`> ` / `- ` / `* ` / `+ ` / `1. `)
    // 再匹配，所以 `- @agent` / `> @agent` 是**合法路由**（不是陷阱）。真正的陷阱是
    // @ 不在剥离后的行首位置——句中 / URL 内 / 任意非首字符。
    lines.push(
      `[错误] 句中 ${exampleTarget}（@ 不是行首也不是剥离 markdown 前缀后的首字符）· URL 内 ${exampleTarget} · 任何非行首位置的 @ 都不路由，球权掉地上。`,
    );
    lines.push(
      `发前自检：我消息里想路由的 @句柄 都在"独立一行的行首"或"markdown 列表/引用前缀后的首字符"吗？URL 内 / 句中任意位置的 @ 不是路由指令。`,
    );
    lines.push('');
  }

  // F-Ground-3: Teammate roster — who to @ and what they're good at
  const rosterLines = buildTeammateRoster(agentId);
  if (rosterLines) {
    lines.push(rosterLines, '');
  }

  // Per-role workflow triggers (fallback to agentId for legacy configs without roleId)
  const triggers = WORKFLOW_TRIGGERS[config.roleId ?? ''] ?? WORKFLOW_TRIGGERS[agentId as string];
  if (triggers) {
    lines.push(triggers, '');
  }

  // F129: Pack workflow blocks (after role workflow triggers)
  const packBlocks = options?.packBlocks;
  if (packBlocks?.workflowsBlock) {
    lines.push(packBlocks.workflowsBlock, '');
  }

  // co-creator reference (session-level, not per-message)
  // F067: Use co-creator config for name + mention handles
  // Note: "不冒充/不编造/身份契约" folded into compiled governance L0
  const coCreator = getCoCreatorConfig();
  const ccName = coCreator.name;
  const ccHandles = coCreator.mentionPatterns.map((p) => `\`${p}\``).join(' / ');
  lines.push(`${ccName}（co-creator/operator）。重要决策由${ccName}拍板。需要关注时行首写 ${ccHandles}。`, '');

  // L0 Governance Digest — compiled from shared-rules.md (#747)
  // Source of truth: agent-studio-skills/refs/shared-rules.md (supports .local/.local-override)
  lines.push('', getGovernanceDigest());

  // F129: Pack guardrails — hard constraint track (only adds strictness, never relaxes Core Rails)
  if (packBlocks?.guardrailBlock) {
    lines.push('', packBlocks.guardrailBlock);
  }

  // F129: Pack defaults — user-overridable behavior track
  if (packBlocks?.defaultsBlock) {
    lines.push('', packBlocks.defaultsBlock);
  }

  // F129: World driver summary (read-only, informational)
  if (packBlocks?.worldDriverSummary) {
    lines.push('', packBlocks.worldDriverSummary);
  }

  // MCP tools documentation — ONLY for Claude (--append-system-prompt survives compression).
  // Non-Claude agents (Codex/Gemini) inject HTTP callback instructions per-message
  // because their systemPrompt lives in session history and may be lost on compression.
  if (options?.mcpAvailable) {
    lines.push('', MCP_TOOLS_SECTION.trim());
  }

  return lines.join('\n');
}

/**
 * F203 Phase C (Task 2): the pack-only slice of the static identity.
 *
 * After L0 (non-pack identity / A2A / roster / workflow triggers / operator ref /
 * governance digest / MCP) moves to the compression-immune native system role
 * (`--system-prompt-file` for Claude, `-c developer_instructions` for Codex —
 * Task 3/4), the user-message `systemPrompt` must carry ONLY the F129 pack
 * blocks: per-invocation dynamic + external-project-specific, so they must
 * never be baked into the cached native prompt nor duplicated there.
 *
 * Returns '' for an unknown agent or when there are no pack blocks — the route
 * layer's `...(x ? { systemPrompt: x } : {})` then omits the prepend entirely.
 *
 * Block order mirrors buildStaticIdentity's dual-track priority (ADR-021):
 * masks → workflows → guardrails → defaults → worldDriver. buildStaticIdentity
 * keeps its own interleaved push sites unchanged (guard tests must not
 * regress); both paths consume the same `CompiledPackBlocks` contract.
 */
export function buildStaticIdentityPackOnly(agentId: AgentId, options?: StaticIdentityOptions): string {
  const config = getConfig(agentId as string);
  if (!config) return '';
  const pb = options?.packBlocks;
  if (!pb) return '';
  const blocks = [pb.masksBlock, pb.workflowsBlock, pb.guardrailBlock, pb.defaultsBlock, pb.worldDriverSummary].filter(
    (b): b is string => typeof b === 'string' && b.trim().length > 0,
  );
  return blocks.join('\n\n');
}

/**
 * Build dynamic invocation context — changes per call.
 * Includes: teammates, mode, chain position, prompt tags.
 * (MCP tools and co-creator reference moved to buildStaticIdentity for session-level injection.)
 */
export function buildInvocationContext(context: InvocationContext): string {
  const config = getConfig(context.agentId as string);
  if (!config) return '';

  const lines: string[] = [];
  const runtimeModel = (() => {
    try {
      return getAgentModel(context.agentId as string);
    } catch {
      return config.defaultModel;
    }
  })();

  // F042: Identity constant — pinned per invocation to survive compression.
  lines.push(
    `Identity: ${config.displayName}${config.nickname ? `/${config.nickname}` : ''} (@${context.agentId}, model=${runtimeModel})`,
  );

  // F042 + F167: A2A direct-message reply target + identity anti-spoofing.
  // When handoff comes from a same-role variant (same displayName, different agentId),
  // inject explicit model markers + "not-you" reminder to prevent identity collapse
  // (e.g. opus-47 receiving from opus-default conflating itself with the 4.6 variant).
  if (context.directMessageFrom && context.directMessageFrom !== context.agentId) {
    const fromConfig = getConfig(context.directMessageFrom as string);
    const fromLabel = formatHandleFreeLabel(context.directMessageFrom as string, fromConfig);
    const fromModel = (() => {
      try {
        return getAgentModel(context.directMessageFrom as string);
      } catch {
        return fromConfig?.defaultModel ?? 'unknown';
      }
    })();
    lines.push(`Direct message from ${fromLabel} [model=${fromModel}]; reply to ${fromLabel}`);
    // Anti-spoofing fires only for same-role variant handoffs (displayName collision + agentId differs)
    if (fromConfig && fromConfig.displayName === config.displayName) {
      const selfVariant = config.variantLabel ?? runtimeModel;
      const fromVariant = fromConfig.variantLabel ?? fromModel;
      lines.push(
        `⚠️ 同族分身提醒：对方是 ${fromVariant}（model=${fromModel}），你是 ${selfVariant}（model=${runtimeModel}）——两个独立分身，不是你的旧版或新版。`,
      );
    }
  }

  // F193 AC-B2: Cross-thread reply hint.
  // Cross-post triggered invocation (F052 sourceThreadId injected by API).
  // Without this hint, the receiving agent sees a truncated 8-char thread
  // string (ContextAssembler) and has no sender agentId — guesses wrong how
  // to reply. Local @ won't route back across threads.
  if (context.crossThreadReplyHint) {
    const { sourceThreadId, senderAgentId } = context.crossThreadReplyHint;
    lines.push(
      `📨 来自跨线程消息（source thread: ${sourceThreadId}，发件智能体: @${senderAgentId}）`,
      `回复请用 cross_post_message(threadId="${sourceThreadId}", targetAgents=["${senderAgentId}"])`,
      `本 thread 的 @${senderAgentId} 不会路由回对方（对方 session 在另一个 thread）`,
    );
  }

  // F167 L1: ping-pong streak warning — inject when this agent just received the ball
  // in a same-pair streak >= 2 (but < 4, else it would have been blocked upstream).
  if (context.pingPongWarning) {
    const otherConfig = getConfig(context.pingPongWarning.pairedWith as string);
    const otherLabel = formatHandleFreeLabel(context.pingPongWarning.pairedWith as string, otherConfig);
    lines.push(
      `🏓 乒乓球警告：你和 ${otherLabel} 已连续互相 @ ${context.pingPongWarning.count} 轮。思考是否真的需要再回一棒——第三方介入？收尾给co-creator？还是这轮可以不 @？再 @ 2 轮将自动熔断。`,
    );
  }

  // Teammates — only list agents actually in this invocation
  if (context.teammates.length > 0) {
    lines.push('你的队友：');
    for (const id of context.teammates) {
      const c = getConfig(id as string);
      if (c) {
        const tmName = c.nickname ? `${c.displayName}/${c.nickname}` : c.displayName;
        lines.push(`- ${tmName}（${c.name}）：${c.roleDescription}`);
      }
    }
  }
  // Mode context
  if (context.mode === 'serial' && context.chainIndex != null && context.chainTotal != null) {
    lines.push(
      `当前模式：你是第 ${context.chainIndex}/${context.chainTotal} 只被召唤的智能体，请注意前面智能体的回复。`,
      '',
    );
  } else if (context.mode === 'parallel') {
    lines.push(
      '当前模式：并行模式——独立思考。你和队友各自独立回答同一问题，给出你自己的观点。',
      `重要：你是 ${config.displayName}（@${context.agentId}），不要复制或模仿其他智能体的自我介绍。`,
      'F167 L2: @句柄 在并行模式下无路由语义（各智能体并发、无先后顺序），不要互相 @；需要提醒队友做后续动作请等串行轮再说。',
      '',
    );
  } else {
    lines.push('当前模式：独立回答。', '');
  }

  // A2A: Exit check reminder — prevents "chain termination blind spot" where agents finish output
  // without considering whether a teammate needs to act next.
  if (context.mode !== 'parallel' && context.a2aEnabled) {
    lines.push(
      `A2A 球权检查：@ = 球权转移（行首 @句柄，句中无效）。收到 @ 但对方说"我在动" → 矛盾，push back + 立刻接/退/升（诊断≠解决，说完不@=球还在地上）。收了球却说"你等着/你别动" → 球权死锁，禁止——做不了就退回或升级。球权只有第一人称：只能声明自己持球，不能声明别人持球——没有 @ 或 hold_ball 动作，球权就没转移。`,
      '',
    );
  }

  // F064: One-shot feedback when previous @mention was not routed.
  if (context.mentionRoutingFeedback && context.mentionRoutingFeedback.items?.length > 0) {
    const items = context.mentionRoutingFeedback.items.slice(0, 2).map((it) => `@${it.targetAgentId}`);
    lines.push(
      `[路由提醒] 上次你提到了 ${items.join('、')} 但没有用行首 @ 路由。如果需要对方行动，请在行首独立一行写 @句柄。`,
      '',
    );
  }

  // Prompt tags
  if (context.promptTags?.includes('critique')) {
    lines.push('思维方式：批判性分析。挑战假设，找出漏洞，提出反例。', '');
  }

  // F140 Phase C: connector-triggered skill suggestion (hint, not directive)
  const skillTag = context.promptTags?.find((t) => t.startsWith('skill:'));
  if (skillTag) {
    lines.push(`⚡ Signal-triggered action → load skill: ${skillTag.slice(6)}`, '');
  }

  // F042 Wave 3: Active participant hint — re-injected per-invocation, survives compression.
  if (context.activeParticipants && context.activeParticipants.length > 0) {
    const topActive = context.activeParticipants
      .filter((p) => p.agentId !== context.agentId)
      .find((p) => p.lastMessageAt > 0);
    if (topActive) {
      const topConfig = getConfig(topActive.agentId as string);
      if (topConfig) {
        lines.push(`最近活跃：${formatHandleFreeLabel(topActive.agentId as string, topConfig)}`);
      }
    }
  }

  // F042: Thread routing policy hint — short, per-invocation, survives compression.
  if (context.routingPolicy?.v === 1 && context.routingPolicy.scopes) {
    const toMention = (id: string): string => {
      const c = getConfig(id);
      return c ? pickVariantMention(id, c) : `@${id}`;
    };

    const parts: string[] = [];
    const scopes = context.routingPolicy.scopes;
    const order = ['review', 'architecture'] as const;
    for (const scope of order) {
      const rule = scopes[scope];
      if (!rule) continue;
      if (typeof rule.expiresAt === 'number' && rule.expiresAt > 0 && rule.expiresAt < Date.now()) continue;

      const segs: string[] = [];
      // Defensive guard: data might be malformed from external persistence.
      const avoidList = Array.isArray(rule.avoidAgents) ? rule.avoidAgents : [];
      const preferList = Array.isArray(rule.preferAgents) ? rule.preferAgents : [];
      const avoid = avoidList.slice(0, 3).map((id) => toMention(String(id)));
      const prefer = preferList.slice(0, 3).map((id) => toMention(String(id)));
      if (avoid.length > 0) segs.push(`avoid ${avoid.join(', ')}`);
      if (prefer.length > 0) segs.push(`prefer ${prefer.join(', ')}`);
      const sanitizedReason = typeof rule.reason === 'string' ? rule.reason.replace(/[\r\n]+/g, ' ').trim() : '';
      if (sanitizedReason) segs.push(`(${sanitizedReason})`);

      if (segs.length > 0) parts.push(`${scope} ${segs.join(' ')}`);
    }

    if (parts.length > 0) {
      lines.push(`Routing: ${parts.join('; ')}`);
    }
  }

  // F073 P4: SOP stage hint — 告示牌 (bulletin board, not controller)
  if (context.sopStageHint) {
    const { stage, suggestedSkill, suggestedSkillSource, featureId } = context.sopStageHint;
    const sourcePart = suggestedSkillSource ? ` (${suggestedSkillSource})` : '';
    lines.push(`SOP: ${featureId} stage=${stage} → load skill: ${suggestedSkill}${sourcePart}`);
  }

  // F092: Voice companion mode — instruct agents to prioritize audio output
  if (context.voiceMode) {
    lines.push(
      'Voice Mode ON: co-creator在语音陪伴模式。',
      '- 默认用 audio rich block；代码/表格/长内容用文字并附语音摘要',
      '',
    );
  } else {
    lines.push(
      'Voice Mode OFF: 不强制发语音。默认用文字回复。你仍然可以发 audio rich block，但仅在co-creator明确要求语音时才发。',
      '',
    );
  }

  // F087: Bootcamp mode — inject phase context so agents know to guide the new operator
  if (context.bootcampState) {
    const { phase, leadAgent, selectedTaskId } = context.bootcampState;
    const threadPart = context.threadId ? ` thread=${context.threadId}` : '';
    const membersPart = context.bootcampMemberCount != null ? ` members=${context.bootcampMemberCount}` : '';
    lines.push(
      `🎓 Bootcamp Mode:${threadPart} phase=${phase}${leadAgent ? ` leadAgent=${leadAgent}` : ''}${selectedTaskId ? ` task=${selectedTaskId}` : ''}${membersPart}`,
      '→ Load bootcamp-guide skill and act per current phase.',
      '',
    );
  }

  // F155: Guide candidate — inline protocol (agents don't have /Skill tool at runtime)
  if (context.guideCandidate) {
    lines.push(...buildGuidePromptLines(context.guideCandidate, context.threadId));
  }

  // F229: Concierge duty section — injected only for per-user concierge threads
  if (context.threadKind === 'concierge' && context.conciergeConfig) {
    lines.push(...buildConciergePromptLines(context.conciergeConfig, context.threadId));
  }

  // F093: World context envelope — inject world state for world-building mode
  if (context.worldContext) {
    const wc = context.worldContext;
    lines.push('');
    lines.push(`## 🌍 World: ${wc.world.name} [${wc.world.status}]`);
    if (wc.world.constitution) lines.push(`Constitution: ${wc.world.constitution}`);
    lines.push(`Scene: ${wc.scene.name} [${wc.scene.status}]`);
    if (wc.characters.length > 0) {
      lines.push('Characters:');
      for (const ch of wc.characters) {
        const identity = ch.coreIdentity?.name ?? ch.characterId;
        const drive = ch.innerDrive?.motivation ? ` — ${ch.innerDrive.motivation}` : '';
        lines.push(`- ${identity}${drive}`);
      }
    }
    if (wc.canonSummary.length > 0) {
      lines.push('Established canon:');
      for (const cs of wc.canonSummary) lines.push(`- ${cs.summary}`);
    }
    if (wc.recentEvents.length > 0) {
      lines.push(`Recent events (${wc.recentEvents.length}):`);
      for (const ev of wc.recentEvents.slice(-5)) {
        lines.push(`- [${ev.type}] ${JSON.stringify(ev.payload)}`);
      }
    }
    if (wc.careLoopHint) {
      lines.push(`Care hint: ${wc.careLoopHint.trigger} → ${wc.careLoopHint.suggestion}`);
    }
    lines.push('');
  }

  // F163 AC-A3: always_on constitutional knowledge injection (physical, not retrieval)
  if (context.alwaysOnDocs && context.alwaysOnDocs.length > 0) {
    lines.push('');
    lines.push('## Constitutional Knowledge (always_on)');
    lines.push('');
    for (const doc of context.alwaysOnDocs) {
      lines.push(`### ${doc.title}`);
      lines.push('');
      lines.push(doc.summary);
      lines.push('');
    }
  }

  // F091: Active Signal articles in discussion context
  if (context.activeSignals && context.activeSignals.length > 0) {
    lines.push('Signal articles linked to this thread:');
    for (const s of context.activeSignals) {
      lines.push(`### [${s.id}] ${s.title} (${s.source}/T${s.tier})`);
      if (s.note) lines.push(`Note: ${s.note}`);
      lines.push(s.contentSnippet);
      // AC-10: Related discussions from our memory architecture (session search)
      if (s.relatedDiscussions && s.relatedDiscussions.length > 0) {
        lines.push('Related past discussions:');
        for (const d of s.relatedDiscussions) {
          lines.push(`- [session:${d.sessionId}] ${d.snippet}`);
        }
      }
    }
  }

  // F167 Phase D: Trailing anchor — decision tree, not flat three-choice.
  // @co-creator is a hard-condition exit, not the safe default (KD-19).
  // Placed at the very end for maximum recency bias (critical for non-Claude models).
  if (context.mode !== 'parallel' && context.a2aEnabled) {
    const cc = getCoCreatorConfig().mentionPatterns[0] ?? '@co-creator';
    lines.push(
      '',
      `下一棒传球决策树（本轮必选其一，缺 = 消息不完整）：先问"下一步谁能做"——`,
      `1. 另一个智能体能做 → @句柄（review 完→@author / 修完→@reviewer / merge 完→@愿景守护智能体）`,
      `2. 等外部条件（按 2a/2b 判断行动）。外部条件包括：**云端 codex / GitHub bot review / PR check / CI / 长 build / 外部 webhook**——这些不是本地智能体，不在 roster，不可 @ 任何本地近似 proxy；CLI 要退出但还需继续也走这条。2a 无回调覆盖（如等 EYES）→ **调用 agent_studio_hold_ball(...)** + 轮询（口头"我继续"不算）；2b 已有结构化回调且 EYES>0 → 纯事件驱动，**不调用/不续约 hold_ball**（KD-27）`,
      `3. 只有co-creator本人才能做 → ${cc}（硬条件：不可逆操作 / 愿景级决策 / 跨智能体僵局）`,
      `${cc} 不是默认出口——先问"哪个智能体能接"。反问式 ping 非法（"要不要 X？"/"同意吗？"）：有立场就自决去做（错了能回滚），没立场根本不该 @。**外部 identity（云端 xxx / GitHub bot / CI）** 永远走选项 2（按 2a/2b 判断），严禁投射成本地 @句柄。`,
    );
  }

  return lines.join('\n');
}

/**
 * F032 Phase D2: Build reviewer section for system prompt.
 * Shows available reviewers based on roster, filtered by family.
 *
 * Cloud Codex R5 P2 fix: When requireDifferentFamily is enabled but no cross-family
 * reviewers are available, show same-family reviewers as fallback options to match
 * the actual degradation behavior in resolveReviewer().
 *
 * Cloud Codex R6 P2 fix: Respect excludeUnavailable policy. When false, show
 * unavailable agents as available to match resolveReviewer() behavior.
 */
export function buildReviewerSection(agentId: AgentId): string | null {
  const roster = getRoster();
  const policy = getReviewPolicy();

  // If no roster configured, skip reviewer section
  if (Object.keys(roster).length === 0) return null;

  const currentEntry = roster[agentId];
  if (!currentEntry) return null;

  // Collect reviewers in separate buckets
  const crossFamily: string[] = [];
  const sameFamily: string[] = [];
  const unavailable: string[] = [];

  for (const [id, entry] of Object.entries(roster)) {
    // Skip self
    if (id === agentId) continue;
    // Must have peer-reviewer role
    if (!agentHasRole(id, 'peer-reviewer')) continue;

    const config = getConfig(id);
    const displayName = config?.displayName ?? id;
    const isLead = isAgentLead(id);
    const isDifferentFamily = entry.family !== currentEntry.family;

    // Build description
    const tags: string[] = [];
    if (isDifferentFamily) tags.push(entry.family);
    if (isLead) tags.push('lead');
    const desc = tags.length > 0 ? ` (${tags.join(', ')})` : '';
    const mention = `@${id}`;
    const line = `- ${mention}${desc}`;

    // Cloud Codex R6 P2 fix: Respect excludeUnavailable policy
    // When excludeUnavailable=false, treat all agents as "effectively available"
    const isEffectivelyAvailable = !policy.excludeUnavailable || isAgentAvailable(id);

    if (isEffectivelyAvailable) {
      if (isDifferentFamily) {
        crossFamily.push(line);
      } else {
        sameFamily.push(line);
      }
    } else {
      unavailable.push(`- ${mention} (${displayName}, 没智能体粮)`);
    }
  }

  // Determine which reviewers to show as "available"
  let available: string[];
  let fallbackNote: string | null = null;

  if (policy.requireDifferentFamily) {
    if (crossFamily.length > 0) {
      // Cross-family available, show them
      available = crossFamily;
    } else if (sameFamily.length > 0) {
      // Cloud Codex R5 P2 fix: No cross-family, but same-family available as fallback
      available = sameFamily;
      fallbackNote = '[注意] 没有跨家族 reviewer 可用，以下同家族智能体可作为 fallback：';
    } else {
      available = [];
    }
  } else {
    // No family requirement, show all available
    available = [...crossFamily, ...sameFamily];
  }

  // Don't generate section if no reviewers at all
  if (available.length === 0 && unavailable.length === 0) return null;

  const lines: string[] = ['## 你当前的 Reviewers', ''];
  if (available.length > 0) {
    if (fallbackNote) {
      lines.push(fallbackNote);
    } else {
      lines.push('根据 roster 配置，你当前可以找以下智能体 review：');
    }
    lines.push(...available);
    lines.push('');
  }
  if (unavailable.length > 0) {
    lines.push('[注意] 以下智能体当前不可用：');
    lines.push(...unavailable);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Build identity system prompt for a agent invocation.
 * Backward-compatible: returns staticIdentity + invocationContext combined.
 * Pure function — same inputs always produce same output.
 */
export function buildSystemPrompt(context: InvocationContext): string {
  const staticPart = buildStaticIdentity(context.agentId, {
    mcpAvailable: context.mcpAvailable,
    packBlocks: context.packBlocks,
  });
  if (!staticPart) return '';

  const parts: string[] = [staticPart];

  // F032 Phase D2: Inject reviewer section if available
  const reviewerSection = buildReviewerSection(context.agentId);
  if (reviewerSection) parts.push(reviewerSection);

  // Invocation-specific context
  const dynamicPart = buildInvocationContext(context);
  if (dynamicPart) parts.push(dynamicPart);

  return parts.join('\n\n');
}

// L0-budget-defense PR-B-impl (ADR-038 件套 ④): staging is now injected directly
// in invoke-single-agent at the per-invocation prompt prefix level (mirrors F225
// contextHintPrefix), NOT folded into staticIdentity at route-serial/parallel.
//
// Cloud R2 P1 #2237 L1099 (root cause): folding staging into staticIdentity
// causes resumed session-chain turns to drop staging, because invoke-single-agent
// skips systemPrompt injection on canSkipOnResume + isResume turns. Staging
// must apply EVERY turn per ADR-038 "每轮注入生效" contract → wire it
// independently of injectSystemPrompt.
//
// buildLiveStaticIdentity removed. buildStagingPrepend (in StagingContent.ts)
// is the single source — invoke-single-agent consumes it directly.
