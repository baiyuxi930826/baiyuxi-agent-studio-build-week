/**
 * SessionChainStore Factory
 * F24: Redis available → RedisSessionChainStore, otherwise in-memory.
 */

import type { RedisClient } from '@agent-studio/shared/utils';
import { SessionChainStore } from '../ports/SessionChainStore.js';
import { RedisSessionChainStore } from '../redis/RedisSessionChainStore.js';

export type AnySessionChainStore = SessionChainStore | RedisSessionChainStore;

export function createSessionChainStore(redis?: RedisClient): AnySessionChainStore {
  if (redis) {
    return new RedisSessionChainStore(redis);
  }
  return new SessionChainStore();
}
