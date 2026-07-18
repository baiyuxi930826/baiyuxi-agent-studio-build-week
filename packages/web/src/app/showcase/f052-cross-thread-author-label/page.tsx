'use client';

import { useRef } from 'react';
import { ChatMessage } from '@/components/ChatMessage';
import { MessageNavigator } from '@/components/MessageNavigator';
import { useAgentData } from '@/hooks/useAgentData';
import type { ChatMessage as ChatMessageType } from '@/stores/chatStore';

const now = Date.now();

const messages: ChatMessageType[] = [
  {
    id: 'u-1',
    type: 'user',
    content: '跨线程那条消息怎么把作者标错了？这是 Baiyuxi 的普通用户消息。',
    timestamp: now - 1000 * 60 * 5,
  },
  {
    id: 'x-1',
    // Fixture: cross-thread posting bug can produce { type: "user", agentId: "gpt52" }.
    // UI should treat this as an agent message because agentId is the stronger signal.
    type: 'user',
    agentId: 'gpt52',
    content: '（fixture）我其实是 agent 消息，但 type 被错误标成 user；UI 仍应显示为 Owen（验证与审查） 消息。',
    timestamp: now - 1000 * 60 * 4,
  },
  {
    id: 'a-1',
    type: 'assistant',
    agentId: 'codex',
    content: '收到。这个页面就是给 F052 的回归样例：agentId 优先于 type。',
    timestamp: now - 1000 * 60 * 3,
  },
  {
    id: 'a-2',
    type: 'assistant',
    agentId: 'opus',
    content: '也会影响 MessageNavigator / MessageActions 等组件的“谁说的”判断。',
    timestamp: now - 1000 * 60 * 2,
  },
];

export default function ShowcaseF052CrossThreadAuthorLabel() {
  const { getAgentById } = useAgentData();
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="text-xl font-semibold">F052 — Cross-thread Author Label</h1>
      <p className="mt-2 text-sm text-studio-secondary">
        Fixture: one message is <code className="font-mono">type=&quot;user&quot;</code> but still has a{' '}
        <code className="font-mono">agentId</code>. UI should render it as an agent message (avatar/name/color), not as
        &quot;Baiyuxi&quot;.
      </p>

      <div className="relative mt-4 overflow-hidden rounded-xl border border-studio bg-studio-surface">
        <div ref={scrollContainerRef} className="relative max-h-[520px] overflow-y-auto p-4 space-y-3">
          {messages.map((message) => (
            <ChatMessage key={message.id} message={message} getAgentById={getAgentById} />
          ))}
        </div>

        <MessageNavigator messages={messages} scrollContainerRef={scrollContainerRef} />
      </div>
    </div>
  );
}
