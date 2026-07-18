import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ThreadState } from '@/stores/chat-types';
import { DEFAULT_THREAD_STATE } from '@/stores/chat-types';
import { getAgentStatusType, ThreadAgentStatus } from '../ThreadAgentStatus';

function makeState(agentStatuses: Record<string, string>, unread = 0): ThreadState {
  return {
    ...DEFAULT_THREAD_STATE,
    agentStatuses: agentStatuses as ThreadState['agentStatuses'],
    unreadCount: unread,
  };
}

describe('ThreadAgentStatus', () => {
  beforeAll(() => {
    (globalThis as { React?: typeof React }).React = React;
  });
  afterAll(() => {
    delete (globalThis as { React?: typeof React }).React;
  });

  it('returns null when idle and no unread', () => {
    const html = renderToStaticMarkup(
      React.createElement(ThreadAgentStatus, { threadState: makeState({}), unreadCount: 0 }),
    );
    expect(html).toBe('');
  });

  it('shows bouncing status dot when an agent is streaming', () => {
    const html = renderToStaticMarkup(
      React.createElement(ThreadAgentStatus, { threadState: makeState({ opus: 'streaming' }), unreadCount: 0 }),
    );
    expect(html).toContain('●');
    expect(html).toContain('animate-agent-bounce');
    expect(html).toContain('text-conn-amber-text');
  });

  it('shows green status dot + check when done', () => {
    const html = renderToStaticMarkup(
      React.createElement(ThreadAgentStatus, { threadState: makeState({ opus: 'done' }), unreadCount: 0 }),
    );
    expect(html).toContain('●');
    expect(html).toContain('text-conn-emerald-text');
    expect(html).toContain('✓');
  });

  it('shows red shaking status dot on error', () => {
    const html = renderToStaticMarkup(
      React.createElement(ThreadAgentStatus, { threadState: makeState({ opus: 'error' }), unreadCount: 0 }),
    );
    expect(html).toContain('●');
    expect(html).toContain('animate-agent-shake');
    expect(html).toContain('text-conn-red-text');
  });

  it('shows unread badge', () => {
    const html = renderToStaticMarkup(
      React.createElement(ThreadAgentStatus, { threadState: makeState({}), unreadCount: 5 }),
    );
    expect(html).toContain('5');
    expect(html).toContain('bg-[var(--semantic-warning)]');
  });

  it('caps unread at 99+', () => {
    const html = renderToStaticMarkup(
      React.createElement(ThreadAgentStatus, { threadState: makeState({}), unreadCount: 150 }),
    );
    expect(html).toContain('99+');
  });

  it('shows both status dot and unread badge together', () => {
    const html = renderToStaticMarkup(
      React.createElement(ThreadAgentStatus, {
        threadState: makeState({ codex: 'streaming' }),
        unreadCount: 3,
      }),
    );
    expect(html).toContain('●');
    expect(html).toContain('3');
  });

  it('error takes priority over streaming', () => {
    const html = renderToStaticMarkup(
      React.createElement(ThreadAgentStatus, {
        threadState: makeState({ opus: 'streaming', codex: 'error' }),
        unreadCount: 0,
      }),
    );
    expect(html).toContain('text-conn-red-text');
  });

  it('shows mention badge when hasUserMention is true', () => {
    const html = renderToStaticMarkup(
      React.createElement(ThreadAgentStatus, {
        threadState: makeState({}, 1),
        unreadCount: 1,
        hasUserMention: true,
      }),
    );
    expect(html).toContain('@');
    expect(html).toContain('Agent @ 了你');
  });

  it('shows red unread badge when hasUserMention is true', () => {
    const html = renderToStaticMarkup(
      React.createElement(ThreadAgentStatus, {
        threadState: makeState({}, 3),
        unreadCount: 3,
        hasUserMention: true,
      }),
    );
    expect(html).toContain('bg-conn-red-text');
    expect(html).not.toContain('bg-[var(--semantic-warning)]');
  });

  it('shows amber unread badge when no user mention', () => {
    const html = renderToStaticMarkup(
      React.createElement(ThreadAgentStatus, {
        threadState: makeState({}, 3),
        unreadCount: 3,
        hasUserMention: false,
      }),
    );
    expect(html).toContain('bg-[var(--semantic-warning)]');
  });

  it('renders mention badge even with zero unread when hasUserMention', () => {
    const html = renderToStaticMarkup(
      React.createElement(ThreadAgentStatus, {
        threadState: { ...DEFAULT_THREAD_STATE, hasUserMention: true },
        unreadCount: 0,
        hasUserMention: true,
      }),
    );
    expect(html).toContain('@');
  });
});

describe('getAgentStatusType', () => {
  it('returns idle for empty', () => {
    expect(getAgentStatusType({})).toBe('idle');
  });

  it('returns error when any agent has error', () => {
    expect(getAgentStatusType({ opus: 'done', codex: 'error' })).toBe('error');
  });

  it('returns working when streaming', () => {
    expect(getAgentStatusType({ opus: 'streaming' })).toBe('working');
  });

  it('returns working when pending', () => {
    expect(getAgentStatusType({ opus: 'pending' })).toBe('working');
  });

  it('returns done when all done', () => {
    expect(getAgentStatusType({ opus: 'done', codex: 'done' })).toBe('done');
  });
});
