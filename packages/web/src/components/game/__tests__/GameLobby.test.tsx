import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GameLobby } from '../GameLobby';

Object.assign(globalThis as Record<string, unknown>, { React });

const mockAgents: React.ComponentProps<typeof GameLobby>['agents'] = [
  {
    id: 'opus',
    displayName: '宪宪',
    color: { primary: '#8B5CF6', secondary: '#7C3AED' },
    avatar: '/avatars/default.svg',
    mentionPatterns: ['opus'],
    clientId: 'anthropic',
    defaultModel: 'claude-opus-4-6',
    roleDescription: '架构',
    personality: '',
  },
  {
    id: 'sonnet',
    displayName: 'Sonnet',
    color: { primary: '#6366F1', secondary: '#4F46E5' },
    avatar: '/avatars/default.svg',
    mentionPatterns: ['sonnet'],
    clientId: 'anthropic',
    defaultModel: 'claude-sonnet',
    roleDescription: '快速',
    personality: '',
  },
  {
    id: 'codex',
    displayName: '砚砚',
    color: { primary: '#10B981', secondary: '#059669' },
    avatar: '/avatars/default.svg',
    mentionPatterns: ['codex'],
    clientId: 'openai',
    defaultModel: 'gpt-5.3-codex',
    roleDescription: 'review',
    personality: '',
  },
];

function render(props: Partial<React.ComponentProps<typeof GameLobby>> = {}): string {
  const merged: React.ComponentProps<typeof GameLobby> = {
    mode: 'player',
    agents: mockAgents,
    onConfirm: () => {},
    onCancel: () => {},
    ...props,
  };
  return renderToStaticMarkup(React.createElement(GameLobby, merged));
}

describe('GameLobby', () => {
  it('renders lobby with data-testid', () => {
    const html = render();
    expect(html).toContain('data-testid="game-lobby"');
  });

  it('shows player mode title for player mode', () => {
    const html = render({ mode: 'player' });
    expect(html).toContain('玩家模式');
  });

  it('shows god-view title for god-view mode', () => {
    const html = render({ mode: 'god-view' });
    expect(html).toContain('上帝视角');
  });

  it('renders board presets', () => {
    const html = render();
    expect(html).toContain('data-testid="preset-6"');
    expect(html).toContain('data-testid="preset-7"');
    expect(html).toContain('data-testid="preset-9"');
    expect(html).toContain('data-testid="preset-12"');
    expect(html).toContain('6人局');
    expect(html).toContain('12人局');
  });

  it('renders agent toggles', () => {
    const html = render();
    expect(html).toContain('data-testid="agent-toggle-opus"');
    expect(html).toContain('data-testid="agent-toggle-sonnet"');
    expect(html).toContain('data-testid="agent-toggle-codex"');
    expect(html).toContain('宪宪');
  });

  it('renders confirm and cancel buttons', () => {
    const html = render();
    expect(html).toContain('data-testid="lobby-confirm"');
    expect(html).toContain('开始游戏');
    expect(html).toContain('取消');
  });

  it('renders voice mode checkbox', () => {
    const html = render();
    expect(html).toContain('语音模式');
  });

  it('shows seat count info', () => {
    const html = render();
    // Default 7-player, player mode = 6 agent seats needed
    expect(html).toContain('席位');
  });

  // Default selection is empty — button starts disabled until user picks agents
  it('starts with empty selection (click to add)', () => {
    const html = render({ agents: mockAgents });
    // Confirm button should be disabled — no agents selected yet
    expect(html).toContain('disabled=""');
    expect(html).toContain('点击添加');
  });

  it('disables start when zero agents available', () => {
    // With no agents at all, can't start
    const html = render({ agents: [] });
    // Confirm button should be disabled
    expect(html).toContain('disabled=""');
  });
});
