/**
 * ConciergeConfigStore (F229 PR-A1)
 *
 * Per-user 前台智能体配置持久化。TTL=0（铁律 5 LL-048）。
 * 遵照 LabelStore/GameStore 三件模式：port interface + Redis 实现 + Memory 实现（测试用）。
 *
 * dutyAgentProfileId 默认值解析：
 * - 优先 'gemini35'（co-creator directive 2026-06-12：Andy（界面与视觉） Gemini 3.5 Flash）
 * - 不存在则取 agentRegistry.getAllIds()[0]
 * - registry 为空时 fallback 'sonnet'
 */

import {
  agentRegistry,
  CONCIERGE_CONFIG_DEFAULTS,
  type ConciergeConfig,
  normalizeConciergeSkin,
} from '@agent-studio/shared';
import type { RedisClient } from '@agent-studio/shared/utils';
import { ConciergeKeys } from './concierge-keys.js';

// ---------------------------------------------------------------------------
// Default resolution helper
// ---------------------------------------------------------------------------

function resolveDefaultDutyAgentProfileId(): string {
  const ids = agentRegistry.getAllIds();
  if (ids.includes('gemini35' as never)) return 'gemini35';
  if (ids.length > 0) return ids[0];
  return 'sonnet';
}

function normalizeStoredConfig(config: ConciergeConfig): ConciergeConfig {
  return {
    ...config,
    skin: normalizeConciergeSkin((config as { skin?: string }).skin),
  };
}

// ---------------------------------------------------------------------------
// Port interface
// ---------------------------------------------------------------------------

export interface IConciergeConfigStore {
  /** 获取用户配置；不存在则返回 defaults（含 dutyAgentProfileId 解析） */
  get(userId: string): Promise<ConciergeConfig>;
  /** 覆盖写入用户配置（TTL=0，持久化） */
  put(userId: string, config: ConciergeConfig): Promise<void>;
}

// ---------------------------------------------------------------------------
// Redis implementation
// ---------------------------------------------------------------------------

export class RedisConciergeConfigStore implements IConciergeConfigStore {
  private readonly redis: RedisClient;

  constructor(redis: RedisClient) {
    this.redis = redis;
  }

  async get(userId: string): Promise<ConciergeConfig> {
    const raw = await this.redis.get(ConciergeKeys.config(userId));
    if (!raw) {
      return {
        ...CONCIERGE_CONFIG_DEFAULTS,
        dutyAgentProfileId: resolveDefaultDutyAgentProfileId(),
      };
    }
    const config = normalizeStoredConfig(JSON.parse(raw) as ConciergeConfig);
    // FIX-3: validate stored dutyAgentProfileId — stale/missing values (e.g., config
    // saved before resolution logic existed, or agent removed from roster) should
    // re-resolve to the plan default (gemini35 → first available → sonnet).
    if (!config.dutyAgentProfileId || !agentRegistry.has(config.dutyAgentProfileId)) {
      config.dutyAgentProfileId = resolveDefaultDutyAgentProfileId();
    }
    return config;
  }

  async put(userId: string, config: ConciergeConfig): Promise<void> {
    // TTL=0 意味着"不设置 EXPIRE" = 持久化（铁律 5 LL-048）
    await this.redis.set(ConciergeKeys.config(userId), JSON.stringify(config));
  }
}

// ---------------------------------------------------------------------------
// In-memory implementation（仅用于单元测试 / stub）
// ---------------------------------------------------------------------------

export class MemoryConciergeConfigStore implements IConciergeConfigStore {
  private readonly store = new Map<string, ConciergeConfig>();

  async get(userId: string): Promise<ConciergeConfig> {
    const entry = this.store.get(userId);
    if (!entry) {
      return {
        ...CONCIERGE_CONFIG_DEFAULTS,
        dutyAgentProfileId: resolveDefaultDutyAgentProfileId(),
      };
    }
    const config = normalizeStoredConfig({ ...entry });
    // FIX-3: same validation as Redis impl
    if (!config.dutyAgentProfileId || !agentRegistry.has(config.dutyAgentProfileId)) {
      config.dutyAgentProfileId = resolveDefaultDutyAgentProfileId();
    }
    return config;
  }

  async put(userId: string, config: ConciergeConfig): Promise<void> {
    this.store.set(userId, normalizeStoredConfig({ ...config }));
  }
}
