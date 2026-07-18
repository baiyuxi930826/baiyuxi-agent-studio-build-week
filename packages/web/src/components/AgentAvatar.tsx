'use client';

import { type ReactNode, useState } from 'react';
import { useAgentData } from '@/hooks/useAgentData';
import { hexToRgba } from '@/lib/color-utils';

type AgentStatus = 'spawning' | 'pending' | 'streaming' | 'done' | 'error' | 'alive_but_silent' | 'suspected_stall';

/** F174 D2b-2 — callback-auth health (per agent, derived from /api/debug/callback-auth snapshot). */
export type CallbackAuthStatus = 'healthy' | 'degraded' | 'broken' | 'unknown';

const CALLBACK_AUTH_STATUS_COLOR: Record<CallbackAuthStatus, string> = {
  healthy: 'var(--semantic-success)',
  degraded: 'var(--semantic-warning)',
  broken: 'var(--semantic-critical)',
  unknown: 'var(--neutral-400)',
};

interface AgentAvatarProps {
  agentId: string;
  size?: number;
  status?: AgentStatus;
  onClick?: () => void;
  /** F174 D2b-2: corner status dot for callback-auth health surface (明厨亮灶 实体层). */
  callbackAuthStatus?: CallbackAuthStatus;
  /** Optional aria-label / hover hint for the status dot (e.g."broken · 12 fails"). */
  callbackAuthLabel?: string;
  /**
   * F174 D2b-2 AC-D7: rich popover rendered on dot hover. When provided
   * (and onCallbackAuthClick set), the dot becomes a clickable entry
   * point — e.g. jump to D2b-3 deep-dive panel.
   */
  callbackAuthPopover?: ReactNode;
  /** F174 D2b-2 AC-D7: click handler for the dot (typically opens D2b-3). */
  onCallbackAuthClick?: () => void;
}

export function AgentAvatar({
  agentId,
  size = 32,
  status,
  onClick,
  callbackAuthStatus,
  callbackAuthLabel,
  callbackAuthPopover,
  onCallbackAuthClick,
}: AgentAvatarProps) {
  const [imgError, setImgError] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const { getAgentById } = useAgentData();
  const agent = getAgentById(agentId);

  const isStreaming = status === 'streaming';
  const isError = status === 'error';
  const ringColor = agent?.color.primary ?? 'var(--console-agent-fallback)';
  const glowShadow = isStreaming && agent ? `0 0 10px ${hexToRgba(ringColor, 0.5)}` : undefined;

  // F174 D2b-2: dot is ~28% of avatar size (min 8px), absolute positioned bottom-right.
  // White ring lifts it off the avatar and survives most agent colors.
  const dotSize = Math.max(8, Math.round(size * 0.28));
  const dotBorder = Math.max(1, Math.round(dotSize * 0.18));

  const Wrapper = onClick ? 'button' : 'div';

  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <Wrapper
        {...(onClick ? { type: 'button' as const, onClick, 'aria-label': `${agent?.displayName ?? agentId}` } : {})}
        className={`rounded-full ring-2 overflow-hidden bg-studio-surface-elevated flex items-center justify-center transition-shadow duration-300 ${
          isStreaming ? 'animate-pulse' : ''
        } ${onClick ? 'cursor-pointer hover:ring-[var(--studio-accent)] transition-[box-shadow,--tw-ring-color]' : ''}`}
        style={{
          width: size,
          height: size,
          ['--tw-ring-color' as string]: isError ? 'var(--semantic-critical)' : ringColor,
          boxShadow: glowShadow,
        }}
      >
        {imgError ? (
          <span className="text-micro font-semibold text-studio-muted">
            {(agent?.displayName ?? agentId).slice(0, 2).toUpperCase()}
          </span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={agent?.avatar ?? `/avatars/default.svg`}
            alt={agent?.displayName ?? agentId}
            width={size}
            height={size}
            className="object-cover"
            onError={() => setImgError(true)}
          />
        )}
      </Wrapper>
      {callbackAuthStatus && (
        <span
          className="absolute"
          style={{ right: -dotBorder, bottom: -dotBorder }}
          onMouseEnter={() => callbackAuthPopover && setPopoverOpen(true)}
          onMouseLeave={() => setPopoverOpen(false)}
        >
          {onCallbackAuthClick ? (
            <button
              type="button"
              data-testid="callback-auth-dot"
              data-callback-auth-status={callbackAuthStatus}
              aria-label={callbackAuthLabel ?? `callback-auth: ${callbackAuthStatus}`}
              title={callbackAuthLabel ?? `callback-auth: ${callbackAuthStatus}`}
              onClick={(e) => {
                // 砚砚 P2 #1403: dot lives inside AgentAvatar callsites that are
                // themselves clickable (e.g. ThreadItem row → onSelect). Without
                // stopPropagation, opening the D2b-3 panel would also switch
                // threads — a hidden context jump.
                e.stopPropagation();
                onCallbackAuthClick();
              }}
              className="block rounded-full p-0 hover:scale-110 transition-transform cursor-pointer"
              style={{
                width: dotSize,
                height: dotSize,
                backgroundColor: CALLBACK_AUTH_STATUS_COLOR[callbackAuthStatus],
                border: `${dotBorder}px solid var(--studio-surface)`,
              }}
            />
          ) : (
            <span
              role="status"
              data-testid="callback-auth-dot"
              data-callback-auth-status={callbackAuthStatus}
              aria-label={callbackAuthLabel ?? `callback-auth: ${callbackAuthStatus}`}
              title={callbackAuthLabel ?? `callback-auth: ${callbackAuthStatus}`}
              className="block rounded-full"
              style={{
                width: dotSize,
                height: dotSize,
                backgroundColor: CALLBACK_AUTH_STATUS_COLOR[callbackAuthStatus],
                border: `${dotBorder}px solid var(--studio-surface)`,
              }}
            />
          )}
          {popoverOpen && callbackAuthPopover && (
            <div
              data-testid="callback-auth-popover"
              className="absolute z-50 mt-1 rounded-lg border border-studio-border bg-studio-surface-elevated p-3 text-xs shadow-xl"
              style={{ top: dotSize + dotBorder, right: 0, minWidth: 200, maxWidth: 280 }}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              {callbackAuthPopover}
            </div>
          )}
        </span>
      )}
    </div>
  );
}
