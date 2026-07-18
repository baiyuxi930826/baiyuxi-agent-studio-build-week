#!/usr/bin/env node
/**
 * F203 Phase B: Compile per-agent L0 string from system-prompt-l0.md template.
 *
 * Template variables (injected per invocation, not statically baked):
 *   {{IDENTITY_BLOCK}}      — agentId / displayName / nickname / role / personality / restrictions
 *   {{USER_CAPSULE}}        — per-user profile capsule (F231): owner portrait + optional primer pointer
 *   {{TEAMMATE_ROSTER}}     — table of other available agents with @mention · model · strengths · caution
 *   {{GOVERNANCE_L0}}       — compact governance block compiled from shared-rules.md
 *   {{WORKFLOW_TRIGGERS}}   — per-role workflow triggers (lead-architect / code-reviewer / frontend-designer)
 *
 * Output: string ready for `claude --system-prompt <out>` or
 * `codex exec -c 'developer_instructions=<out>'`.
 *
 * Usage:
 *   import { compileL0 } from './scripts/compile-system-prompt-l0.mjs';
 *   const l0 = await compileL0({ agentId: 'opus-47' });
 *
 * CLI:
 *   node scripts/compile-system-prompt-l0.mjs --agent opus-47
 *
 * TODO(F203/Phase-C): WORKFLOW_TRIGGERS_INLINE is duplicated from
 * SystemPromptBuilder.ts:366. Phase C should export it from the builder
 * and delete the duplicate (P4 single source of truth).
 */

import { accessSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentRegistry } from '@agent-studio/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const TEMPLATE_PATH = resolve(REPO_ROOT, 'assets/system-prompts/system-prompt-l0.md');

let _bootstrapped = false;
// 云端 review round-2 P1: bootstrap 必须用 no-arg loadAgentConfig()——
// 它做 template base + `.agent-studio/agent-catalog.json` overlay deep merge
// (agent-config-loader.ts:307-327)，反映 runtime 真相（含 disabled 智能体）。
// 旧实现 loadAgentConfig(AGENT_TEMPLATE_PATH) 显式 path 跳过 catalog overlay
// → isAgentAvailable 基于 stale template → round-1 P2 fix 实际无效
// （dead-end @ 路由没真正防住）。no-arg DEFAULT 反推 worktree root
// agent-template.json + 同目录 catalog overlay，路径正确。
// 测试隔离：测试可设 process.env.AGENT_TEMPLATE_PATH 指向隔离 template。
let _loadedConfig = null;
let _isAgentAvailable = null;
let _getAgentModel = null;
let _loadCompiledGovernanceL0 = null;
// Phase C Task 1 (A8 gap): operator ref handles 必须来自 co-creator config
// 渲染（buildStaticIdentity L568-571 同源），非 L0 硬编码 @co-creator——
// 否则删 user message 后 co-creator 多 handle / 自定义 name 丢失。
let _coCreatorConfig = null;
async function bootstrapAgentRegistry() {
  if (_bootstrapped) return;
  const { loadAgentConfig, toAllAgentConfigs, isAgentAvailable, getCoCreatorConfig } = await import(
    '../packages/api/dist/config/agent-config-loader.js'
  );
  const { getAgentModel } = await import('../packages/api/dist/config/agent-models.js');
  const { loadCompiledGovernanceL0 } = await import(
    '../packages/api/dist/domains/agents/services/context/governance-l0.js'
  );
  _loadedConfig = loadAgentConfig(); // no-arg: template + catalog overlay (runtime truth)
  _isAgentAvailable = isAgentAvailable;
  _getAgentModel = getAgentModel;
  _loadCompiledGovernanceL0 = loadCompiledGovernanceL0;
  _coCreatorConfig = getCoCreatorConfig(_loadedConfig);
  const allConfigs = toAllAgentConfigs(_loadedConfig);
  for (const [id, config] of Object.entries(allConfigs)) {
    if (!agentRegistry.has(id)) {
      agentRegistry.register(id, config);
    }
  }
  _bootstrapped = true;
}

