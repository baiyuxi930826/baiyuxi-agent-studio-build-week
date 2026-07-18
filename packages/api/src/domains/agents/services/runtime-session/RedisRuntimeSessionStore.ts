/**
 * Redis Runtime Session Store
 * F211 Phase A1: Redis-backed runtime-session metadata sidecar.
 *
 * IMPORTANT: ioredis keyPrefix auto-prefixes normal commands and eval() KEYS[].
 * Pass bare keys as KEYS. Lua-built dynamic keys must explicitly include the
 * resolved keyPrefix, because Redis cannot apply ioredis client options inside
 * the script.
 */

import type { AgentId } from '@agent-studio/shared';
import type { RedisClient } from '@agent-studio/shared/utils';
import { RuntimeSessionKeys } from '../stores/redis-keys/runtime-session-keys.js';
import {
  normalizeRuntimeSessionMetadata,
  type RuntimeSessionLifecycleState,
  type RuntimeSessionMetadata,
  type RuntimeSessionRuntime,
  type RuntimeSessionSurface,
} from './RuntimeSessionMetadata.js';
import type { IRuntimeSessionStore, RuntimeSessionRecentFilter } from './RuntimeSessionStore.js';

const UPSERT_LUA = `
local function active_key(runtime, threadId, agentId)
  return ARGV[2] .. 'runtime-session-active:' .. runtime .. ':' .. threadId .. ':' .. agentId
end

local function remove_recent_indexes(sessionId, record)
  if not record.runtime then
    return
  end
  redis.call('ZREM', ARGV[2] .. 'runtime-session:recent:' .. record.runtime, sessionId)
  if record.surface then
    redis.call('ZREM', ARGV[2] .. 'runtime-session:recent:' .. record.runtime .. ':' .. record.surface, sessionId)
    if record.agentId then
      redis.call('ZREM', ARGV[2] .. 'runtime-session:recent:' .. record.runtime .. ':' .. record.surface .. ':' .. record.agentId, sessionId)
    end
  end
end

local existing = redis.call('GET', KEYS[1])
if existing and existing ~= '' then
  local decoded = cjson.decode(existing)
  if decoded.runtime and decoded.runtimeSessionId then
    local oldRuntimeKey = ARGV[2] .. 'runtime-session:runtime:' .. decoded.runtime .. ':' .. decoded.runtimeSessionId
    redis.call('DEL', oldRuntimeKey)
  end
  if decoded.runtime and decoded.threadId and decoded.agentId and decoded.lifecycle and decoded.lifecycle.state == 'active' then
    local oldActiveKey = active_key(decoded.runtime, decoded.threadId, decoded.agentId)
    if redis.call('GET', oldActiveKey) == ARGV[1] then
      redis.call('DEL', oldActiveKey)
    end
  end
  if decoded.lifecycle and decoded.lifecycle.state then
    local oldStateKey = ARGV[2] .. 'runtime-session:lifecycle:' .. decoded.lifecycle.state
    redis.call('ZREM', oldStateKey, ARGV[1])
  end
  remove_recent_indexes(ARGV[1], decoded)
end

redis.call('SET', KEYS[1], ARGV[3])
redis.call('SET', KEYS[2], ARGV[1])
redis.call('ZADD', KEYS[3], tonumber(ARGV[4]), ARGV[1])
redis.call('ZADD', ARGV[2] .. 'runtime-session:recent:' .. ARGV[5], tonumber(ARGV[4]), ARGV[1])
redis.call('ZADD', ARGV[2] .. 'runtime-session:recent:' .. ARGV[5] .. ':' .. ARGV[9], tonumber(ARGV[4]), ARGV[1])
redis.call('ZADD', ARGV[2] .. 'runtime-session:recent:' .. ARGV[5] .. ':' .. ARGV[9] .. ':' .. ARGV[7], tonumber(ARGV[4]), ARGV[1])

if ARGV[8] == 'active' and ARGV[6] ~= '' and ARGV[7] ~= '' then
  local newActiveKey = active_key(ARGV[5], ARGV[6], ARGV[7])
  local currentId = redis.call('GET', newActiveKey)
  local shouldSetActive = false

  if not currentId or currentId == '' or currentId == ARGV[1] then
    shouldSetActive = true
  else
    local currentPayload = redis.call('GET', ARGV[2] .. 'runtime-session:' .. currentId)
    if not currentPayload or currentPayload == '' then
      shouldSetActive = true
    else
      local current = cjson.decode(currentPayload)
      local currentObservedAt = 0
      if current.lifecycle and current.lifecycle.lastObservedAt then
        currentObservedAt = tonumber(current.lifecycle.lastObservedAt)
      end
      if tonumber(ARGV[4]) >= currentObservedAt then
        shouldSetActive = true
      end
    end
  end

  if shouldSetActive then
    redis.call('SET', newActiveKey, ARGV[1])
  end
end

return ARGV[3]
`;

export class RedisRuntimeSessionStore implements IRuntimeSessionStore {
  constructor(private readonly redis: RedisClient) {}

  async upsert(metadata: RuntimeSessionMetadata): Promise<RuntimeSessionMetadata> {
    const normalized = normalizeRuntimeSessionMetadata(metadata);
    const payload = JSON.stringify(normalized);
    await this.redis.eval(
      UPSERT_LUA,
      3,
      RuntimeSessionKeys.detail(normalized.sessionId),
      RuntimeSessionKeys.byRuntime(normalized.runtime, normalized.runtimeSessionId),
      RuntimeSessionKeys.byLifecycleState(normalized.lifecycle.state),
      normalized.sessionId,
      this.keyPrefix,
      payload,
      String(normalized.lifecycle.lastObservedAt),
      normalized.runtime,
      normalized.threadId ?? '',
      normalized.agentId,
      normalized.lifecycle.state,
      normalized.surface,
    );
    return normalized;
  }

