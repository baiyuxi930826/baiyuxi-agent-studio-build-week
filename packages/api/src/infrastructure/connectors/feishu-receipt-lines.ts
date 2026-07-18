/**
 * F157: Feishu receipt ack per official four-channel agent.
 */

const RECEIPT_LINES: Record<string, readonly string[]> = {
  opus: ['收到，Ethan（任务主控与实现）开始处理。', 'Ethan（任务主控与实现）会先拆目标和流程，再给落地结果。'],
  codex: ['收到，Owen（验证与审查）开始处理。', 'Owen（验证与审查）会盯风险、回归和测试缺口。'],
  gemini: ['收到，Andy（界面与视觉）开始处理。', 'Andy（界面与视觉）会关注界面、交互和视觉一致性。'],
  kimi: ['收到，Nora（研究与上下文）开始处理。', 'Nora（研究与上下文）会梳理背景、事实和上下文。'],
};

const FALLBACK_LINES: readonly string[] = ['收到，马上处理。', '看到了，稍等。', '收到。'];

/**
 * Pick a random receipt line for the given agent.
 * Falls back to generic lines for unknown agentIds.
 */
export function pickReceiptLine(agentId: string | undefined): string {
  const lines = (agentId ? RECEIPT_LINES[agentId] : undefined) ?? FALLBACK_LINES;
  return lines[Math.floor(Math.random() * lines.length)];
}