/**
 * 云端 review P1: 跨平台 CLI 入口检测。
 * 旧实现 `import.meta.url === \`file://${process.argv[1]}\`` 只匹配
 * POSIX 路径；Windows argv1=`C:\...` 而 import.meta.url=`file:///C:/...`
 * → 条件恒 false，CLI path 在 Windows 永不执行。改用 Node 自己的
 * fileURLToPath + resolve 做绝对路径比较（处理相对 argv1 + Windows 盘符）。
 */
export function isCliEntrypoint(metaUrl, argv1) {
  if (!argv1) return false;
  try {
    // Desktop packaged layout: service-manager mirrors scripts/ into a
    // user-writable project dir via symlink (project/scripts → .app/.../
    // Resources/scripts). Node ESM resolves import.meta.url to the real
    // path (inside .app) while process.argv[1] keeps the symlink path
    // → naive comparison always mismatches → CLI entry never fires.
    // realpathSync both sides so symlink vs real path compares correctly.
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(resolve(argv1));
  } catch {
    return false;
  }
}

/**
 * 云端 review P2: 队友名册只列 available 智能体。
 * disabled 智能体进 roster → handoff 指令 @ 已下线智能体 = dead-end 路由。
 * 纯函数，可注入 isAvailableFn 测试。
 */
export function filterAvailableTeammates(allConfigs, currentAgentId, isAvailableFn) {
  return Object.entries(allConfigs).filter(([id]) => id !== currentAgentId && isAvailableFn(id));
}

// TODO(F203/Phase-C): replace with `import { WORKFLOW_TRIGGERS } from
// '@agent-studio/api/.../SystemPromptBuilder'` once exported.
const MERGE_GATE_SOURCE_PROVENANCE_TRIGGER = '- MG provenance override：外部finding修完后等PR truth，不@旧reviewer。';

