/**
 * F32-b Phase 3: Regression test for mention menu selectedIdx OOB guard.
 *
 * Guards against a race condition: agentOptions can shrink (e.g. API fetch
 * returns fewer agents than fallback) while the mention menu is open and
 * selectedIdx points to a now-invalid position. The sync guard at the
 * Enter/Tab insertion point prevents `insertMention(undefined)` crash.
 *
 * Since `act()` flushes React effects (making the async clamp fire before
 * keydown), we test the two defensive layers independently:
 * 1. Empty agentOptions: typing "@" then Enter → no crash, menu closes
 * 2. Happy path: typing "@" then Enter with valid agents → mention inserted
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatInput } from '@/components/ChatInput';

// ── Mocks ──
vi.mock('@/components/icons/SendIcon', () => ({
  SendIcon: () => React.createElement('span', null, 'send'),
}));
vi.mock('@/components/icons/LoadingIcon', () => ({
  LoadingIcon: () => React.createElement('span', null, 'loading'),
}));
vi.mock('@/components/icons/AttachIcon', () => ({
  AttachIcon: () => React.createElement('span', null, 'attach'),
}));
vi.mock('@/components/ImagePreview', () => ({ ImagePreview: () => null }));
vi.mock('@/utils/compressImage', () => ({ compressImage: (f: File) => Promise.resolve(f) }));

// Controllable useAgentData mock — swap agents mid-test via mockAgents
const mockAgents = { current: buildAgentsWithPatterns() };

vi.mock('@/hooks/useAgentData', () => ({
  useAgentData: () => ({
    agents: mockAgents.current,
    isLoading: false,
    getAgentById: (id: string) => mockAgents.current.find((c: { id: string }) => c.id === id),
    getAgentsByRole: () => new Map(),
  }),
}));

function buildAgentsWithPatterns() {
  return [
    {
      id: 'opus',
      displayName: 'Ethan（任务主控与实现）',
      color: { primary: '#9B7EBD', secondary: '#E8D5F5' },
      mentionPatterns: ['Ethan', 'Ethan（任务主控与实现）', 'opus'],
      clientId: 'anthropic',
      defaultModel: 'opus',
      avatar: '/a.png',
      roleDescription: 'dev',
      personality: 'kind',
    },
    {
      id: 'codex',
      displayName: 'Owen（验证与审查）',
      color: { primary: '#5B8C5A', secondary: '#D5E8D4' },
      mentionPatterns: ['Owen', 'Owen（验证与审查）', 'codex'],
      clientId: 'openai',
      defaultModel: 'codex',
      avatar: '/b.png',
      roleDescription: 'review',
      personality: 'strict',
    },
  ];
}

function buildAgentsNoPatterns() {
  return [
    {
      id: 'opus',
      displayName: 'Ethan（任务主控与实现）',
      color: { primary: '#9B7EBD', secondary: '#E8D5F5' },
      mentionPatterns: [] as string[],
      clientId: 'anthropic',
      defaultModel: 'opus',
      avatar: '/a.png',
      roleDescription: 'dev',
      personality: 'kind',
    },
  ];
}

// ── Setup ──
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
  mockAgents.current = buildAgentsWithPatterns();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function render(props: Partial<React.ComponentProps<typeof ChatInput>> = {}) {
  const defaults = { onSend: vi.fn(), disabled: false };
  act(() => {
    root.render(React.createElement(ChatInput, { ...defaults, ...props }));
  });
  return defaults;
}

function getTextarea(): HTMLTextAreaElement {
  return container.querySelector('textarea')!;
}

function typeInTextarea(value: string) {
  const ta = getTextarea();
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(ta, value);
    ta.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function pressKey(key: string) {
  const ta = getTextarea();
  act(() => {
    ta.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

describe('ChatInput mention menu guards', () => {
  it('Enter on mention menu with empty agentOptions does not crash and closes menu', () => {
    // All agents have empty mentionPatterns → buildAgentOptions filters all out → agentOptions = []
    mockAgents.current = buildAgentsNoPatterns();
    render();

    // Type "@" to trigger mention menu
    typeInTextarea('@');

    // Press Enter — should not crash (guard: activeOptions.length === 0)
    pressKey('Enter');

    // Menu should be closed (no .w-64 mention menu div)
    expect(container.querySelectorAll('.w-64').length).toBe(0);
  });

  it('Enter on mention menu with valid agentOptions inserts mention', () => {
    render();

    // Type "@" to open mention menu
    typeInTextarea('@');

    // Mention menu should be visible
    expect(container.querySelectorAll('.w-64').length).toBe(1);

    // Press Enter to select first agent (selectedIdx defaults to 0)
    pressKey('Enter');

    // Menu should close
    expect(container.querySelectorAll('.w-64').length).toBe(0);

    // Input should contain the inserted mention
    const ta = getTextarea();
    expect(ta.value).toContain('Ethan');
  });

  it('ArrowDown past last item wraps to 0 and Enter still works', () => {
    // 4 options: Ethan（任务主控与实现）, Owen（验证与审查） (individuals), @thread, @all (groups).
    // Default selectedIdx = 0 (first individual, groups are at bottom).
    render();

    typeInTextarea('@');
    expect(container.querySelectorAll('.w-64').length).toBe(1);

    // ArrowDown once from idx 2 → idx 3 (Owen（验证与审查）)
    pressKey('ArrowDown');

    // Enter should insert Owen（验证与审查）
    pressKey('Enter');

    const ta = getTextarea();
    expect(ta.value).toContain('Owen');
  });
});
