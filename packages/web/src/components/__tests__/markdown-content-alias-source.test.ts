import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

Object.assign(globalThis as Record<string, unknown>, { React });

describe('MarkdownContent alias source', () => {
  it('picks up mention aliases after refreshMentionData()', async () => {
    const { refreshMentionData } = await import('@/lib/mention-highlight');
    const { MarkdownContent } = await import('@/components/MarkdownContent');

    // Populate mention data with dynamic agent info (simulates /api/agents fetch)
    refreshMentionData([
      {
        id: 'opus',
        displayName: 'Ethan（任务主控与实现）',
        mentionPatterns: ['@opus', '@Ethan（任务主控与实现）', '@测试Ethan别名'],
        color: { primary: '#9B7EBD', secondary: '#C8B6E2' },
        clientId: 'anthropic',
        defaultModel: 'test-model',
        avatar: '',
        roleDescription: '',
        personality: '',
      },
    ]);

    const html = renderToStaticMarkup(React.createElement(MarkdownContent, { content: '@测试Ethan别名 你先看下' }));
    expect(html).toContain('color:#9B7EBD');
  });
});
