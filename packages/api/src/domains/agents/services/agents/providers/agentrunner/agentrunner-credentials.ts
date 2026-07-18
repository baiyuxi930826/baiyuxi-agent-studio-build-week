/**
 * AgentRunner Credentials — F159: Native Provider Security Baseline
 *
 * Resolves Anthropic API key for direct API calls using the
 * account-binding fail-closed pattern from invoke-single-agent.
 *
 * Single source of truth: agentConfig.accountRef → resolveForClient.
 * No env override, no fallback scan — fail closed if binding is missing.
 */

import type { AgentConfig } from '@agent-studio/shared';
import { resolveForClient } from '../../../../../../config/account-resolver.js';
import { resolveBoundAccountRefForAgent } from '../../../../../../config/agent-account-binding.js';
import { createModuleLogger } from '../../../../../../infrastructure/logger.js';

const log = createModuleLogger('agentrunner-creds');

export interface ApiCredentials {
  apiKey: string;
  baseURL?: string;
  source: string;
}

/**
 * Resolve API credentials using account-binding (fail-closed).
 *
 * Single resolution path: agentConfig.accountRef → resolveBoundAccountRefForAgent → resolveForClient.
 * No env override — account binding is the sole source of truth (AC-B1).
 * No wildcard credential scan — if the bound account doesn't resolve, returns null.
 */
export function resolveApiCredentials(
  projectRoot: string,
  agentId: string,
  agentConfig: AgentConfig | null | undefined,
): ApiCredentials | null {
  const boundRef = resolveBoundAccountRefForAgent(projectRoot, agentId, agentConfig);
  if (!boundRef) {
    log.warn(`[${agentId}] No bound accountRef in agentConfig — cannot resolve credentials`);
    return null;
  }

  const profile = resolveForClient(projectRoot, 'anthropic', boundRef);
  if (!profile?.apiKey) {
    log.warn(`[${agentId}] Bound account "${boundRef}" did not resolve to an API key`);
    return null;
  }

  log.info(`[${agentId}] Resolved API key from bound account: ${boundRef}`);
  return { apiKey: profile.apiKey, baseURL: profile.baseUrl, source: `bound:${boundRef}` };
}