const WORKFLOW_TRIGGERS_INLINE = {
  'architecture-development': [
    '## 工作流（主动 @ 触发点）',
    '- 完成开发/修复 → @code-review 请 review',
    '- 修完 review 意见 → @code-review 确认修复',
    MERGE_GATE_SOURCE_PROVENANCE_TRIGGER,
    '- 遇到视觉/体验问题 → @frontend-visual 征询',
    '- 遇到资料/文档问题 → @research-docs 协助整理',
    '- Review 别人代码：每个发现给明确立场（放行/退回 + 理由）',
  ].join('\n'),
  'code-review': [
    '## 工作流（主动 @ 触发点）',
    '- 完成 review → @architecture-development 通知结果',
    '- 修完 bug/feature → @architecture-development 请 review',
    MERGE_GATE_SOURCE_PROVENANCE_TRIGGER,
    '- serial/handoff 场景且需要对方行动 → @ 对应智能体（parallel 模式各自独立，不互 @）',
    '- 发现需要架构决策 → @architecture-development 征询',
    '- 发现需要界面判断 → @frontend-visual 征询',
    '- Review 代码：每个发现给明确立场（放行/退回 + 理由）',
    '- 收到 review 意见：独立判断，认为自己对就 push back（Rule 0），不全盘接受',
    '',
    '### 执行纪律',
    '- 加载 Skill 后直接执行第一步（产出 > 复述）',
    '- 接球后静默执行：收到"放行"后沉默做到下一状态迁移点（BLOCKED / REVIEW READY / DONE）',
    '- 声明 = 执行：说"我进 merge gate"必须同 turn 加载 skill 并执行',
    '- 只发状态迁移消息，中间产物留在代码里',
    '- 完成任务后必须 @ 下一棒',
    '- 若识别到角色不匹配或方向有问题，先通知对方再执行（Rule 0）',
    '',
    '### 出口一问（发消息前必问）',
    '我这条消息结尾有没有 @ 下一棒？没有 → 是真的不需要，还是我忘了？',
  ].join('\n'),
  'frontend-visual': [
    '## 工作流（主动 @ 触发点）',
    '- 完成设计/视觉资产 → 分别 @architecture-development 和 @code-review 请确认（每个智能体各占一行）',
    '- 遇到技术实现问题 → @architecture-development 征询',
    '- 需要资料支撑或竞品对比 → @research-docs 协助',
    '',
    '### 执行纪律',
    '- 加载 Skill 后直接执行第一步（产出 > 复述）',
    '- 涉及 UI/前端验证时：通过截图产出证据',
    '- 接球后静默执行到下一状态点（DONE / HANDOFF）',
    '- 若识别到角色不匹配或方向有问题，先通知对方再执行（Rule 0）',
    '',
    '### 出口一问（发消息前必问）',
    '我这条消息结尾有没有 @ 下一棒？没有 → 是真的不需要，还是我忘了？',
  ].join('\n'),
  'research-docs': [
    '## 工作流（主动 @ 触发点）',
    '- 完成资料整理/文档草案 → @architecture-development 请确认方案方向',
    '- 文档涉及代码质量、风险或测试结论 → @code-review 请复核',
    '- 文档涉及界面、截图或视觉证据 → @frontend-visual 请补证据',
    '',
    '### 执行纪律',
    '- 给出处、范围和不确定性，不把推测写成事实',
    '- 输出结构化结论，避免只堆资料',
  ].join('\n'),
  'lead-architect': [
    '## 工作流（主动 @ 触发点）',
    '- 完成开发/修复 → @Code Reviewer 请 review',
    '- 修完 review 意见 → @Code Reviewer 确认修复',
    MERGE_GATE_SOURCE_PROVENANCE_TRIGGER,
    '- 遇到视觉/体验问题 → @Frontend Designer 征询',
    '- Review 别人代码：每个发现给明确立场（放行/退回 + 理由）',
    '',
    '### Lead Architect家族治理（46 hotfix 止血 F177 Phase E）',
    'commit/PR title 含 `fix:`/`hotfix:`/`quick fix`/`minimal fix`/`band-aid`/`temp`/`workaround` → 归类 hotfix。单文件 ≤50 行 + 关键词 → 自动加 `hotfix` label。hotfix PR 必须跨智能体 review（禁止 self-merge）；quality-gate 禁止作者 self-validate。2 周升级 review cron：升级正式修复 / 接受永久方案 / 已不再相关 三选一。',
  ].join('\n'),
  'code-reviewer': [
    '## 工作流（主动 @ 触发点）',
    '- 完成 review → @Lead Architect 通知结果',
    '- 修完 bug/feature → @Lead Architect 请 review',
    MERGE_GATE_SOURCE_PROVENANCE_TRIGGER,
    '- serial/handoff 场景且需要对方行动 → @ 对应智能体（parallel 模式各自独立，不互 @）',
    '- 发现需要架构决策 → @Lead Architect 征询',
    '- Review 代码：每个发现给明确立场（放行/退回 + 理由）',
    '- 收到 review 意见：独立判断，认为自己对就 push back（Rule 0），不全盘接受',
    '',
    '### 执行纪律',
    '- 加载 Skill 后直接执行第一步（产出 > 复述）',
    '- 接球后静默执行：收到"放行"后沉默做到下一状态迁移点（BLOCKED / REVIEW READY / DONE）',
    '- 声明 = 执行：说"我进 merge gate"必须同 turn 加载 skill 并执行',
    '- 只发状态迁移消息，中间产物留在代码里',
    '- 完成任务后必须 @ 下一棒',
    '- 若识别到角色不匹配或方向有问题，先通知对方再执行（Rule 0）',
    '',
    '### 出口一问（发消息前必问）',
    '我这条消息结尾有没有 @ 下一棒？没有 → 是真的不需要，还是我忘了？',
    '',
    '### Code Reviewer家族治理（fallback 层数检测 F177 Phase D）',
    '同文件新增 ≥3 层 fallback (`try/catch`/`??`/`||`/`else-if`) → 坐标系自检：① 修对还是补错？② 变换消除？③ 每层为何不能去？',
    '',
    '### 长任务纪律',
    '- exec_command session_id 存活 → 续 write_stdin。',
    '- bash&/nohup/disown/setsid = 伪后台；真后台用 detached spawn + unref。',
    '- Fire-and-forget → pid/log/exit 探针轮询。',
  ].join('\n'),
  'frontend-designer': [
    '## 工作流（主动 @ 触发点）',
    '- 完成设计/视觉资产 → 分别 @Lead Architect 和 @Code Reviewer 请确认（每个智能体各占一行）',
    '- 遇到技术实现问题 → @Lead Architect 征询',
    '',
    '### 执行纪律',
    '- 加载 Skill 后直接执行第一步（产出 > 复述）',
    '- 涉及 UI/前端验证时：通过截图产出证据',
    '- 接球后静默执行到下一状态点（DONE / HANDOFF）',
    '- 若识别到角色不匹配或方向有问题，先通知对方再执行（Rule 0）',
    '',
    '### 出口一问（发消息前必问）',
    '我这条消息结尾有没有 @ 下一棒？没有 → 是真的不需要，还是我忘了？',
    '',
    '### Frontend Designer家族治理（创意-实现解耦 F177 Phase C）',
    '发现问题 ≠ 动手改代码 → 记录 + handoff 执行智能体（查 roster）。Edit 白名单：`designs/`/`docs/`/`assets/`/根目录 `.md`。碰 `packages/`/`src/` 必须 handoff。Dry Run Gate：Frontend Designer签名 commit 改了白名单外文件 → hook 自动跑 build + test。',
  ].join('\n'),
  // F203 Phase I: tooling-engineer (OpenCode) workflow — developer agent 共享
  // lead-architect 基础流 + OpenCode 专属 OMOC 编排边界 + provider-agnostic 注意事项。
  'tooling-engineer': [
    '## 工作流（主动 @ 触发点）',
    '- 完成开发/修复 → @Code Reviewer 请 review',
    '- 修完 review 意见 → @Code Reviewer 确认修复',
    MERGE_GATE_SOURCE_PROVENANCE_TRIGGER,
    '- 遇到视觉/体验问题 → @Frontend Designer 征询',
    '- Review 别人代码：每个发现给明确立场（放行/退回 + 理由）',
    '',
    '### 执行纪律',
    '- 加载 Skill 后直接执行第一步（产出 > 复述）',
    '- 接球后静默执行到下一状态迁移点（BLOCKED / REVIEW READY / DONE）',
    '- 完成任务后必须 @ 下一棒',
    '- 若识别到角色不匹配或方向有问题，先通知对方再执行（Rule 0）',
    '',
    '### 出口一问（发消息前必问）',
    '我这条消息结尾有没有 @ 下一棒？没有 → 是真的不需要，还是我忘了？',
    '',
    '### OpenCode 专属治理',
    'OMOC Sisyphus 只编排自己的 sub-agent，不编排其他智能体。opencode 原生 MCP 和 Baiyuxi Agent Studio MCP 需避免 tool 名冲突。',
    '`question` 工具已 deny——co-creator通过 Hub 交互，不走 OpenCode TUI 弹窗。提问用回复文本或 `agent_studio_create_rich_block(kind=interactive)`。',
  ].join('\n'),
};

