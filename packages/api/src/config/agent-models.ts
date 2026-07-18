/**
 * Agent Model Configuration
 * F32-b: Dynamic env key resolution — AGENT_{AGENTID}_MODEL (uppercased, hyphens → underscores)
 *
 * 运行时来源: .agent-studio/agent-catalog.json（唯一配置源）
 * 环境变量 AGENT_{AGENTID}_MODEL 可 override，用于调试。
 */

import { agentRegistry } from '@agent-studio/shared';

/**
 * F32-b: Generate dynamic env key from agentId.
 * e.g. "opus" → "AGENT_OPUS_MODEL", "opus-45" → "AGENT_OPUS_45_MODEL"
 */
function getAgentModelEnvKey(agentId: string): string {
  return `AGENT_${agentId.toUpperCase().replace(/-/g, '_')}_MODEL`;
}

/**
 * 获取智能体的实际模型。
 * 运行时读 agentRegistry（.agent-studio/agent-catalog.json），环境变量可 override。
 */
export function getAgentModel(agentName: string): string {
  // 1. 环境变量最高优先 (dynamic key: AGENT_{AGENTID}_MODEL)
  const envKey = getAgentModelEnvKey(agentName);
  const envValue = process.env[envKey]?.trim();
  if (envValue) {
    return envValue;
  }

  // 2. agentRegistry (populated from .agent-studio/agent-catalog.json at startup)
  const entry = agentRegistry.tryGet(agentName);
  if (entry) {
    return entry.config.defaultModel;
  }

  throw new Error(`No model configured for agent "${agentName}"`);
}

/**
 * 获取所有智能体的模型配置 (用于 ConfigRegistry)
 */
export function getAllAgentModels(): Record<string, string> {
  const result: Record<string, string> = {};
  const allIds = agentRegistry.getAllIds().map(String);
  for (const agentName of allIds) {
    result[agentName] = getAgentModel(agentName);
  }
  return result;
}
