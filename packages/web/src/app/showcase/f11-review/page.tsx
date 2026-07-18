'use client';

import { ChatMessage } from '@/components/ChatMessage';
import { useAgentData } from '@/hooks/useAgentData';
import type { ChatMessage as ChatMessageType } from '@/stores/chatStore';

const now = Date.now();

const showcaseMessages: ChatMessageType[] = [
  {
    id: '1',
    type: 'assistant',
    agentId: 'opus',
    content: `## F11 Dev-Loop Mode ready for review

@reviewer 请做一轮严格审查。

变更范围：
- 新增 DevLoopMode 状态机
- 新增 review result parser
- 前端接入 ModeStatusBar 和 /mode 命令

验证：backend 850 pass，frontend 54 pass。`,
    timestamp: now - 3600000 * 4,
  },
  {
    id: '2',
    type: 'assistant',
    agentId: 'codex',
    content: `## R1 Review

@architect 这版暂不放行。

### P1: review parser fail-open
\`\`\`ts
parseReviewResult('- [P1] SQL injection')
// returned approved=true
\`\`\`

### P1: mode mention parser drops hyphenated commands
\`\`\`ts
'@mode:dev-loop'.match(/@(\\w+)/)
// only captures mode
\`\`\`

### P2: frontend lacks regression coverage
需要覆盖 mode switch proposal 的 threadId mismatch 场景。`,
    timestamp: now - 3600000 * 3.5,
  },
  {
    id: '3',
    type: 'assistant',
    agentId: 'opus',
    content: `## R1 fixes

@reviewer 修复提交完成。

| Issue | Fix |
| --- | --- |
| fail-open parser | default to needs_fix when verdict is ambiguous |
| hyphenated command | mention regex accepts [\\w-]+ |
| missing UI test | added DOM interaction regression |

验证：backend 852 pass，frontend 57 pass。`,
    timestamp: now - 3600000 * 3,
  },
  {
    id: '4',
    type: 'user',
    content: '先不要合并。Reviewer 确认修复之前，作者不能自己宣布通过。',
    timestamp: now - 3600000 * 2.5,
  },
  {
    id: '5',
    type: 'assistant',
    agentId: 'codex',
    content: `## R2 Review

确认修复有效。还剩 1 个 P2：

- 测试覆盖了 click path，但没有验证 proposal 在切换 thread 后被清理。

建议补一个状态清理测试，再放行。`,
    timestamp: now - 3600000 * 2,
  },
  {
    id: '6',
    type: 'assistant',
    agentId: 'opus',
    content: `## Final fix

@reviewer 已补：
- thread 切换时清理 pending proposal
- confirmation 前校验 proposal.threadId
- 新增 2 个交互测试

验证：backend 852 pass，frontend 59 pass。`,
    timestamp: now - 3600000,
  },
  {
    id: '7',
    type: 'assistant',
    agentId: 'codex',
    content: `## Final verdict

可以放行。

这轮 review 的关键价值不是多跑了一次检查，而是把“作者自证通过”改成了“跨角色验收通过”。`,
    timestamp: now - 1800000,
  },
  {
    id: '8',
    type: 'system',
    variant: 'info',
    content: 'F11 review loop complete: 2 P1 fixed, 2 P2 covered, frontend tests 54 to 59.',
    timestamp: now,
  },
];

export default function F11ReviewShowcase() {
  const { getAgentById } = useAgentData();
  return (
    <div className="min-h-screen bg-[var(--studio-surface-canvas)]">
      <div className="sticky top-0 z-10 border-b border-studio-subtle bg-studio-surface/90 px-6 py-4 backdrop-blur-sm">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-2xl font-bold text-studio">F11 Mode System Review Log</h1>
          <p className="mt-1 text-sm text-studio-secondary">
            Ethan（任务主控与实现） 与 Owen（验证与审查） 的跨角色验收样例
          </p>
        </div>
      </div>

      <div className="border-b border-studio-subtle bg-studio-surface-elevated px-6 py-3">
        <div className="mx-auto flex max-w-3xl flex-wrap gap-4 text-sm text-studio-secondary">
          <span>P1 fixed: 2</span>
          <span>P2 covered: 2</span>
          <span>Tests: 904 to 911</span>
          <span>Verdict: approved</span>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-6 py-6">
        {showcaseMessages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} getAgentById={getAgentById} />
        ))}
      </div>

      <div className="border-t border-studio-subtle bg-studio-surface-elevated px-6 py-8">
        <div className="mx-auto max-w-3xl text-center text-sm text-studio-secondary">
          <p className="mb-2 font-medium text-studio-secondary">Review principle</p>
          <p>作者负责修复，Reviewer 负责确认，Baiyuxi 保留最终取舍权。</p>
        </div>
      </div>
    </div>
  );
}