function buildIdentityBlock(config, runtimeModel) {
  const lines = [];
  const nameLabel = config.nickname
    ? `${config.displayName}/${config.nickname}（${config.name}）`
    : `${config.displayName}（${config.name}）`;
  lines.push(`你是 ${nameLabel}。`);
  if (config.nickname) {
    lines.push(`昵称 "${config.nickname}" 的由来见 \`docs/stories/agent-names/\`。`);
  }
  lines.push(`角色：${config.roleDescription}`);
  lines.push(`性格：${config.personality}`);
  // Bug fix: CLI 不传 runtimeModel 导致 L0 缺模型号，智能体读 CLAUDE.md 硬编码签名出错。
  // fallback 链：runtimeModel（显式传入）> resolveModel（env override）> defaultModel。
  const resolvedModel = runtimeModel || resolveModel(config.agentId ?? '', config);
  if (resolvedModel) {
    lines.push(`Identity constant: \`@${config.agentId ?? ''}\` model=${resolvedModel}`);
  }
  if (config.restrictions && config.restrictions.length > 0) {
    lines.push('');
    lines.push(`**硬限制**：${config.restrictions.join('、')}。被 @ 做这类任务时请 push back 或退回给 @ 你的智能体。`);
  }
  return lines.join('\n');
}

function rosterLabel(cfg) {
  if (cfg.variantLabel) return `${cfg.displayName} ${cfg.variantLabel}`;
  if (cfg.nickname) return `${cfg.displayName}/${cfg.nickname}`;
  return cfg.displayName;
}

