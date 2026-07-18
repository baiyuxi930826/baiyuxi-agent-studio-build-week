/**
 * F225 SessionHandoffProposal Store Factory.
 * redis 提供 → RedisSessionHandoffProposalStore；否则 → InMemorySessionHandoffProposalStore。
 * 对齐 F128 createProposalStore 模式。
 */

import type { RedisClient } from '@agent-studio/shared/utils';
import {
  InMemorySessionHandoffProposalStore,
  type ISessionHandoffProposalStore,
} from '../ports/SessionHandoffProposalStore.js';
import { RedisSessionHandoffProposalStore } from '../redis/RedisSessionHandoffProposalStore.js';

export function createSessionHandoffProposalStore(redis?: RedisClient): ISessionHandoffProposalStore {
  if (redis) return new RedisSessionHandoffProposalStore(redis);
  return new InMemorySessionHandoffProposalStore();
}
