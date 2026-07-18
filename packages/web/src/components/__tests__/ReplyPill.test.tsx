import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AgentData } from '@/hooks/useAgentData';
import { ReplyPill } from '../ReplyPill';

Object.assign(globalThis as Record<string, unknown>, { React });

vi.mock('@/hooks/useCoCreatorConfig', () => ({
  useCoCreatorConfig: () => ({
    name: '始皇帝',
    aliases: ['秦始皇'],
    mentionPatterns: ['@owner', '@me'],
    color: { primary: '#D4A76A', secondary: '#FFF8F0' },
  }),
}));

const mockGetAgentById = (id: string): AgentData | undefined => {
  const agents: Record<string, Partial<AgentData>> = {
    opus: { id: 'opus', displayName: '宪宪', color: { primary: '#8B5CF6', secondary: '#7C3AED' } },
    codex: { id: 'codex', displayName: '砚砚', color: { primary: '#22C55E', secondary: '#16A34A' } },
  };
  return agents[id] as AgentData | undefined;
};

describe('ReplyPill', () => {
  it('renders agent reply with sender name and truncated content', () => {
    const html = renderToStaticMarkup(
      <ReplyPill
        replyPreview={{ senderAgentId: 'opus', content: '这是预览内容' }}
        replyToId="msg-123"
        getAgentById={mockGetAgentById}
      />,
    );
    expect(html).toContain('↩');
    expect(html).toContain('@宪宪');
    expect(html).toContain('这是预览内容');
    expect(html).toContain('#8B5CF6');
  });

  it('renders user reply with configured co-creator label', () => {
    const html = renderToStaticMarkup(
      <ReplyPill
        replyPreview={{ senderAgentId: null, content: '用户消息' }}
        replyToId="msg-456"
        getAgentById={mockGetAgentById}
      />,
    );
    expect(html).toContain('始皇帝');
    expect(html).toContain('用户消息');
  });

  it('renders deleted message placeholder', () => {
    const html = renderToStaticMarkup(
      <ReplyPill
        replyPreview={{ senderAgentId: 'opus', content: '', deleted: true }}
        replyToId="msg-789"
        getAgentById={mockGetAgentById}
      />,
    );
    expect(html).toContain('消息已删除');
    expect(html).not.toContain('@宪宪:');
  });

  it('renders as a clickable button', () => {
    const html = renderToStaticMarkup(
      <ReplyPill
        replyPreview={{ senderAgentId: 'opus', content: '内容' }}
        replyToId="msg-123"
        getAgentById={mockGetAgentById}
      />,
    );
    expect(html).toContain('<button');
    expect(html).toContain('cursor-pointer');
  });

  it('uses co-creator color for user reply (senderAgentId=null)', () => {
    const html = renderToStaticMarkup(
      <ReplyPill
        replyPreview={{ senderAgentId: null, content: '用户消息' }}
        replyToId="msg-456"
        getAgentById={mockGetAgentById}
      />,
    );
    // Co-creator warm gold from useCoCreatorConfig mock, NOT unknown agent purple
    expect(html).toContain('#D4A76A');
    expect(html).not.toContain('#9B7EBD');
  });

  it('uses fallback color for unknown agent', () => {
    const html = renderToStaticMarkup(
      <ReplyPill
        replyPreview={{ senderAgentId: 'unknown-agent', content: '内容' }}
        replyToId="msg-123"
        getAgentById={mockGetAgentById}
      />,
    );
    // Fallback color is lead-architect purple
    expect(html).toContain('#9B7EBD');
    expect(html).toContain('@unknown-agent');
  });
});