// 云端 review round-2 P2: roster 列标"当前模型"，必须 runtime resolve
// （getAgentModel: env AGENT_{AGENTID}_MODEL override > agentRegistry），不能用
// 静态 cfg.defaultModel——否则 env model override 下广告错误队友模型，
// 误导 handoff。对齐 SystemPromptBuilder.ts:434（既定 runtime 模式）。
function resolveModel(id, cfg) {
  if (_getAgentModel) {
    try {
      return _getAgentModel(id);
    } catch {
      // getAgentModel throws if agent unknown — fall back to static defaultModel
    }
  }
  return cfg.defaultModel ?? '';
}

function buildRosterRow(id, cfg) {
  const mention = cfg.mentionPatterns?.[0] ?? `@${id}`;
  const model = resolveModel(id, cfg);
  const cell = model ? `${mention} · ${model}` : mention;
  const strengths = cfg.teamStrengths ?? cfg.roleDescription;
  const hasRestrictions = cfg.restrictions && cfg.restrictions.length > 0;
  const restrictions = hasRestrictions ? `**硬限制**：${cfg.restrictions.join('、')}` : null;
  const caution = [cfg.caution ?? null, restrictions].filter(Boolean).join('；') || '—';
  return `| ${rosterLabel(cfg)} | ${cell} | ${strengths} | ${caution} |`;
}

function buildTeammateRoster(currentAgentId) {
  const allConfigs = agentRegistry.getAllConfigs();
  const teammates = filterAvailableTeammates(
    allConfigs,
    currentAgentId,
    (id) => !_isAgentAvailable || _isAgentAvailable(id, _loadedConfig),
  );
  if (teammates.length === 0) return '（无其他可用队友）';

  const rows = ['## 队友名册', '| 智能体 | @mention · 当前模型 | 擅长 | 注意 |', '|------|---------|------|------|'];
  for (const [id, cfg] of teammates) {
    rows.push(buildRosterRow(id, cfg));
  }
  return rows.join('\n');
}

// F203 Phase B fix: 现有 SystemPromptBuilder.ts:554 对 roleId 不在
// {lead-architect,code-reviewer,frontend-designer} 的 agent（如 opus-47，roleId='opus-47'）
// 无 workflow triggers（既有 gap，S1 baseline 实测 opus-47 workflow=0t）。
// 这里加 displayName→role fallback 修这个 gap：opus-47 是Lead Architect家族，
// 应共享 lead-architect workflow。**行为变更**：见 F203 spec KD-8。
const DISPLAY_NAME_TO_ROLE = {
  架构与开发: 'architecture-development',
  代码审查: 'code-review',
  前端与视觉: 'frontend-visual',
  研究与文档: 'research-docs',
  'Lead Architect': 'lead-architect',
  'Code Reviewer': 'code-reviewer',
  'Frontend Designer': 'frontend-designer',
};

function buildWorkflowTriggers(roleId, agentId, displayName) {
  const direct = WORKFLOW_TRIGGERS_INLINE[roleId] ?? WORKFLOW_TRIGGERS_INLINE[agentId];
  if (direct) return direct;
  const fallbackRole = DISPLAY_NAME_TO_ROLE[displayName];
  if (fallbackRole && WORKFLOW_TRIGGERS_INLINE[fallbackRole]) {
    return WORKFLOW_TRIGGERS_INLINE[fallbackRole];
  }
  return '## 工作流\n（无 per-role 触发点配置）';
}

// Phase C Task 1 (A8 gap): 渲染 operator reference 行，对齐 buildStaticIdentity
// L568-571（co-creator config 动态 name + mentionPatterns），替代 L0 §4
// 硬编码 @co-creator。删 user message 后这是智能体认 operator + 路由 handle 的唯一来源。
function renderCvoRef() {
  if (!_coCreatorConfig) return '';
  const name = _coCreatorConfig.name;
  const handles = (_coCreatorConfig.mentionPatterns ?? []).map((p) => `\`${p}\``).join(' / ');
  return `${name}（co-creator/operator）。重要决策由${name}拍板。需要关注时行首写 ${handles}。`;
}

