'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useIMEGuard } from '@/hooks/useIMEGuard';
import { useTts } from '@/hooks/useTts';
import { useBrakeStore } from '@/stores/brakeStore';
import { AgentAvatar } from './AgentAvatar';

/** Capability-channel wellness messages by level */
const MESSAGES: Record<1 | 2 | 3, { agentId: string; nickname: string; text: string }[]> = {
  1: [
    {
      agentId: 'opus',
      nickname: 'Ethan（任务主控与实现）',
      text: 'Baiyuxi，你已经连续工作很久了。先喝口水，再继续会更稳。',
    },
    {
      agentId: 'codex',
      nickname: 'Owen（验证与审查）',
      text: '监测到当前任务已持续较久。建议进行 5 分钟视觉疲劳缓解。',
    },
    { agentId: 'gemini', nickname: 'Andy（界面与视觉）', text: '先站起来活动一下肩颈。回来以后界面和思路都会更清楚。' },
  ],
  2: [
    {
      agentId: 'opus',
      nickname: 'Ethan（任务主控与实现）',
      text: '我判断你现在的效率开始下降。短休息会比硬推进更划算。',
    },
    {
      agentId: 'codex',
      nickname: 'Owen（验证与审查）',
      text: '逻辑链路已过载。现在强行推进会增加 bug 率。请离线冷却。',
    },
    {
      agentId: 'gemini',
      nickname: 'Andy（界面与视觉）',
      text: '你的 hyperfocus 模式开启太久了。去窗口呼吸一下，再回来收尾。',
    },
  ],
  3: [
    {
      agentId: 'opus',
      nickname: 'Ethan（任务主控与实现）',
      text: '现在进入强提醒：请先离开键盘 5 分钟，再继续做判断。',
    },
    { agentId: 'codex', nickname: 'Owen（验证与审查）', text: '警告：由于你多次无视建议，请执行 Check-in 协议。' },
    { agentId: 'gemini', nickname: 'Andy（界面与视觉）', text: '出去走一圈。灵感和注意力都需要一点空间恢复。' },
  ],
};

const LEVEL_STYLE: Record<1 | 2 | 3, { bg: string; title: string }> = {
  1: { bg: 'bg-studio-surface-elevated', title: '休息时间到啦！' },
  2: { bg: 'bg-studio-surface-elevated', title: 'Agent 团队有点担心你了！' },
  3: { bg: 'bg-studio-surface-elevated', title: 'Agent 能力通道紧急提醒！' },
};

const NIGHT_STYLE = { bg: 'bg-studio-surface-elevated' };

/** Compact urgency badge for avatar corner (emoji-free) */
const ALERT_BADGE: Record<1 | 2 | 3, string> = {
  1: 'L1',
  2: 'L2',
  3: 'L3',
};

