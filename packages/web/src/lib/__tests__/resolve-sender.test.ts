import { describe, expect, it } from 'vitest';
import type { AgentData } from '@/hooks/useAgentData';
import { resolveSender } from '../resolve-sender';

const mockCoCreator = {
  name: '始皇帝',
  aliases: ['秦始皇'],
  mentionPatterns: ['@owner'],
  color: { primary: '#D4A76A', secondary: '#FFF8F0' },
};

const mockGetAgentById = (id: string): AgentData | undefined => {
  const agents: Record<string, Partial<AgentData>> = {
    opus: { id: 'opus', displayName: '宪宪', color: { primary: '#8B5CF6', secondary: '#7C3AED' } },
  };
  return agents[id] as AgentData | undefined;
};

describe('resolveSender', () => {
  it('resolves co-creator when senderAgentId is null', () => {
    const result = resolveSender(null, mockGetAgentById, mockCoCreator);
    expect(result.label).toBe('始皇帝');
    expect(result.color).toBe('#D4A76A');
    expect(result.isCoCreator).toBe(true);
  });

  it('resolves known agent by ID', () => {
    const result = resolveSender('opus', mockGetAgentById, mockCoCreator);
    expect(result.label).toBe('@宪宪');
    expect(result.color).toBe('#8B5CF6');
    expect(result.isCoCreator).toBe(false);
  });

  it('falls back for unknown agent ID', () => {
    const result = resolveSender('unknown-agent', mockGetAgentById, mockCoCreator);
    expect(result.label).toBe('@unknown-agent');
    expect(result.color).toBe('#9B7EBD');
    expect(result.isCoCreator).toBe(false);
  });

  it('uses CO_CREATOR_COLOR when coCreator config has no color', () => {
    const noColor = { ...mockCoCreator, color: undefined as never };
    const result = resolveSender(null, mockGetAgentById, noColor);
    expect(result.color).toBe('#D4A76A'); // CO_CREATOR_COLOR.primary
  });
});
