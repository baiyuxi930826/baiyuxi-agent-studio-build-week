/**
 * Discussion Summary Types (拍立得照片墙)
 * 智能体讨论纪要 — 记录讨论的结论和待解决问题
 */

import type { AgentId } from './ids.js';

export interface ThreadSummary {
  readonly id: string;
  readonly threadId: string;
  readonly topic: string;
  readonly conclusions: readonly string[];
  readonly openQuestions: readonly string[];
  readonly createdAt: number;
  readonly createdBy: AgentId | 'user' | 'system';
}

export type CreateSummaryInput = {
  threadId: string;
  topic: string;
  conclusions: readonly string[];
  openQuestions: readonly string[];
  createdBy: AgentId | 'user' | 'system';
};
