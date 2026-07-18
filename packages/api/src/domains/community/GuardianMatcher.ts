import type { AgentId, ReviewPolicy, Roster } from '@agent-studio/shared';
import { createAgentId } from '@agent-studio/shared';
import { getDefaultAgentId, getReviewPolicy, getRoster } from '../../config/agent-config-loader.js';

export interface GuardianMatchOptions {
  author: AgentId;
  reviewer: AgentId;
  policy?: Partial<ReviewPolicy>;
  threadActivity?: Record<string, number>;
  /**
   * Roster override (test seam). Production callers omit this and fall back to
   * the live `getRoster()`. Tests inject an explicit roster so guardian matching
   * is hermetic to the global agent-config singleton + ambient `.agent-studio` catalog
   * artifacts other concurrent test files may leave behind (F211 candidates=0 flake).
   */
  roster?: Roster;
}

export interface GuardianMatchResult {
  guardian: AgentId;
  isDegraded: boolean;
  degradeReason?: string;
  candidates: readonly AgentId[];
}

export async function resolveGuardian(options: GuardianMatchOptions): Promise<GuardianMatchResult> {
  const roster = options.roster ?? getRoster();
  const defaultPolicy = getReviewPolicy();
  const policy: ReviewPolicy = { ...defaultPolicy, ...options.policy };
  const authorId = options.author as string;
  const reviewerId = options.reviewer as string;
  const authorEntry = roster[authorId];

  if (!authorEntry) {
    return { guardian: getDefaultAgentId(), isDegraded: false, candidates: [] };
  }

  const eligible = Object.entries(roster).filter(
    ([id, entry]) => id !== authorId && id !== reviewerId && entry.available !== false,
  );

  const differentFamily = eligible.filter(([_, e]) => e.family !== authorEntry.family);
  const sameFamily = eligible.filter(([_, e]) => e.family === authorEntry.family);
  const activity = options.threadActivity ?? {};

  const sort = (arr: Array<[string, Roster[string]]>) =>
    [...arr].sort((a, b) => {
      const actDiff = (activity[b[0]] ?? 0) - (activity[a[0]] ?? 0);
      if (actDiff !== 0) return actDiff;
      if (policy.preferLead) {
        if (b[1].lead && !a[1].lead) return 1;
        if (a[1].lead && !b[1].lead) return -1;
      }
      return 0;
    });

  const allIds = eligible.map(([id]) => createAgentId(id));

  if (differentFamily.length > 0) {
    const sorted = sort(differentFamily);
    return { guardian: createAgentId(sorted[0][0]), isDegraded: false, candidates: allIds };
  }

  if (sameFamily.length > 0) {
    const sorted = sort(sameFamily);
    return {
      guardian: createAgentId(sorted[0][0]),
      isDegraded: true,
      degradeReason: 'No different-family guardians available',
      candidates: allIds,
    };
  }

  return {
    guardian: getDefaultAgentId(),
    isDegraded: true,
    degradeReason: 'No guardians available',
    candidates: allIds,
  };
}
