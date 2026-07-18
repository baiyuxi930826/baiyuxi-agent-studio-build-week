import type { AgentId, TaskItem } from '@agent-studio/shared';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

Object.assign(globalThis as Record<string, unknown>, { React });

vi.mock('@/components/AgentAvatar', () => ({
  AgentAvatar: ({ agentId, size }: { agentId: string; size: number }) => (
    <span data-testid="agent-avatar" data-agent-id={agentId} data-size={size} />
  ),
}));

function makeTask(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    id: 'task-1',
    kind: 'work',
    threadId: 't1',
    subjectKey: null,
    title: 'Fix the redirect bug',
    why: 'Users keep getting 404 after login',
    ownerAgentId: 'opus' as AgentId,
    status: 'doing',
    createdBy: 'user',
    createdAt: Date.now() - 60_000,
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('TaskCard', () => {
  it('renders task title and status pill', async () => {
    const { TaskCard } = await import('../TaskCard');
    const html = renderToStaticMarkup(<TaskCard task={makeTask()} onStatusChange={vi.fn()} />);
    expect(html).toContain('Fix the redirect bug');
    expect(html).toContain('进行中'); // doing status label
  });

  it('renders owner avatar when ownerAgentId is set', async () => {
    const { TaskCard } = await import('../TaskCard');
    const html = renderToStaticMarkup(<TaskCard task={makeTask()} onStatusChange={vi.fn()} />);
    expect(html).toContain('data-agent-id="opus"');
  });

  it('does not render avatar when ownerAgentId is null', async () => {
    const { TaskCard } = await import('../TaskCard');
    const html = renderToStaticMarkup(<TaskCard task={makeTask({ ownerAgentId: null })} onStatusChange={vi.fn()} />);
    expect(html).not.toContain('data-agent-id');
  });

  it('applies blocked highlight styles', async () => {
    const { TaskCard } = await import('../TaskCard');
    const html = renderToStaticMarkup(<TaskCard task={makeTask({ status: 'blocked' })} onStatusChange={vi.fn()} />);
    expect(html).toContain('border-l-studio-accent');
  });

  it('applies doing crosspost styles', async () => {
    const { TaskCard } = await import('../TaskCard');
    const html = renderToStaticMarkup(<TaskCard task={makeTask({ status: 'doing' })} onStatusChange={vi.fn()} />);
    expect(html).toContain('border-l-studio-crosspost');
  });
});
