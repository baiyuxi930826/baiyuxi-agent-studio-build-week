'use client';

import type { ThreadPhase } from '@agent-studio/shared';

export interface SuggestionAgentOption {
  id: string;
  label: string;
}

interface SuggestionOpenFormProps {
  itemId: string;
  agentOptions: SuggestionAgentOption[];
  agentId: string;
  why: string;
  plan: string;
  selectedPhase: ThreadPhase;
  submitting?: boolean;
  onAgentIdChange: (value: string) => void;
  onWhyChange: (value: string) => void;
  onPlanChange: (value: string) => void;
  onSubmit: (payload: {
    itemId: string;
    agentId: string;
    why: string;
    plan: string;
    requestedPhase: ThreadPhase;
  }) => Promise<void>;
}

export function SuggestionOpenForm({
  itemId,
  agentOptions,
  agentId,
  why,
  plan,
  selectedPhase,
  submitting,
  onAgentIdChange,
  onWhyChange,
  onPlanChange,
  onSubmit,
}: SuggestionOpenFormProps) {
  return (
    <form
      className="mt-4 space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!agentId || !why.trim() || !plan.trim()) return;
        void onSubmit({
          itemId,
          agentId,
          why: why.trim(),
          plan: plan.trim(),
          requestedPhase: selectedPhase,
        });
      }}
    >
      <label className="block text-xs font-medium text-studio-secondary">
        建议领取角色
        <select
          value={agentId}
          onChange={(event) => onAgentIdChange(event.target.value)}
          className="mt-1 w-full rounded-[10px] border-transparent bg-[var(--console-field-bg,var(--console-card-bg))] px-2 py-1.5 text-xs text-studio focus:outline-none focus:ring-1 focus:ring-studio-accent"
          data-testid="mc-suggest-agent"
        >
          {agentOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs font-medium text-studio-secondary">
        Why
        <textarea
          value={why}
          onChange={(event) => onWhyChange(event.target.value)}
          className="mt-1 h-16 w-full rounded-[10px] border-transparent bg-[var(--console-field-bg,var(--console-card-bg))] px-2 py-1.5 text-xs text-studio focus:outline-none focus:ring-1 focus:ring-studio-accent"
          data-testid="mc-suggest-why"
        />
      </label>
      <label className="block text-xs font-medium text-studio-secondary">
        Plan
        <textarea
          value={plan}
          onChange={(event) => onPlanChange(event.target.value)}
          className="mt-1 h-16 w-full rounded-[10px] border-transparent bg-[var(--console-field-bg,var(--console-card-bg))] px-2 py-1.5 text-xs text-studio focus:outline-none focus:ring-1 focus:ring-studio-accent"
          data-testid="mc-suggest-plan"
        />
      </label>
      <button
        type="submit"
        disabled={submitting || agentOptions.length === 0}
        className="w-full rounded-lg bg-[var(--studio-text)] px-3 py-2 text-xs font-semibold text-[var(--studio-surface)] disabled:opacity-40"
        data-testid="mc-suggest-submit"
      >
        提交建议领取
      </button>
    </form>
  );
}