  async getBySessionId(sessionId: string): Promise<RuntimeSessionMetadata | null> {
    const payload = await this.redis.get(RuntimeSessionKeys.detail(sessionId));
    return payload ? parseMetadata(payload) : null;
  }

  async getByRuntimeSession(
    runtime: RuntimeSessionRuntime,
    runtimeSessionId: string,
  ): Promise<RuntimeSessionMetadata | null> {
    const sessionId = await this.redis.get(RuntimeSessionKeys.byRuntime(runtime, runtimeSessionId));
    return sessionId ? this.getBySessionId(sessionId) : null;
  }

  async getActiveByThreadAgent(
    runtime: RuntimeSessionRuntime,
    threadId: string,
    agentId: AgentId,
  ): Promise<RuntimeSessionMetadata | null> {
    const sessionId = await this.redis.get(RuntimeSessionKeys.byThreadAgent(runtime, threadId, agentId));
    if (!sessionId) return null;
    const record = await this.getBySessionId(sessionId);
    if (
      !record ||
      record.runtime !== runtime ||
      record.threadId !== threadId ||
      record.agentId !== agentId ||
      record.lifecycle.state !== 'active'
    ) {
      return null;
    }
    return record;
  }

  async listByLifecycleState(state: RuntimeSessionLifecycleState): Promise<RuntimeSessionMetadata[]> {
    const sessionIds = await this.redis.zrange(RuntimeSessionKeys.byLifecycleState(state), 0, -1);
    if (sessionIds.length === 0) return [];

    const pipeline = this.redis.pipeline();
    for (const sessionId of sessionIds) {
      pipeline.get(RuntimeSessionKeys.detail(sessionId));
    }
    const results = await pipeline.exec();
    if (!results) return [];

    const records: RuntimeSessionMetadata[] = [];
    for (const [err, payload] of results) {
      if (err || typeof payload !== 'string') continue;
      records.push(parseMetadata(payload));
    }
    return records.sort((a, b) => {
      const observedDelta = a.lifecycle.lastObservedAt - b.lifecycle.lastObservedAt;
      if (observedDelta !== 0) return observedDelta;
      return a.sessionId.localeCompare(b.sessionId);
    });
  }

  async listRecent(filter: RuntimeSessionRecentFilter): Promise<RuntimeSessionMetadata[]> {
    const runtime = filter.runtime ?? 'antigravity-desktop';
    const key = recentKeyFor(runtime, filter.surface, filter.agentId);
    const limit = normalizeLimit(filter.limit);
    const offset = normalizeOffset(filter.offset);
    const sessionIds = await this.redis.zrevrange(key, offset, offset + limit - 1);
    if (sessionIds.length === 0) return [];

    const records = await this.readRecords(sessionIds);
    return records
      .filter((record) => {
        if (record.runtime !== runtime) return false;
        if (filter.surface && record.surface !== filter.surface) return false;
        if (filter.agentId && record.agentId !== filter.agentId) return false;
        return true;
      })
      .sort((a, b) => {
        const observedDelta = b.lifecycle.lastObservedAt - a.lifecycle.lastObservedAt;
        if (observedDelta !== 0) return observedDelta;
        return a.sessionId.localeCompare(b.sessionId);
      })
      .slice(0, limit);
  }

  async updateLifecycle(
    sessionId: string,
    patch: Partial<RuntimeSessionMetadata['lifecycle']>,
  ): Promise<RuntimeSessionMetadata | null> {
    const existing = await this.getBySessionId(sessionId);
    if (!existing) return null;
    return this.upsert({
      ...existing,
      lifecycle: {
        ...existing.lifecycle,
        ...patch,
      },
    });
  }

  private get keyPrefix(): string {
    return (this.redis.options as { keyPrefix?: string }).keyPrefix ?? '';
  }

  private async readRecords(sessionIds: readonly string[]): Promise<RuntimeSessionMetadata[]> {
    const pipeline = this.redis.pipeline();
    for (const sessionId of sessionIds) {
      pipeline.get(RuntimeSessionKeys.detail(sessionId));
    }
    const results = await pipeline.exec();
    if (!results) return [];

    const records: RuntimeSessionMetadata[] = [];
    for (const [err, payload] of results) {
      if (err || typeof payload !== 'string') continue;
      records.push(parseMetadata(payload));
    }
    return records;
  }
}

function parseMetadata(payload: string): RuntimeSessionMetadata {
  return normalizeRuntimeSessionMetadata(JSON.parse(payload));
}

function recentKeyFor(
  runtime: RuntimeSessionRuntime,
  surface: RuntimeSessionSurface | undefined,
  agentId: AgentId | undefined,
): string {
  if (surface && agentId) return RuntimeSessionKeys.recentByRuntimeSurfaceAgent(runtime, surface, agentId);
  if (surface) return RuntimeSessionKeys.recentByRuntimeSurface(runtime, surface);
  return RuntimeSessionKeys.recentByRuntime(runtime);
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return 50;
  if (!Number.isInteger(limit) || limit < 1) return 50;
  return Math.min(limit, 200);
}

function normalizeOffset(offset: number | undefined): number {
  if (offset === undefined) return 0;
  if (!Number.isInteger(offset) || offset < 0) return 0;
  return offset;
}
