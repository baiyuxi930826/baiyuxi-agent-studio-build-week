import type { SignalTier } from '@agent-studio/shared';

const tierClassMap: Record<SignalTier, string> = {
  1: 'bg-opus-bg text-opus-dark border-opus-light',
  2: 'bg-codex-bg text-codex-dark border-codex-light',
  3: 'bg-gemini-bg text-gemini-dark border-gemini-light',
  4: 'bg-[var(--console-field-bg)] text-studio-secondary border-[var(--console-border-soft)]',
};

interface SignalTierBadgeProps {
  readonly tier: SignalTier;
}

export function SignalTierBadge({ tier }: SignalTierBadgeProps) {
  return (
    <span
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${tierClassMap[tier]}`}
    >
      Tier {tier}
    </span>
  );
}
