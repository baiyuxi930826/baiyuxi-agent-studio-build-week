/**
 * Agent Context Budget Configuration
 * 优先级: 环境变量 > 解析后的运行时智能体配置 > 硬编码默认值
 *
 * 环境变量 (最高优先级, 覆盖单个字段):
 *   AGENT_OPUS_MAX_PROMPT_TOKENS   → 任务主控与实现 prompt token 上限
 *   AGENT_CODEX_MAX_PROMPT_TOKENS  → 代码审查 prompt token 上限
 *   AGENT_GEMINI_MAX_PROMPT_TOKENS → 界面与视觉 prompt token 上限
 *   MAX_PROMPT_TOKENS            → 全局默认 token (fallback)
 *
 * 或修改 repo 根 `agent-template.json` / 运行时 `.agent-studio/agent-catalog.json`
 */

import type { ContextBudget } from '@agent-studio/shared';
import { agentRegistry } from '@agent-studio/shared';
import { getAllAgentIdsFromConfig, getDefaultVariant, loadAgentConfig } from './agent-config-loader.js';
import { resolveRoleId } from './role-resolver.js';

const BUDGET_ENV_KEYS = {
  opus: 'AGENT_OPUS_MAX_PROMPT_TOKENS',
  codex: 'AGENT_CODEX_MAX_PROMPT_TOKENS',
  gemini: 'AGENT_GEMINI_MAX_PROMPT_TOKENS',
} as const;

/**
 * Hardcoded defaults — keyed by roleId so all variants share the same budget.
 *
 * ⚠️ NOTE on incremental mode (GAP-1 fix): The incremental delivery path
 * (assembleIncrementalContext in route-helpers.ts) now enforces BOTH
 * maxMessages (count cap) and maxContextTokens (aggregate token budget).
 * Per-message content is still truncated by maxContentLengthPerMsg.
 */
const DEFAULT_BUDGETS: Record<string, ContextBudget> = {
  // Keep these in sync with project agent-template defaults so
  // missing/invalid config doesn't silently regress budgets.
  'architecture-development': {
    maxPromptTokens: 180000,
    maxContextTokens: 160000,
    maxMessages: 200,
    maxContentLengthPerMsg: 100000,
  },
  'code-review': {
    maxPromptTokens: 240000,
    maxContextTokens: 216000,
    maxMessages: 200,
    maxContentLengthPerMsg: 100000,
  },
  'frontend-visual': {
    maxPromptTokens: 350000,
    maxContextTokens: 300000,
    maxMessages: 300,
    maxContentLengthPerMsg: 100000,
  },
  'research-docs': {
    maxPromptTokens: 240000,
    maxContextTokens: 216000,
    maxMessages: 200,
    maxContentLengthPerMsg: 100000,
  },
  // Legacy role ids are retained as compatibility fallbacks for old catalogs.
  'lead-architect': {
    maxPromptTokens: 180000,
    maxContextTokens: 160000,
    maxMessages: 200,
    maxContentLengthPerMsg: 100000,
  },
  'code-reviewer': {
    maxPromptTokens: 240000,
    maxContextTokens: 216000,
    maxMessages: 200,
    maxContentLengthPerMsg: 100000,
  },
  'frontend-designer': {
    maxPromptTokens: 350000,
    maxContextTokens: 300000,
    maxMessages: 300,
    maxContentLengthPerMsg: 100000,
  },
  'runtime-engineer': {
    maxPromptTokens: 120000,
    maxContextTokens: 100000,
    maxMessages: 100,
    maxContentLengthPerMsg: 100000,
  },
  'tooling-engineer': {
    maxPromptTokens: 180000,
    maxContextTokens: 160000,
    maxMessages: 200,
    maxContentLengthPerMsg: 100000,
  },
  'visual-qa': { maxPromptTokens: 350000, maxContextTokens: 300000, maxMessages: 300, maxContentLengthPerMsg: 100000 },
  moonshot: { maxPromptTokens: 240000, maxContextTokens: 216000, maxMessages: 200, maxContentLengthPerMsg: 100000 },
  // Spark is a known built-in variant with a smaller context window than the
  // code-review role default; keep it stable even if runtime config loading fails.
  spark: { maxPromptTokens: 64000, maxContextTokens: 40000, maxMessages: 100, maxContentLengthPerMsg: 100000 },
};

