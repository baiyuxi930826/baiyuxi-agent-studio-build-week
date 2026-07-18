/**
 * F227 PR-2 — EventTimeline format helpers + style maps.
 *
 * Split out of EventTimeline.tsx so each file stays under the 350-line redline
 * (cloud review P2). Pure module (no JSX): confidence/trigger style tables +
 * relative-time formatting + the deterministic per-agent hue placeholder.
 */

/** word → L0 meaning/action (AC-A5: from GET /api/memory/magic-words, never hardcoded). */
export type MeaningMap = Record<string, { meaning: string; action: string }>;

export function timeAgo(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return `${sec}s 前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  return `${Math.floor(hr / 24)} 天前`;
}

/** Deterministic per-agent hue (hash) — placeholder; runtime AgentHueInjector owns the real palette. */
export function agentHue(agentId: string): number {
  let h = 0;
  for (let i = 0; i < agentId.length; i += 1) h = (h * 31 + agentId.charCodeAt(i)) % 360;
  return h;
}

export const CONF: Record<string, { badge: string; node: string; size: string; label: string }> = {
  high: {
    badge: 'bg-[var(--semantic-critical-surface)] text-[var(--semantic-critical)]',
    node: 'bg-[var(--semantic-critical)]',
    size: 'w-[15px] h-[15px]',
    label: '高置信',
  },
  mid: {
    badge: 'bg-[var(--semantic-warning-surface)] text-[var(--semantic-warning)]',
    node: 'bg-[var(--semantic-warning)]',
    size: 'w-[13px] h-[13px]',
    label: '中置信',
  },
  low: {
    badge: 'bg-studio-surface-sunken text-studio-muted',
    node: 'bg-studio-border',
    size: 'w-[9px] h-[9px]',
    label: '低置信',
  },
};

export const TRIGGER_LABEL: Record<string, string> = {
  human_brake: '人工拉闸',
  agent_brake: 'Agent 自检拉闸',
  agent_shout: 'Agent 呼叫',
  flywheel_selffix: '飞轮自修',
  lesson_settle: '教训沉淀',
};
