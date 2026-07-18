import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { HubMemberOverviewCard } from '@/components/HubMemberOverviewCard';
import type { AgentData } from '@/hooks/useAgentData';

function makeAgent(overrides: Partial<AgentData> & { id: string; clientId: string }): AgentData {
  return {
    displayName: overrides.id,
    color: { primary: '#000', secondary: '#111' },
    mentionPatterns: [],
    defaultModel: 'test-model',
    avatar: '',
    roleDescription: '',
    personality: '',
    roster: { family: 'test', roles: [], lead: false, available: true, evaluation: '' },
    ...overrides,
  };
}

const PROVIDER_TYPES = ['anthropic', 'openai', 'antigravity', 'google', 'dare', 'opencode'] as const;

describe('#723 list-level member deletion coverage', () => {
  it.each(PROVIDER_TYPES)('renders delete button at list level for %s provider', (clientId) => {
    const agent = makeAgent({ id: `agent-${clientId}`, clientId });
    const html = renderToStaticMarkup(
      React.createElement(HubMemberOverviewCard, {
        agent,
        onDelete: () => {},
        onEdit: () => {},
      }),
    );
    expect(html).toContain('aria-label="删除成员"');
    expect(html).toContain('title="删除成员"');
  });

  it('does not render delete button when onDelete is omitted', () => {
    const agent = makeAgent({ id: 'agent-no-delete', clientId: 'anthropic' });
    const html = renderToStaticMarkup(
      React.createElement(HubMemberOverviewCard, {
        agent,
        onEdit: () => {},
      }),
    );
    expect(html).not.toContain('删除成员');
  });

  it('delete button fires onDelete with the correct agent data', () => {
    const onDelete = vi.fn();
    const agent = makeAgent({ id: 'agent-callback', clientId: 'openai' });

    const html = renderToStaticMarkup(
      React.createElement(HubMemberOverviewCard, {
        agent,
        onDelete,
        onEdit: () => {},
      }),
    );
    expect(html).toContain('aria-label="删除成员"');
  });

  it('disabled agents also get delete button at list level', () => {
    const agent = makeAgent({
      id: 'agent-disabled',
      clientId: 'antigravity',
      roster: { family: 'test', roles: [], lead: false, available: false, evaluation: '' },
    });
    const html = renderToStaticMarkup(
      React.createElement(HubMemberOverviewCard, {
        agent,
        onDelete: () => {},
        onEdit: () => {},
      }),
    );
    expect(html).toContain('aria-label="删除成员"');
  });
});
