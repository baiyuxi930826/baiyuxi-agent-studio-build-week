import type { Redis } from 'ioredis';

export interface EvalAgentOverride {
  agentId: string;
  handle: string;
  model: string;
  setAt: string;
}

function overrideKey(domainId: string): string {
  return `eval-domain:${domainId}:evalAgent-override`;
}

export async function getEvalAgentOverride(redis: Redis, domainId: string): Promise<EvalAgentOverride | null> {
  const raw = await redis.get(overrideKey(domainId));
  if (!raw) return null;
  return JSON.parse(raw) as EvalAgentOverride;
}

export async function setEvalAgentOverride(
  redis: Redis,
  domainId: string,
  override: Omit<EvalAgentOverride, 'setAt'>,
): Promise<EvalAgentOverride> {
  const entry: EvalAgentOverride = { ...override, setAt: new Date().toISOString() };
  await redis.set(overrideKey(domainId), JSON.stringify(entry));
  return entry;
}

export async function clearEvalAgentOverride(redis: Redis, domainId: string): Promise<void> {
  await redis.del(overrideKey(domainId));
}
