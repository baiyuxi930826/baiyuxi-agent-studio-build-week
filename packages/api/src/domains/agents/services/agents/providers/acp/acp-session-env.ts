/**
 * Per-invocation MCP server env materialization for ACP sessions.
 *
 * Static MCP configs (from .mcp.json via acp-mcp-resolver) don't carry
 * per-invocation callback env (AGENT_STUDIO_API_URL, token, etc.).
 * This module merges callbackEnv into agent-studio* servers before newSession().
 */

import type { AcpMcpServer, AcpMcpServerStdio } from './types.js';

/** Prefix for Agent Studio MCP servers that need callback env injection. */
const AGENT_STUDIO_SERVER_PREFIX = 'agent-studio';

/** Callback env keys injected per-invocation into agent-studio MCP servers. */
const CALLBACK_ENV_KEYS = [
  'AGENT_STUDIO_API_URL',
  'AGENT_STUDIO_INVOCATION_ID',
  'AGENT_STUDIO_CALLBACK_TOKEN',
  'AGENT_STUDIO_THREAD_ID',
  'AGENT_STUDIO_USER_ID',
  'AGENT_STUDIO_AGENT_ID',
  'AGENT_STUDIO_SIGNAL_USER',
] as const;

function isAgentStudioStdioServer(server: AcpMcpServer): server is AcpMcpServerStdio {
  return (
    'command' in server &&
    (server.name === AGENT_STUDIO_SERVER_PREFIX || server.name.startsWith(`${AGENT_STUDIO_SERVER_PREFIX}-`))
  );
}

/**
 * Merge callbackEnv into a stdio server's env array.
 * Overwrites existing entries by name (e.g. replaces `${AGENT_STUDIO_API_URL}` placeholder).
 */
function mergeCallbackEnv(
  existingEnv: Array<{ name: string; value: string }>,
  callbackEnv: Record<string, string>,
): Array<{ name: string; value: string }> {
  const envMap = new Map(existingEnv.map((e) => [e.name, e.value]));
  for (const key of CALLBACK_ENV_KEYS) {
    if (key in callbackEnv) {
      envMap.set(key, callbackEnv[key]);
    }
  }
  return [...envMap.entries()].map(([name, value]) => ({ name, value }));
}

/**
 * Materialize per-invocation MCP server configs by merging callbackEnv
 * into agent-studio* servers. Non-agent-studio servers are passed through unchanged.
 *
 * @returns New array (never mutates input)
 */
export function materializeSessionMcpServers(
  baseServers: AcpMcpServer[],
  callbackEnv?: Record<string, string>,
): AcpMcpServer[] {
  if (!callbackEnv || Object.keys(callbackEnv).length === 0) return baseServers;

  return baseServers.map((server) => {
    if (!isAgentStudioStdioServer(server)) return server;
    return { ...server, env: mergeCallbackEnv(server.env, callbackEnv) };
  });
}

/** Diagnostic: which callback env keys are present (no values — security). */
export function callbackEnvDiagnostic(callbackEnv?: Record<string, string>): Record<string, boolean> {
  return {
    hasApiUrl: !!callbackEnv?.AGENT_STUDIO_API_URL,
    hasInvocationId: !!callbackEnv?.AGENT_STUDIO_INVOCATION_ID,
    hasCallbackToken: !!callbackEnv?.AGENT_STUDIO_CALLBACK_TOKEN,
    hasThreadId: !!callbackEnv?.AGENT_STUDIO_THREAD_ID,
  };
}
