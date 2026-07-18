/**
 * F079 Phase 2: Vote interception utilities
 *
 * Pure functions for extracting [VOTE:xxx] patterns from agent responses
 * and managing vote completion logic.
 */

import type { ConnectorSource } from '@agent-studio/shared';
import type { VotingStateV1 } from '../../stores/ports/ThreadStore.js';

/** Gap 3: vote results render as ConnectorBubble, not plain system message. */
export const VOTE_RESULT_SOURCE: ConnectorSource = {
  connector: 'vote-result',
  label: '投票结果',
  icon: 'ballot',
};

const VOTE_PATTERN = /\[VOTE:(.+?)\]/;

/**
 * Extract vote option from text content.
 * Returns the trimmed option string, or null if no vote pattern found.
 */
export function extractVoteFromText(text: string): string | null {
  const match = text.match(VOTE_PATTERN);
  if (!match) return null;
  return match[1]?.trim() ?? null;
}

/**
 * Check if all designated voters have voted.
 * Returns true only when a `voters` list exists and every voter has cast.
 */
export function checkVoteCompletion(state: VotingStateV1): boolean {
  const voters = (state as VotingStateV1 & { voters?: string[] }).voters;
  if (!voters || voters.length === 0) return false;
  return voters.every((v) => v in state.votes);
}

/**
 * Build the notification message sent to each voter.
 */
export function buildVoteNotification(question: string, options: string[]): string {
  const optionList = options.map((o) => `• ${o}`).join('\n');
  return `投票请求：${question}\n\n选项：\n${optionList}\n\n请在回复中包含 [VOTE:你的选项]，例如 [VOTE:${options[0]}]`;
}

/**
 * Build tally object from votes.
 */
export function buildVoteTally(options: string[], votes: Record<string, string>): Record<string, number> {
  const tally: Record<string, number> = {};
  for (const opt of options) tally[opt] = 0;
  for (const v of Object.values(votes)) {
    tally[v] = (tally[v] ?? 0) + 1;
  }
  return tally;
}