/** F32-a: Conservative fallback for unknown/dynamic agents — use smallest built-in budget */
const GLOBAL_FALLBACK_BUDGET: ContextBudget = {
  maxPromptTokens: 100000,
  maxContextTokens: 60000,
  maxMessages: 200,
  maxContentLengthPerMsg: 100000,
};

// Cache from resolved runtime agent config
let cachedJsonBudgets: Record<string, ContextBudget> | null = null;

function loadBudgetsFromJson(): Record<string, ContextBudget> {
  if (cachedJsonBudgets) return cachedJsonBudgets;

  try {
    const config = loadAgentConfig();
    cachedJsonBudgets = {};
    for (const role of config.roles) {
      const defaultVariant = getDefaultVariant(role);
      const roleBudget = defaultVariant.contextBudget;
      if (roleBudget) {
        cachedJsonBudgets[role.agentId] = roleBudget;
      }

      // F32-b: variants are independent agents (sonnet, opus-45, gpt52, spark, gemini25).
      // Variant budgets should be configurable independently, and should inherit the
      // role default budget when not explicitly specified.
      for (const variant of role.variants) {
        if (!variant.agentId) continue;
        const effective = variant.contextBudget ?? roleBudget;
        if (effective) {
          cachedJsonBudgets[variant.agentId] = effective;
        }
      }
    }
    return cachedJsonBudgets;
  } catch {
    // Runtime agent config doesn't exist or is invalid
    cachedJsonBudgets = {};
    return cachedJsonBudgets;
  }
}

/**
 * Get context budget for a agent.
 * Priority: env var override (maxPromptTokens only) > resolved runtime agent config > hardcoded defaults
 */
export function getAgentContextBudget(agentName: string): ContextBudget {
  // 1. Get base budget from JSON or default (resolve roleId for DEFAULT_BUDGETS)
  const jsonBudgets = loadBudgetsFromJson();
  const roleId = resolveRoleId(agentName);
  const baseBudget: ContextBudget =
    jsonBudgets[agentName] ??
    DEFAULT_BUDGETS[agentName] ??
    (roleId ? DEFAULT_BUDGETS[roleId] : undefined) ??
    GLOBAL_FALLBACK_BUDGET; // F32-a: conservative fallback for dynamic agents

  // 2. Check for per-agent env var override
  const perAgentEnvKey = BUDGET_ENV_KEYS[agentName as keyof typeof BUDGET_ENV_KEYS];
  const perAgentEnvValue = process.env[perAgentEnvKey];
  if (perAgentEnvValue?.trim()) {
    const parsed = parseInt(perAgentEnvValue.trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return {
        maxPromptTokens: parsed,
        maxContextTokens: baseBudget.maxContextTokens,
        maxMessages: baseBudget.maxMessages,
        maxContentLengthPerMsg: baseBudget.maxContentLengthPerMsg,
      };
    }
  }

  // 3. Check for global fallback env var
  const globalEnvValue = process.env.MAX_PROMPT_TOKENS;
  if (globalEnvValue?.trim()) {
    const parsed = parseInt(globalEnvValue.trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return {
        maxPromptTokens: parsed,
        maxContextTokens: baseBudget.maxContextTokens,
        maxMessages: baseBudget.maxMessages,
        maxContentLengthPerMsg: baseBudget.maxContentLengthPerMsg,
      };
    }
  }

  return baseBudget;
}

/**
 * Get all agent budgets (for ConfigRegistry display)
 */
export function getAllAgentBudgets(): Record<string, ContextBudget> {
  const result: Record<string, ContextBudget> = {};
  // F32-a: iterate agentRegistry (includes dynamic agents), F032 P2: use config fallback
  const registryIds = agentRegistry.getAllIds();
  const allIds = registryIds.length > 0 ? registryIds.map(String) : getAllAgentIdsFromConfig();
  for (const agentName of allIds) {
    result[agentName] = getAgentContextBudget(agentName);
  }
  return result;
}

/**
 * Clear cached budgets (for testing)
 */
export function clearBudgetCache(): void {
  cachedJsonBudgets = null;
}
