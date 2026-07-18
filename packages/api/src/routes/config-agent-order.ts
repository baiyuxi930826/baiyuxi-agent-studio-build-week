/**
 * F166: Agent display order — GET/PUT /api/config/agent-order.
 * Owner-gated writes, file-backed persistence via agent-order-store.
 */

import { agentRegistry } from '@agent-studio/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { loadAgentOrder, saveAgentOrder } from '../config/agent-order-store.js';
import { resolveOwnerGate } from '../utils/owner-gate.js';
import { resolveHeaderUserId } from '../utils/request-identity.js';

interface AgentOrderRoutesOptions {
  projectRoot: string;
}

const putSchema = z.object({
  agentOrder: z.array(z.string().min(1)),
});

export async function configAgentOrderRoutes(app: FastifyInstance, opts: AgentOrderRoutesOptions): Promise<void> {
  const { projectRoot } = opts;

  app.get('/api/config/agent-order', async () => ({
    agentOrder: loadAgentOrder(projectRoot),
  }));

  app.put('/api/config/agent-order', async (request: FastifyRequest, reply: FastifyReply) => {
    const operator = resolveHeaderUserId(request);
    if (!operator) {
      reply.status(400);
      return { error: 'Identity required (X-Agent-Studio-User header)' };
    }
    const gateResult = resolveOwnerGate(operator, {
      errorMessage: 'Only the owner can change agent order',
    });
    if (gateResult) {
      reply.status(gateResult.status);
      return { error: gateResult.error };
    }

    const parsed = putSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: 'Invalid request', details: parsed.error.issues };
    }

    const deduped = [...new Set(parsed.data.agentOrder)];
    const unknown = deduped.find((id) => !agentRegistry.has(id));
    if (unknown) {
      reply.status(400);
      return { error: `Unknown agentId: ${unknown}` };
    }

    saveAgentOrder(projectRoot, deduped);
    return { agentOrder: deduped };
  });
}
