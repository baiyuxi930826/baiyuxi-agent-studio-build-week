/**
 * Dynamic agentId Zod schema — defers validation to request time.
 *
 * Cannot use z.enum() because route modules are imported at startup
 * before the registry is populated. z.string().refine() evaluates
 * the predicate lazily at validation time.
 */

import { z } from 'zod';
import { agentRegistry } from './AgentRegistry.js';

/**
 * Zod schema for agentId fields in route schemas.
 * Returns z.string() refined against the live registry.
 */
export function agentIdSchema() {
  return z.string().refine(
    (id) => agentRegistry.has(id),
    (id) => ({
      message: `Unknown agent ID: "${id}". Valid: ${agentRegistry.getAllIds().join(', ')}`,
    }),
  );
}