// ─── F231: User profile capsule resolution ────────────────────────────────
// Contract (F231 spec KD-7 + Phase A plan §三):
//   profileDir priority: function param > env AGENT_STUDIO_PROFILE_DIR > default 'private/profile'
//   capsulePath = join(profileDir, 'landy-capsule.md')
//   Three states:
//     missing/unreadable → '' (empty string, no heading — backward compat)
//     ≤300 Unicode chars  → '## 主人画像\n\n{body}' + optional primer pointer
//     >300 Unicode chars  → throw (compilation must fail loudly)
//   Primer pointer: if relationship/{agentId}-primer.md exists → append reference line
//   Pointer line does NOT count toward 300-char limit.

const USER_CAPSULE_CHAR_LIMIT = 300;

/**
 * Strip metadata (YAML frontmatter or markdown heading/blockquote metadata)
 * from capsule content. Returns the body after the metadata-terminating `---`.
 *
 * Handles both formats:
 *   YAML:     ---\nkey: val\n---\nbody   → body (after 2nd ---)
 *   Markdown: # Title\n> meta\n---\nbody → body (after 1st ---)
 *
 * If no `---` separator found, returns the entire content trimmed.
 *
 * IMPORTANT (gpt52 review P1): uses FIRST metadata-terminating `---`, NOT last.
 * "Last ---" would silently eat body content if the capsule contains `---`
 * horizontal rules (e.g. "Body one\n---\nBody two" → only "Body two").
 */
function stripCapsuleMetadata(raw) {
  const lines = raw.trim().split('\n');

  // Case 1: YAML frontmatter — starts with `---` on line 0
  if (lines[0].trim() === '---') {
    // Find closing `---` (skip line 0, the opening fence)
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '---') {
        return lines
          .slice(i + 1)
          .join('\n')
          .trim();
      }
    }
    // Unclosed YAML frontmatter → treat everything after line 0 as body
    return lines.slice(1).join('\n').trim();
  }

  // Case 2: Heading/blockquote metadata (# Title / > meta / ---)
  // Find FIRST `---` separator — that terminates the metadata block
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      return lines
        .slice(i + 1)
        .join('\n')
        .trim();
    }
  }

  // No metadata separator found → return entire content
  return raw.trim();
}

/**
 * Resolve user profile capsule for L0 injection.
 *
 * @param {string} profileDir - directory containing landy-capsule.md
 * @param {string} agentId - current agent ID (for primer pointer lookup)
 * @returns {string} formatted injection section, or '' if capsule missing
 * @throws {Error} if capsule exceeds 300 Unicode characters
 */
export function resolveUserCapsule(profileDir, agentId) {
  const capsulePath = resolve(profileDir, 'landy-capsule.md');

  // State 1: missing / unreadable → empty (backward compat for community users)
  let raw;
  try {
    raw = readFileSync(capsulePath, 'utf8');
  } catch {
    return '';
  }

  // Strip metadata (YAML frontmatter or markdown heading/blockquote metadata)
  const body = stripCapsuleMetadata(raw);
  if (!body) return '';

  // Count visible characters (Chinese "字数" convention):
  // Letters, CJK chars, punctuation count; whitespace does not.
  // This matches spec intent: "300字" = 300 visible chars, not 300 code points.
  const charCount = [...body.replace(/\s/g, '')].length;

  // State 3: overlong → throw (compilation must fail loudly per KD-7)
  if (charCount > USER_CAPSULE_CHAR_LIMIT) {
    throw new Error(
      `USER_CAPSULE exceeds ${USER_CAPSULE_CHAR_LIMIT}-character limit: ${charCount} characters in ${capsulePath}. ` +
        `Capsule must be ≤${USER_CAPSULE_CHAR_LIMIT} chars (KD-7). Trim content or move overflow to primer.`,
    );
  }

  // State 2: valid → build section with heading
  let section = `## 主人画像\n\n${body}`;

  // Primer pointer: check if relationship/{agentId}-primer.md exists
  const primerPath = resolve(profileDir, `relationship/${agentId}-primer.md`);
  try {
    accessSync(primerPath);
    // Use standard logical path (not fixture path) for human-readable pointer
    section += `\n\n关系轨迹: private/profile/relationship/${agentId}-primer.md（开局可读，按需 recall）`;
  } catch {
    // No primer for this agent — no pointer line
  }

  return section;
}

