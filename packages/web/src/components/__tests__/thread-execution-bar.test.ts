/**
 * F122B AC-B8: ThreadExecutionBar shows per-agent active status with elapsed time.
 * B8/B9 polish: agent names from agent-config (formatAgentName), colors from agent.color.primary.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetAgentDataCache } from '@/hooks/useAgentData';
import { useChatStore } from '@/stores/chatStore';
import { ThreadExecutionBar } from '../ThreadExecutionBar';

// Mock /api/agents to return dynamic agent data
vi.mock('@/utils/api-client', () => ({
  apiFetch: vi.fn((url: string) => {
    if (url === '/api/agents') {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            agents: [
              {
                id: 'opus',
                displayName: 'Ethan（任务主控与实现）',
                color: { primary: '#9B7EBD', secondary: '#E8DFF5' },
                mentionPatterns: ['@opus'],
                clientId: 'anthropic',
                defaultModel: 'claude-opus-4-6',
                avatar: '▶',
                roleDescription: 'test',
                personality: 'test',
              },
              {
                id: 'codex',
                displayName: 'Owen（验证与审查）',
                color: { primary: '#4CAF50', secondary: '#C8E6C9' },
                mentionPatterns: ['@codex'],
                clientId: 'openai',
                defaultModel: 'gpt-5.3-codex',
                avatar: '▶',
                roleDescription: 'test',
                personality: 'test',
              },
            ],
          }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  }),
}));

describe('ThreadExecutionBar (F122B AC-B8 + B8/B9 polish)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    _resetAgentDataCache();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    useChatStore.setState({
      activeInvocations: {},
      hasActiveInvocation: false,
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.removeChild(container);
  });

  it('renders nothing when no active invocations', () => {
    act(() => root.render(React.createElement(ThreadExecutionBar)));
    expect(container.textContent).toBe('');
  });

  it('renders active agent with display name from agent-config', async () => {
    useChatStore.setState({
      activeInvocations: {
        'inv-1': { agentId: 'opus', mode: 'execute', startedAt: Date.now() - 5000 },
      },
      hasActiveInvocation: true,
    });
    await act(async () => root.render(React.createElement(ThreadExecutionBar)));

    const text = container.textContent ?? '';
    expect(text).toContain('执行中');
    // Should show display name (Ethan（任务主控与实现）) not raw agentId (opus)
    expect(text).toContain('Ethan（任务主控与实现）');
    expect(text).toMatch(/0:0[0-9]/);
  });

  it('renders multiple active agents with their respective display names', async () => {
    useChatStore.setState({
      activeInvocations: {
        'inv-1': { agentId: 'opus', mode: 'execute', startedAt: Date.now() - 30000 },
        'inv-2': { agentId: 'codex', mode: 'execute', startedAt: Date.now() - 10000 },
      },
      hasActiveInvocation: true,
    });
    await act(async () => root.render(React.createElement(ThreadExecutionBar)));

    const text = container.textContent ?? '';
    expect(text).toContain('Ethan（任务主控与实现）');
    expect(text).toContain('Owen（验证与审查）');
  });

  it('uses dynamic agent color from agent-config (not hardcoded)', async () => {
    useChatStore.setState({
      activeInvocations: {
        'inv-1': { agentId: 'codex', mode: 'execute', startedAt: Date.now() },
      },
      hasActiveInvocation: true,
    });
    await act(async () => root.render(React.createElement(ThreadExecutionBar)));

    const dot = container.querySelector('.animate-pulse') as HTMLElement;
    expect(dot).toBeTruthy();
    expect(dot.style.backgroundColor).toBe('var(--color-codex-primary)');
  });

  it('deduplicates same agent from multiple invocations', async () => {
    useChatStore.setState({
      activeInvocations: {
        'inv-1': { agentId: 'opus', mode: 'execute', startedAt: Date.now() },
        'inv-2': { agentId: 'opus', mode: 'execute', startedAt: Date.now() },
      },
      hasActiveInvocation: true,
    });
    await act(async () => root.render(React.createElement(ThreadExecutionBar)));

    const text = container.textContent ?? '';
    const nameCount = (text.match(/Ethan（任务主控与实现）/g) ?? []).length;
    expect(nameCount).toBe(1);
  });

  it('falls back to agentId when agent not in config', async () => {
    useChatStore.setState({
      activeInvocations: {
        'inv-1': { agentId: 'unknown-agent', mode: 'execute', startedAt: Date.now() },
      },
      hasActiveInvocation: true,
    });
    await act(async () => root.render(React.createElement(ThreadExecutionBar)));

    const text = container.textContent ?? '';
    expect(text).toContain('unknown-agent');
  });

  it('background thread invocation has startedAt after thread switch (R1 P1-1)', async () => {
    const fiveSecondsAgo = Date.now() - 5000;
    useChatStore.setState({
      currentThreadId: 'thread-bg',
      activeInvocations: {
        'inv-bg': { agentId: 'codex', mode: 'execute', startedAt: fiveSecondsAgo },
      },
      hasActiveInvocation: true,
    });
    await act(async () => root.render(React.createElement(ThreadExecutionBar)));

    const text = container.textContent ?? '';
    expect(text).toContain('Owen（验证与审查）');
    expect(text).not.toContain('0:00');
  });
});
