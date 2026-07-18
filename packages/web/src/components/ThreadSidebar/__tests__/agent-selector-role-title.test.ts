/**
 * F32-b Phase 4 R24 P2-2: Regression test — AgentSelector group title must show
 * role-level display name, not the first variant's displayName.
 *
 * When a variant overrides displayName, the group heading should still read
 * "Ethan（任务主控与实现）家族" (from roleDisplayName), NOT "宪宪专用智能体家族" (from variant displayName).
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentData } from '@/hooks/useAgentData';

// ── Build multi-variant data where first variant overrides displayName ──
const leadArchitectVariants: AgentData[] = [
  {
    id: 'opus-custom',
    displayName: '定制Ethan', // ← variant-level override, NOT the role name
    color: { primary: '#9B7EBD', secondary: '#E8DFF5' },
    roleId: 'lead-architect',
    roleDisplayName: 'Ethan（任务主控与实现）', // ← role-level name
    clientId: 'anthropic',
    defaultModel: 'claude-sonnet-4-5-20250929',
    avatar: '/avatars/default.svg',
    mentionPatterns: ['@opus-custom'],
    roleDescription: '',
    personality: '',
    variantLabel: 'Custom',
    isDefaultVariant: false,
  },
  {
    id: 'opus',
    displayName: 'Ethan（任务主控与实现）',
    color: { primary: '#9B7EBD', secondary: '#E8DFF5' },
    roleId: 'lead-architect',
    roleDisplayName: 'Ethan（任务主控与实现）',
    clientId: 'anthropic',
    defaultModel: 'claude-sonnet-4-5-20250929',
    avatar: '/avatars/default.svg',
    mentionPatterns: ['@opus'],
    roleDescription: '',
    personality: '',
    isDefaultVariant: true,
  },
];

const roleMap = new Map<string, AgentData[]>([['lead-architect', leadArchitectVariants]]);

vi.mock('@/hooks/useAgentData', () => ({
  useAgentData: () => ({
    agents: leadArchitectVariants,
    isLoading: false,
    getAgentById: (id: string) => leadArchitectVariants.find((c) => c.id === id),
    getAgentsByRole: () => roleMap,
  }),
  formatAgentName: (agent: { displayName: string; variantLabel?: string }) =>
    agent.variantLabel ? `${agent.displayName}（${agent.variantLabel}）` : agent.displayName,
}));

describe('AgentSelector role group title (R24 P2-2)', () => {
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

  it('shows roleDisplayName in group title, not variant displayName', async () => {
    const { AgentSelector } = await import('../AgentSelector');
    const onChange = vi.fn();

    act(() => {
      root.render(React.createElement(AgentSelector, { selectedAgents: [], onSelectionChange: onChange }));
    });

    // Group title text should contain the role name, NOT the first variant's override
    const groupTitle = container.querySelector('.text-micro');
    expect(groupTitle).toBeTruthy();
    expect(groupTitle?.textContent).toContain('Ethan（任务主控与实现）家族');
    expect(groupTitle?.textContent).not.toContain('定制Ethan家族');
  });

  it('renders all variant chips within the role group', async () => {
    const { AgentSelector } = await import('../AgentSelector');
    const onChange = vi.fn();

    act(() => {
      root.render(React.createElement(AgentSelector, { selectedAgents: [], onSelectionChange: onChange }));
    });

    const buttons = Array.from(container.querySelectorAll('button'));
    // Should have 2 variant chips
    const chipTexts = buttons.map((b) => b.textContent);
    expect(chipTexts.some((t) => t?.includes('定制Ethan'))).toBe(true);
    expect(chipTexts.some((t) => t?.includes('Custom'))).toBe(true); // variantLabel
  });
});
