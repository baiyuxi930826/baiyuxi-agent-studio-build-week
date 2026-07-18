import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAT_THREAD_ROUTE_EVENT } from '../ThreadSidebar/thread-navigation';

vi.mock('@/stores/chatStore', () => ({
  useChatStore: (
    selector: (s: { threads: { id: string; title: string }[]; uiThinkingExpandedByDefault: boolean }) => unknown,
  ) =>
    selector({
      uiThinkingExpandedByDefault: false,
      threads: [{ id: 'thread_mm72eyvc12345678', title: 'F052 跨线程调度测试' }],
    }),
}));

vi.mock('@/hooks/useTts', () => ({
  useTts: () => ({ state: 'idle', synthesize: vi.fn(), activeMessageId: null }),
}));

vi.mock('@/components/AgentAvatar', () => ({
  AgentAvatar: () => React.createElement('span', null, 'avatar'),
}));
vi.mock('@/components/ConnectorBubble', () => ({ ConnectorBubble: () => null }));
vi.mock('@/components/EvidencePanel', () => ({ EvidencePanel: () => null }));
vi.mock('@/components/MarkdownContent', () => ({ MarkdownContent: () => null }));
vi.mock('@/components/MetadataBadge', () => ({ MetadataBadge: () => null }));
vi.mock('@/components/SummaryCard', () => ({ SummaryCard: () => null }));
vi.mock('@/components/rich/RichBlocks', () => ({ RichBlocks: () => null }));

describe('ChatMessage Postmark v2 source pill', () => {
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
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('renders threadId short + thread title, with tooltip and click-to-navigate', async () => {
    const { ChatMessage } = await import('@/components/ChatMessage');

    const sourceThreadId = 'thread_mm72eyvc12345678';
    const message = {
      id: 'm1',
      type: 'assistant',
      agentId: 'gpt52',
      content: '',
      timestamp: Date.now(),
      isStreaming: false,
      extra: { crossPost: { sourceThreadId } },
    };

    const getAgentById = vi.fn(() => ({
      id: 'gpt52',
      displayName: 'Owen（验证与审查）',
      variantLabel: 'GPT-5.2',
      roleId: 'code-reviewer',
      clientId: 'openai',
      defaultModel: 'gpt-5.2',
      avatar: '/avatars/default.svg',
      mentionPatterns: [],
      roleDescription: '',
      personality: '',
      color: { primary: '#7C3AED', secondary: '#EDE9FE' },
    }));

    act(() => {
      root.render(React.createElement(ChatMessage, { message: message as never, getAgentById: getAgentById as never }));
    });

    const pill = Array.from(container.querySelectorAll('a')).find(
      (a) => (a.textContent ?? '').includes('mm72eyvc') && (a.textContent ?? '').includes('F052 跨线程调度测试'),
    );
    expect(pill).toBeTruthy();
    expect(pill?.textContent).toContain('📮');
    // sender label: variantLabel is 'GPT-5.2', so agentStyle.label = 'Owen（验证与审查）（GPT-5.2）'
    expect(pill?.textContent).toContain('Owen（验证与审查）（GPT-5.2）');
    expect(pill?.getAttribute('title')).toBe(sourceThreadId);
    expect(pill?.className).toContain('bg-studio-surface');
    expect(pill?.className).toContain('border-studio');
    expect(pill?.className).toContain('text-studio');
    expect(pill?.className).toContain('hover:bg-studio-surface-sunken');

    const pushStateSpy = vi.spyOn(window.history, 'pushState');
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    act(() => {
      pill?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(pushStateSpy).toHaveBeenCalledWith({}, '', `/thread/${sourceThreadId}`);
    expect(window.location.pathname).toBe(`/thread/${sourceThreadId}`);
    expect(dispatchSpy.mock.calls.some(([event]) => event.type === CHAT_THREAD_ROUTE_EVENT)).toBe(true);
  });

  it('on click, records a pending cross-post scroll target when sourceInvocationId is present', async () => {
    const { ChatMessage } = await import('@/components/ChatMessage');
    const { consumePendingCrossPostScroll, __resetPendingCrossPostScrollForTest } = await import(
      '@/utils/crosspost-scroll-target'
    );
    __resetPendingCrossPostScrollForTest();

    const sourceThreadId = 'thread_mm72eyvc12345678';
    const message = {
      id: 'm1',
      type: 'assistant',
      agentId: 'gpt52',
      content: '',
      timestamp: Date.now(),
      isStreaming: false,
      extra: { crossPost: { sourceThreadId, sourceInvocationId: 'inv-src-1' } },
    };

    const getAgentById = vi.fn(() => ({
      id: 'gpt52',
      displayName: 'Owen（验证与审查）',
      variantLabel: 'GPT-5.2',
      roleId: 'code-reviewer',
      clientId: 'openai',
      defaultModel: 'gpt-5.2',
      avatar: '/avatars/default.svg',
      mentionPatterns: [],
      roleDescription: '',
      personality: '',
      color: { primary: '#7C3AED', secondary: '#EDE9FE' },
    }));

    act(() => {
      root.render(React.createElement(ChatMessage, { message: message as never, getAgentById: getAgentById as never }));
    });

    const pill = Array.from(container.querySelectorAll('a')).find((a) => (a.textContent ?? '').includes('mm72eyvc'));
    expect(pill).toBeTruthy();

    act(() => {
      pill?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    // After click, the source thread should have a pending scroll intent carrying the
    // cross-post invocation id + the sender agentId (used to resolve the bubble post-navigation).
    expect(consumePendingCrossPostScroll(sourceThreadId)).toEqual({
      threadId: sourceThreadId,
      sourceInvocationId: 'inv-src-1',
      senderAgentId: 'gpt52',
    });
  });
});
