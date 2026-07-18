import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentData } from '@/hooks/useAgentData';

afterEach(() => {
  vi.resetModules();
});

function makeAgent(overrides: Partial<AgentData> & { id: string; mentionPatterns: string[] }): AgentData {
  return {
    displayName: overrides.id,
    color: { primary: '#000', secondary: '#fff' },
    clientId: 'anthropic',
    defaultModel: 'test',
    roleDescription: '',
    personality: '',
    ...overrides,
  } as AgentData;
}

describe('mention highlight cache', () => {
  it('excludes disabled agents (roster.available === false) from highlight (#193)', async () => {
    const { refreshMentionData, getMentionToAgent, getMentionRe } = await import('@/lib/mention-highlight');
    const agents: AgentData[] = [
      makeAgent({
        id: 'spark',
        displayName: '火花智能体',
        color: { primary: '#F59E0B', secondary: '#FDE68A' },
        mentionPatterns: ['@spark', '@火花智能体'],
        roster: { family: 'code-reviewer', roles: ['coder'], lead: false, available: false, evaluation: 'disabled' },
      }),
      makeAgent({
        id: 'lead-architect',
        displayName: 'Ethan（任务主控与实现）',
        color: { primary: '#9B7EBD', secondary: '#E8DFF5' },
        mentionPatterns: ['@lead-architect', '@Ethan（任务主控与实现）'],
        roster: { family: 'lead-architect', roles: ['architect'], lead: true, available: true, evaluation: '' },
      }),
    ];

    refreshMentionData(agents);

    const toAgent = getMentionToAgent();
    // Disabled agent excluded
    expect(toAgent.spark).toBeUndefined();
    expect(toAgent['火花智能体']).toBeUndefined();
    // Available agent included
    expect(toAgent['lead-architect']).toBe('lead-architect');
    expect(toAgent['Ethan（任务主控与实现）']).toBe('lead-architect');

    const re = getMentionRe();
    re.lastIndex = 0;
    expect(re.exec('@spark')).toBeNull();
    re.lastIndex = 0;
    expect(re.exec('@lead-architect')).not.toBeNull();
  });

  it('includes agents without roster field (seed agents default to available)', async () => {
    const { refreshMentionData, getMentionToAgent } = await import('@/lib/mention-highlight');
    refreshMentionData([makeAgent({ id: 'seed-agent', mentionPatterns: ['@seed'], roster: null as never })]);
    expect(getMentionToAgent().seed).toBe('seed-agent');
  });
});
