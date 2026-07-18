'use client';

import { useEffect, useState } from 'react';
import type { ContextHealthData } from '@/stores/chat-types';

const AGENT_BG_COLORS: Record<string, string> = {
  opus: 'var(--color-opus-primary)',
  codex: 'var(--color-codex-primary)',
  gemini: 'var(--color-gemini-primary)',
  kimi: 'var(--color-kimi-primary)',
};

const WARN_COLOR = 'var(--semantic-warning)';
const DANGER_COLOR = 'var(--semantic-critical)';

export interface ContextHealthBarProps {
  agentId: string;
  health: ContextHealthData;
  /** Warning threshold (default 0.70) */
  warnThreshold?: number;
  /** Danger threshold (default 0.85) */
  dangerThreshold?: number;
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

function describeContextHealthSource(health: ContextHealthData): string {
  if (health.usedFrom === 'last_turn') return 'Current context fill';
  if (health.usedFrom === 'input') return 'Input-token fallback for context health; may be cumulative';
  if (health.usedFrom === 'total') return 'Total-token fallback estimate for context health';
  return health.source === 'approx' ? 'Estimated context fill' : 'Current context fill';
}

/**
 * F24: Context health progress bar.
 * Thin bar showing context window fill ratio with color coding:
 * - Below warn: agent brand color
 * - warn ~ danger: amber
 * - Above danger: red + pulse animation
 */
export function ContextHealthBar({
  agentId,
  health,
  warnThreshold = 0.7,
  dangerThreshold = 0.85,
}: ContextHealthBarProps) {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setWidth(Math.min(health.fillRatio * 100, 100)));
    return () => cancelAnimationFrame(raf);
  }, [health.fillRatio]);

  const isDanger = health.fillRatio >= dangerThreshold;
  const isWarn = health.fillRatio >= warnThreshold;

  let barColor: string;
  if (isDanger) {
    barColor = DANGER_COLOR;
  } else if (isWarn) {
    barColor = WARN_COLOR;
  } else {
    barColor = AGENT_BG_COLORS[agentId] ?? AGENT_BG_COLORS.opus;
  }

  const approxPrefix = health.source === 'approx' || health.usedFrom === 'total' ? '~' : '';
  const percent = Math.round(health.fillRatio * 100);
  const tooltip = `${describeContextHealthSource(health)}: ${approxPrefix}${percent}% (${formatTokenCount(health.usedTokens)} / ${formatTokenCount(health.windowTokens)} tokens)`;

  return (
    <div className="mt-1" title={tooltip} data-testid={`context-health-${agentId}`}>
      <div className="flex items-center gap-1.5">
        <div className="flex-1 h-[3px] rounded-full bg-studio-surface overflow-hidden">
          <div
            className={`h-full rounded-full ${isDanger ? 'animate-pulse' : ''}`}
            style={{
              width: `${width}%`,
              backgroundColor: barColor,
              transition: 'width 600ms cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          />
        </div>
        <span className="text-micro text-studio-muted tabular-nums w-8 text-right">
          {approxPrefix}
          {percent}%
        </span>
      </div>
    </div>
  );
}