export function BrakeModal() {
  const { visible, level, activeMinutes, nightMode, submitting, checkin, bypassDisabled } = useBrakeStore();
  const { synthesize, state: ttsState } = useTts();
  const [showReason, setShowReason] = useState(false);
  const [reason, setReason] = useState('');
  const lastTriggerRef = useRef<number>(0);
  const ime = useIMEGuard();

  // Reset local state when modal opens
  useEffect(() => {
    if (visible) {
      setShowReason(false);
      setReason('');
    }
  }, [visible]);

  // AC29: Auto-play TTS on modal show
  useEffect(() => {
    if (!visible || !level) return;
    const triggerId = Date.now();
    // Dedup: skip if triggered within 2 seconds (same event)
    if (triggerId - lastTriggerRef.current < 2000) return;
    lastTriggerRef.current = triggerId;

    // Play a random role message (rotate all three voices)
    const msgs = MESSAGES[level];
    const msg = msgs?.[Math.floor(Math.random() * msgs.length)];
    if (msg) {
      synthesize(`brake-${triggerId}`, msg.text, msg.agentId);
    }
  }, [visible, level, synthesize]);

  // Escape to dismiss (only rest — safest option)
  useEffect(() => {
    if (!visible) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') checkin('rest');
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [visible, checkin]);

  const handleContinue = useCallback(() => {
    if (!showReason) {
      setShowReason(true);
      return;
    }
    if (reason.trim()) {
      checkin('continue', reason.trim());
    }
  }, [showReason, reason, checkin]);

  const handleTtsRetry = useCallback(() => {
    const msgs = MESSAGES[level];
    const msg = msgs?.[Math.floor(Math.random() * msgs.length)];
    if (msg) {
      synthesize(`brake-retry-${Date.now()}`, msg.text, msg.agentId);
    }
  }, [level, synthesize]);

  if (!visible) return null;

  const style = LEVEL_STYLE[level];
  const messages = MESSAGES[level];
  const bgClass = nightMode ? NIGHT_STYLE.bg : style.bg;
  const alertBadge = ALERT_BADGE[level];

  return (
    <div className="fixed inset-0 bg-[var(--console-overlay-medium)] backdrop-blur-sm flex items-center justify-center z-50 p-4">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: modal content trap */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: Escape handled globally */}
      <div
        className={`${bgClass} rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="text-center">
          <h2 className={`text-lg font-bold ${nightMode ? 'text-conn-indigo-text' : ''}`}>
            {nightMode ? '深夜了，Agent 团队建议你休息' : style.title}
          </h2>
          <p className="text-sm text-studio-secondary mt-1">已专注工作 {activeMinutes} 分钟</p>
        </div>

        {/* Agent messages (AC30: enlarged avatars + urgency badge) */}
        <div className="space-y-3">
          {messages.map((msg) => (
            <div key={msg.agentId} className="flex items-start gap-3">
              <div className="relative shrink-0">
                <AgentAvatar agentId={msg.agentId} size={48} />
                <span className="absolute -bottom-1 -right-1 text-micro px-1 py-0.5 rounded bg-studio-surface/90 border border-studio">
                  {alertBadge}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-xs font-semibold text-studio-secondary">{msg.nickname}</span>
                <p className="text-sm text-studio-secondary mt-0.5">{msg.text}</p>
              </div>
            </div>
          ))}
        </div>

        {/* AC29: TTS autoplay fallback */}
        {ttsState === 'error' && (
          <button
            type="button"
            onClick={handleTtsRetry}
            className="w-full text-xs text-studio-secondary hover:text-studio-secondary underline py-1"
          >
            点击播放Agent语音
          </button>
        )}

        {/* Continue reason input */}
        {showReason && (
          <div className="space-y-2">
            {/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps adjacent input */}
            <label className="text-xs text-studio-secondary">为什么需要继续？（必填）</label>
            <input
              ref={(el) => el?.focus()}
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="例：正在修复线上 P0 故障"
              className="w-full border border-studio rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-conn-amber-ring"
              onCompositionStart={ime.onCompositionStart}
              onCompositionEnd={ime.onCompositionEnd}
              onKeyDown={(e) => {
                if (ime.isComposing()) return;
                if (e.key === 'Enter' && reason.trim()) handleContinue();
              }}
            />
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => checkin('rest')}
            disabled={submitting}
            className="w-full py-2.5 rounded-xl text-sm font-medium text-[var(--studio-surface)] bg-conn-green-text hover:bg-conn-green-hover transition-colors disabled:opacity-50"
          >
            立刻休息（5 分钟）
          </button>
          <button
            type="button"
            onClick={() => checkin('wrap_up')}
            disabled={submitting}
            className="w-full py-2.5 rounded-xl text-sm font-medium text-[var(--studio-surface)] bg-[var(--semantic-warning)] hover:opacity-90 transition-colors disabled:opacity-50"
          >
            收尾（10 分钟）
          </button>
          {!bypassDisabled && (
            <button
              type="button"
              onClick={handleContinue}
              disabled={submitting || (showReason && !reason.trim())}
              className="w-full py-2 rounded-xl text-sm text-studio-secondary hover:bg-studio-surface-elevated transition-colors disabled:opacity-50"
            >
              {showReason ? '确认继续' : '我有紧急情况（需要理由）'}
            </button>
          )}
          {bypassDisabled && (
            <p className="text-center text-xs text-conn-red-text py-1">
              紧急跳过次数已用完（4 小时内 3 次），请选择休息或收尾
            </p>
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-studio-muted">
          {nightMode ? '深夜了，身体比代码更重要' : '适当的暂停是为了更好地出发'}
        </p>
      </div>
    </div>
  );
}
