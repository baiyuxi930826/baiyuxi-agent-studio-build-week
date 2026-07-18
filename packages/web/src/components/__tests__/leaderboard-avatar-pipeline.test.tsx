import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AgentHeroCard, MiniRanked } from '@/components/leaderboard-cards';
import { SillyAgentsList } from '@/components/leaderboard-phase-bc';

vi.mock('@/components/AgentAvatar', () => ({
  AgentAvatar: ({ agentId, size }: { agentId: string; size?: number }) =>
    React.createElement('span', { 'data-testid': `agent-avatar-${agentId}-${size ?? 32}` }, agentId),
}));

describe('F075 leaderboard avatar pipeline', () => {
  it('uses shared AgentAvatar pipeline for hero cards', () => {
    const html = renderToStaticMarkup(
      React.createElement(AgentHeroCard, {
        agent: {
          agentId: 'gpt52',
          displayName: 'Owen（验证与审查）',
          count: 829,
          rank: 3,
        },
        unit: 'times mentioned',
      }),
    );

    expect(html).toContain('agent-avatar-gpt52-72');
    expect(html).not.toContain('opus-kawaii');
  });

  it('uses shared AgentAvatar pipeline for compact mention and silly lists', () => {
    const miniHtml = renderToStaticMarkup(
      React.createElement(MiniRanked, {
        items: [
          {
            agentId: 'gpt52',
            displayName: 'Owen（验证与审查）',
            count: 3,
            rank: 1,
          },
        ],
        unit: '次',
      }),
    );

    const sillyHtml = renderToStaticMarkup(
      React.createElement(SillyAgentsList, {
        entries: [
          {
            agentId: 'gpt52',
            displayName: 'Owen（验证与审查）',
            label: '社死王',
            description: '被co-creator吐槽',
            count: 2,
          },
        ],
      }),
    );

    expect(miniHtml).toContain('agent-avatar-gpt52-24');
    expect(sillyHtml).toContain('agent-avatar-gpt52-24');
    expect(miniHtml).not.toContain('opus-kawaii');
    expect(sillyHtml).not.toContain('opus-kawaii');
  });
});
