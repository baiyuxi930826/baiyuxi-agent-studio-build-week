/**
 * WakeAgentFn production implementation — bridges GameNarratorDriver → A2A dispatch.
 *
 * Flow: wakeAgent(agentId, briefing) → InvocationQueue → CLI session
 * Briefing is delivered via InvocationQueue.content (not messageStore) to prevent
 * leaking game secrets (e.g. "你是狼人") into the thread chat flow.
 */

import type { AgentId } from '@agent-studio/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { InvocationQueue } from '../agents/invocation/InvocationQueue.js';
import type { IThreadStore } from '../stores/ports/ThreadStore.js';
import type { WakeAgentFn } from './GameNarratorDriver.js';

export interface QueueProcessorLike {
  tryAutoExecute(threadId: string): Promise<void>;
}

export interface WakeAgentDeps {
  threadStore: IThreadStore;
  invocationQueue: InvocationQueue;
  queueProcessor: QueueProcessorLike;
  log: FastifyBaseLogger;
}

export function createWakeAgentFn(deps: WakeAgentDeps): WakeAgentFn {
  const { threadStore, invocationQueue, queueProcessor, log } = deps;

  return async (params: { threadId: string; agentId: AgentId; briefing: string; timeoutMs: number }): Promise<void> => {
    const { threadId, agentId, briefing, timeoutMs } = params;

    const thread = await threadStore.get(threadId);
    const userId = thread?.createdBy ?? 'default-user';

    const result = invocationQueue.enqueue({
      threadId,
      userId,
      content: briefing,
      source: 'agent',
      targetAgents: [agentId],
      intent: 'execute',
      autoExecute: true,
    });

    if (result.outcome === 'full') {
      log.warn({ threadId, agentId, gameWake: true }, '[F101] wakeAgent: queue full');
      return;
    }

    await queueProcessor.tryAutoExecute(threadId);

    log.info(
      {
        threadId,
        agentId,
        outcome: result.outcome,
        entryId: result.entry?.id,
        timeoutMs,
        briefingLen: briefing.length,
        gameWake: true,
      },
      '[F101] wakeAgent: agent enqueued for game action',
    );
  };
}
