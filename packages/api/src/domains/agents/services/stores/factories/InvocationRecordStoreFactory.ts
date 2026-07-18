/**
 * InvocationRecord Store Factory
 * REDIS_URL 有值 → RedisInvocationRecordStore
 * 无 → InvocationRecordStore (内存，现有行为不变)
 */

import type { RedisClient } from '@agent-studio/shared/utils';
import { InvocationRecordStore } from '../ports/InvocationRecordStore.js';
import { RedisInvocationRecordStore } from '../redis/RedisInvocationRecordStore.js';

export type AnyInvocationRecordStore = InvocationRecordStore | RedisInvocationRecordStore;

export function createInvocationRecordStore(redis?: RedisClient): AnyInvocationRecordStore {
  if (redis) {
    return new RedisInvocationRecordStore(redis);
  }
  return new InvocationRecordStore();
}
