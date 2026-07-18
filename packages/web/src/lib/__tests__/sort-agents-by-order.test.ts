import { describe, expect, it } from 'vitest';
import { sortAgentsByOrder } from '../sort-agents-by-order';

describe('sortAgentsByOrder', () => {
  const agents = [
    { id: 'opus' },
    { id: 'sonnet' },
    { id: 'opus-45' },
    { id: 'opus-47' },
    { id: 'codex' },
    { id: 'gpt52' },
  ];

  it('returns agents unchanged when agentOrder is empty', () => {
    expect(sortAgentsByOrder(agents, [])).toEqual(agents);
  });

  it('pins agents in agentOrder order first, preserves original order for rest', () => {
    const result = sortAgentsByOrder(agents, ['opus-47', 'gpt52']);
    expect(result.map((c) => c.id)).toEqual(['opus-47', 'gpt52', 'opus', 'sonnet', 'opus-45', 'codex']);
  });

  it('ignores agentIds in agentOrder that do not exist in agents', () => {
    const result = sortAgentsByOrder(agents, ['ghost', 'opus-47']);
    expect(result[0]!.id).toBe('opus-47');
    expect(result).toHaveLength(agents.length);
  });

  it('does not mutate input array', () => {
    const original = [...agents];
    sortAgentsByOrder(agents, ['opus-47']);
    expect(agents).toEqual(original);
  });

  it('deduplicates agentOrder ids — each agent appears at most once', () => {
    const result = sortAgentsByOrder(agents, ['opus', 'opus', 'codex', 'codex']);
    const ids = result.map((c) => c.id);
    expect(ids).toEqual(['opus', 'codex', 'sonnet', 'opus-45', 'opus-47', 'gpt52']);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
