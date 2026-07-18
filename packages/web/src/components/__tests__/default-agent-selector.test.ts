/**
 * F154 Phase B — DefaultAgentSelector: dropdown for choosing the global default agent.
 * AC-B2: Member overview has global default agent selector.
 * baiyuxi-agent-studio#543: Migrated from card grid to dropdown.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href, ...rest }, children),
}));

const TEST_CATS = [
  {
    id: 'opus',
    displayName: 'opus',
    nickname: '宪宪',
    variantLabel: undefined,
    roleDisplayName: 'Ethan（任务主控与实现）',
    color: { primary: '#FFAB91', secondary: '#8D6E63' },
    clientId: 'anthropic',
    defaultModel: 'claude-opus-4-6',
    isDefaultVariant: true,
    mentionPatterns: ['opus'],
    avatar: '',
    roleDescription: '',
    personality: '',
    roster: { family: 'lead-architect', roles: ['architect'], lead: true, available: true, evaluation: '' },
  },
  {
    id: 'codex',
    displayName: 'codex',
    nickname: '砚砚',
    variantLabel: undefined,
    roleDisplayName: 'Owen（验证与审查）',
    color: { primary: '#66BB6A', secondary: '#2E7D32' },
    clientId: 'openai',
    defaultModel: 'gpt-5.3-codex',
    isDefaultVariant: true,
    mentionPatterns: ['codex'],
    avatar: '',
    roleDescription: '',
    personality: '',
    roster: { family: 'code-reviewer', roles: ['reviewer'], lead: false, available: true, evaluation: '' },
  },
  {
    id: 'gemini',
    displayName: 'gemini',
    nickname: '烁烁',
    variantLabel: undefined,
    roleDisplayName: 'Andy（界面与视觉）',
    color: { primary: '#81D4FA', secondary: '#0277BD' },
    clientId: 'google',
    defaultModel: 'gemini-2.5-pro',
    isDefaultVariant: true,
    mentionPatterns: ['gemini'],
    avatar: '',
    roleDescription: '',
    personality: '',
    roster: { family: 'frontend-designer', roles: ['designer'], lead: false, available: true, evaluation: '' },
  },
];

const mockAgentData = {
  agents: TEST_CATS,
  isLoading: false,
  getAgentById: (id: string) => TEST_CATS.find((c) => c.id === id),
  getAgentsByRole: () => new Map(),
  refresh: vi.fn(),
};
vi.mock('@/hooks/useAgentData', () => ({
  useAgentData: () => mockAgentData,
  formatAgentName: (agent: { displayName: string; variantLabel?: string }) =>
    agent.variantLabel ? `${agent.displayName} ${agent.variantLabel}` : agent.displayName,
}));

// Lazy import after mocks
const { DefaultAgentSelector } = await import('@/components/DefaultAgentSelector');

describe('DefaultAgentSelector (F154 Phase B, AC-B2)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    (globalThis as { React?: typeof React }).React = React;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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

  afterAll(() => {
    delete (globalThis as { React?: typeof React }).React;
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  it('renders a select dropdown with all available agents', () => {
    act(() => {
      root.render(
        React.createElement(DefaultAgentSelector, {
          agents: TEST_CATS,
          currentDefaultAgentId: 'opus',
          onSelect: vi.fn(),
        }),
      );
    });
    const select = container.querySelector('[data-testid="default-agent-select"]') as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.options.length).toBe(3);
  });

  it('selects the current default agent in the dropdown', () => {
    act(() => {
      root.render(
        React.createElement(DefaultAgentSelector, {
          agents: TEST_CATS,
          currentDefaultAgentId: 'codex',
          onSelect: vi.fn(),
        }),
      );
    });
    const select = container.querySelector('[data-testid="default-agent-select"]') as HTMLSelectElement;
    expect(select.value).toBe('codex');
  });

  it('shows scope description', () => {
    act(() => {
      root.render(
        React.createElement(DefaultAgentSelector, {
          agents: TEST_CATS,
          currentDefaultAgentId: 'opus',
          onSelect: vi.fn(),
        }),
      );
    });
    expect(container.textContent).toContain('新 thread');
  });

  it('calls onSelect when changing dropdown value', () => {
    const onSelect = vi.fn();
    act(() => {
      root.render(
        React.createElement(DefaultAgentSelector, {
          agents: TEST_CATS,
          currentDefaultAgentId: 'opus',
          onSelect,
        }),
      );
    });
    const select = container.querySelector('[data-testid="default-agent-select"]') as HTMLSelectElement;
    act(() => {
      select.value = 'codex';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onSelect).toHaveBeenCalledWith('codex');
  });

  it('shows color dot for the current default agent', () => {
    act(() => {
      root.render(
        React.createElement(DefaultAgentSelector, {
          agents: TEST_CATS,
          currentDefaultAgentId: 'opus',
          onSelect: vi.fn(),
        }),
      );
    });
    const dot = container.querySelector('[data-testid="selected-color-dot"]') as HTMLElement;
    expect(dot).not.toBeNull();
    expect(dot.style.backgroundColor).toBeTruthy();
  });

  it('shows error hint and retry button when fetchError is true (P1-2)', () => {
    const onRetry = vi.fn();
    act(() => {
      root.render(
        React.createElement(DefaultAgentSelector, {
          agents: TEST_CATS,
          currentDefaultAgentId: '',
          onSelect: vi.fn(),
          fetchError: true,
          onRetry,
        }),
      );
    });
    const select = container.querySelector('[data-testid="default-agent-select"]');
    expect(select).not.toBeNull();
    expect(container.textContent).toContain('加载失败');
    const retryBtn = container.querySelector('[data-testid="retry-fetch"]');
    expect(retryBtn).not.toBeNull();
    act(() => {
      retryBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onRetry).toHaveBeenCalled();
  });

  it('shows error message when saveError is provided (P2-1)', () => {
    act(() => {
      root.render(
        React.createElement(DefaultAgentSelector, {
          agents: TEST_CATS,
          currentDefaultAgentId: 'opus',
          onSelect: vi.fn(),
          saveError: '保存失败，请重试',
        }),
      );
    });
    expect(container.textContent).toContain('保存失败');
  });

  it('includes nickname in option text', () => {
    act(() => {
      root.render(
        React.createElement(DefaultAgentSelector, {
          agents: TEST_CATS,
          currentDefaultAgentId: 'opus',
          onSelect: vi.fn(),
        }),
      );
    });
    const select = container.querySelector('[data-testid="default-agent-select"]') as HTMLSelectElement;
    const opusOption = [...select.options].find((o) => o.value === 'opus');
    expect(opusOption?.textContent).toContain('宪宪');
  });

  it('shows placeholder when currentDefaultAgentId is empty', () => {
    act(() => {
      root.render(
        React.createElement(DefaultAgentSelector, {
          agents: TEST_CATS,
          currentDefaultAgentId: '',
          onSelect: vi.fn(),
        }),
      );
    });
    const select = container.querySelector('[data-testid="default-agent-select"]') as HTMLSelectElement;
    expect(select.value).toBe('');
    const placeholder = [...select.options].find((o) => o.value === '');
    expect(placeholder).not.toBeNull();
  });

  it('shows placeholder when currentDefaultAgentId is not in agents list', () => {
    act(() => {
      root.render(
        React.createElement(DefaultAgentSelector, {
          agents: TEST_CATS,
          currentDefaultAgentId: 'antigravity',
          onSelect: vi.fn(),
        }),
      );
    });
    const select = container.querySelector('[data-testid="default-agent-select"]') as HTMLSelectElement;
    expect(select.value).not.toBe('opus');
    const placeholder = [...select.options].find((o) => o.value === '' || o.disabled);
    expect(placeholder).not.toBeNull();
  });
});