/**
 * Compile per-agent L0 string by substituting template variables.
 *
 * @param {Object} options
 * @param {string} options.agentId - agent ID (must be registered in agentRegistry)
 * @param {string} [options.runtimeModel] - resolved runtime model (e.g. claude-opus-4-7)
 * @param {string} [options.profileDir] - override for user profile directory (fixture isolation)
 * @returns {Promise<string>} compiled L0 ready for system-prompt injection
 */
export async function compileL0(options) {
  await bootstrapAgentRegistry();
  const { agentId, runtimeModel, profileDir } = options;
  const entry = agentRegistry.tryGet(agentId);
  if (!entry) {
    throw new Error(`compileL0: unknown agentId "${agentId}". Registered: ${agentRegistry.getAllIds().join(', ')}`);
  }
  const config = { ...entry.config, agentId };
  const template = readFileSync(TEMPLATE_PATH, 'utf8');
  const governanceL0 = await _loadCompiledGovernanceL0(REPO_ROOT);

  // F231: resolve user capsule (profileDir > env > default 'private/profile')
  // Note: REPO_ROOT default only works when script runs from actual project dir.
  // In symlink/packaged layouts, caller (l0-compiler.ts) passes --profile-dir
  // explicitly via subprocess args (gpt52 review P1 fix).
  const resolvedProfileDir =
    profileDir ?? process.env.AGENT_STUDIO_PROFILE_DIR ?? resolve(REPO_ROOT, 'private/profile');
  const capsuleSection = resolveUserCapsule(resolvedProfileDir, agentId);

  return template
    .replace('{{IDENTITY_BLOCK}}', buildIdentityBlock(config, runtimeModel))
    .replace('{{USER_CAPSULE}}', capsuleSection)
    .replace('{{TEAMMATE_ROSTER}}', buildTeammateRoster(agentId))
    .replace('{{GOVERNANCE_L0}}', governanceL0.content)
    .replace('{{WORKFLOW_TRIGGERS}}', buildWorkflowTriggers(config.roleId, agentId, config.displayName))
    .replace('{{CVO_REF}}', renderCvoRef());
}

/**
 * Compile per-agent L0 and write to a file.
 *
 * operator directive 2026-05-15: 完全替换不在 ts/js 硬编码 L0 内容——Phase C
 * 用 `claude --system-prompt-file <path>` 从文件读。compile 渲染 per-agent
 * L0 → 写文件 → spawn 引用文件路径（内容真相源始终是 system-prompt-l0.md）。
 *
 * @param {Object} options - same as compileL0 ({ agentId, runtimeModel? })
 * @param {string} outPath - absolute path to write compiled L0
 * @returns {Promise<string>} the compiled L0 (also written to outPath)
 */
export async function writeL0File(options, outPath) {
  const compiled = await compileL0(options);
  writeFileSync(outPath, compiled, 'utf8');
  return compiled;
}

// CLI:
//   node scripts/compile-system-prompt-l0.mjs --agent opus-47            → stdout
//   node scripts/compile-system-prompt-l0.mjs --agent opus-47 --out p.md → write file
//   node scripts/compile-system-prompt-l0.mjs --agent opus-47 --profile-dir /abs/path
//     → override profile directory (gpt52 review P1: fixes symlink/packaged layouts)
if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const args = process.argv.slice(2);
  const agentIdx = args.indexOf('--agent');
  if (agentIdx < 0 || !args[agentIdx + 1]) {
    console.error(
      'Usage: node scripts/compile-system-prompt-l0.mjs --agent <agentId> [--out <path>] [--profile-dir <path>]',
    );
    process.exit(2);
  }
  const agentId = args[agentIdx + 1];
  const profileDirIdx = args.indexOf('--profile-dir');
  const profileDir = profileDirIdx >= 0 ? args[profileDirIdx + 1] : undefined;
  const outIdx = args.indexOf('--out');
  if (outIdx >= 0 && args[outIdx + 1]) {
    const outPath = args[outIdx + 1];
    await writeL0File({ agentId, profileDir }, outPath);
    console.error(`Wrote compiled L0 for ${agentId} → ${outPath}`);
  } else {
    process.stdout.write(await compileL0({ agentId, profileDir }));
  }
}
