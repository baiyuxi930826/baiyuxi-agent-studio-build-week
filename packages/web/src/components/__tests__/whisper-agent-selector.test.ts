/**
 * F108 Scene 2 v2: WhisperAgentSelector + WhisperTargetChips unit tests.
 * Verifies mention-like popup: avatar, unique identity, status, selection, chips.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { WhisperAgentSelector, WhisperTargetChips } from '@/components/WhisperAgentSelector';
import type { AgentData } from '@/hooks/useAgentData';

const MOCK_CATS: AgentData[] = [
  {
    id: 'opus',
    displayName: '宪宪',
    nickname: '宪宪',
    roleDisplayName: 'Ethan（任务主控与实现）',
    variantLabel: 'Opus',
    color: { primary: '#9B7EBD', secondary: '#E8D5F5' },
    mentionPatterns: ['opus'],
    clientId: 'anthropic',
    defaultModel: 'opus',
    avatar: '/a.png',
    roleDescription: '架构、后端、MCP',
    personality: 'kind',
  },
  {
    id: 'codex',
    displayName: '砚砚',
    nickname: '砚砚',
    roleDisplayName: 'Owen（验证与审查）',
    color: { primary: '#4A90D9', secondary: '#B8D4F0' },
    mentionPatterns: ['codex'],
    clientId: 'openai',
    defaultModel: 'codex',
    avatar: '/b.png',
    roleDescription: 'review、安全、测试',
    personality: 'strict',
  },
  {
    id: 'sonnet',
    displayName: '宪宪',
    nickname: '宪宪',
    roleDisplayName: 'Ethan（任务主控与实现）',
    variantLabel: 'Sonnet',
    color: { primary: '#9B7EBD', secondary: '#E8D5F5' },
    mentionPatterns: ['sonnet'],
    clientId: 'anthropic',
    defaultModel: 'sonnet',
    avatar: '/d.png',
    roleDescription: '快速灵活',
    personality: 'quick',
  },
];

let container: HTMLDivElement;
let root: Root;

beforeAll(() => {
  (globalThis as { React?: typeof React }).React = React;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  delete (globalThis as { React?: typeof React }).React;
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
});

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderSelector(overrides: Partial<React.ComponentProps<typeof WhisperAgentSelector>> = {}) {
  const props = {
    agents: MOCK_CATS,
    selected: new Set<string>(),
    activeAgentIds: new Set<string>(),
    onToggle: vi.fn(),
    ...overrides,
  };
  act(() => root.render(React.createElement(WhisperAgentSelector, props)));
  return props;
}

describe('WhisperAgentSelector', () => {
  it('uses unique identity labels — distinguishes same-nickname agents by variant', () => {
    renderSelector();
    const text = container.textContent ?? '';
    expect(text).toContain('宪宪（Opus）');
    expect(text).toContain('宪宪（Sonnet）');
  });

  it('shows role description for each agent', () => {
    renderSelector();
    expect(container.textContent).toContain('架构、后端、MCP');
    expect(container.textContent).toContain('review、安全、测试');
  });

  it('renders as compact popup (absolute bottom-full)', () => {
    renderSelector();
    const popup = container.querySelector('.absolute.bottom-full');
    expect(popup).not.toBeNull();
  });

  it('shows "执行中" badge for active agents and disables them', () => {
    const { onToggle } = renderSelector({ activeAgentIds: new Set(['opus']) });
    expect(container.textContent).toContain('执行中');

    const buttons = [...container.querySelectorAll('button')];
    const opusBtn = buttons.find((b) => b.textContent?.includes('宪宪（Opus）'));
    act(() => opusBtn?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('calls onToggle when clicking an idle agent', () => {
    const { onToggle } = renderSelector();
    const buttons = [...container.querySelectorAll('button')];
    const codexBtn = buttons.find((b) => b.textContent?.includes('砚砚'));
    act(() => codexBtn?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(onToggle).toHaveBeenCalledWith('codex');
  });

  it('shows checkmark on selected agents', () => {
    renderSelector({ selected: new Set(['codex']) });
    const buttons = [...container.querySelectorAll('button')];
    const codexBtn = buttons.find((b) => b.textContent?.includes('砚砚'));
    // Selected row should have elevated background
    expect(codexBtn?.className).toContain('bg-studio-surface-elevated');
    // And a checkmark SVG
    expect(codexBtn?.querySelector('svg')).not.toBeNull();
  });

  it('shows empty-selection warning when none selected', () => {
    renderSelector();
    expect(container.textContent).toContain('请至少选一个角色');
  });

  it('hides empty-selection warning when a agent is selected', () => {
    renderSelector({ selected: new Set(['codex']) });
    expect(container.textContent).not.toContain('请至少选一个角色');
  });
});

describe('WhisperTargetChips', () => {
  it('shows compact chips for selected targets with × dismiss', () => {
    const onToggle = vi.fn();
    act(() => {
      root.render(
        React.createElement(WhisperTargetChips, { agents: MOCK_CATS, selected: new Set(['codex']), onToggle }),
      );
    });
    expect(container.textContent).toContain('悄悄话:');
    expect(container.textContent).toContain('砚砚');
    expect(container.textContent).toContain('×');
  });

  it('clicking chip calls onToggle to deselect', () => {
    const onToggle = vi.fn();
    act(() => {
      root.render(
        React.createElement(WhisperTargetChips, { agents: MOCK_CATS, selected: new Set(['codex']), onToggle }),
      );
    });
    const chip = container.querySelector('button');
    act(() => chip?.click());
    expect(onToggle).toHaveBeenCalledWith('codex');
  });

  it('returns null when nothing selected', () => {
    act(() => {
      root.render(
        React.createElement(WhisperTargetChips, { agents: MOCK_CATS, selected: new Set<string>(), onToggle: vi.fn() }),
      );
    });
    expect(container.textContent).toBe('');
  });
});
