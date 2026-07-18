import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createAgentId } from '@agent-studio/shared';
import type { AgentKeyRegistry } from './AgentKeyRegistry.js';

const DEFAULT_ANTIGRAVITY_AGENT_KEY_DIR = join(homedir(), '.agent-studio', 'agent-keys');
const DEFAULT_ANTIGRAVITY_AGENT_KEY_FILE = join(DEFAULT_ANTIGRAVITY_AGENT_KEY_DIR, 'antigravity.secret');
const DEFAULT_ANTIGRAVITY_AGENT_IDS = ['antigravity', 'antig-opus'] as const;

export interface AntigravityAgentKeySidecarOptions {
  agentId?: string;
  agentIds?: readonly string[];
  userId?: string;
  filePath?: string;
  filePathByAgentId?: Readonly<Record<string, string>>;
  env?: NodeJS.ProcessEnv;
}

export interface AntigravityAgentKeySidecarResult {
  agentKeyId: string;
  agentKeyIds: Record<string, string>;
  agentId: string;
  agentIds: string[];
  userId: string;
  filePath: string;
  agentKeyFiles: Record<string, string>;
}

function uniqueAgentIds(defaultAgentId: string, agentIds?: readonly string[]): string[] {
  const source = agentIds ?? (defaultAgentId === 'antigravity' ? DEFAULT_ANTIGRAVITY_AGENT_IDS : [defaultAgentId]);
  return [...new Set([defaultAgentId, ...source].map((value) => value.trim()).filter(Boolean))];
}

function defaultFilePathForAgentId(defaultAgentId: string, defaultFilePath: string, agentId: string): string {
  if (agentId === defaultAgentId) return defaultFilePath;
  return join(dirname(defaultFilePath), `${agentId}.secret`);
}

export async function ensureAntigravityAgentKeySidecar(
  registry: AgentKeyRegistry,
  options: AntigravityAgentKeySidecarOptions = {},
): Promise<AntigravityAgentKeySidecarResult> {
  const env = options.env ?? process.env;
  const agentId = options.agentId ?? 'antigravity';
  const agentIds = uniqueAgentIds(agentId, options.agentIds);
  const userId =
    options.userId ?? env.AGENT_STUDIO_AGENT_KEY_USER_ID?.trim() ?? env.AGENT_STUDIO_USER_ID?.trim() ?? 'default-user';
  const filePath = options.filePath ?? env.AGENT_STUDIO_AGENT_KEY_FILE?.trim() ?? DEFAULT_ANTIGRAVITY_AGENT_KEY_FILE;

  const agentKeyIds: Record<string, string> = {};
  const agentKeyFiles: Record<string, string> = {};

  for (const currentAgentId of agentIds) {
    const currentFilePath =
      options.filePathByAgentId?.[currentAgentId] ?? defaultFilePathForAgentId(agentId, filePath, currentAgentId);
    const issued = await registry.issue(createAgentId(currentAgentId), userId);
    await mkdir(dirname(currentFilePath), { recursive: true, mode: 0o700 });
    await writeFile(currentFilePath, `${issued.secret}\n`, { mode: 0o600 });
    await chmod(currentFilePath, 0o600).catch(() => {
      // Best-effort on filesystems that do not support chmod; writeFile(mode)
      // already requested the strict sidecar permission.
    });
    agentKeyIds[currentAgentId] = issued.agentKeyId;
    agentKeyFiles[currentAgentId] = currentFilePath;
  }

  env.AGENT_STUDIO_AGENT_KEY_FILE = filePath;
  env.AGENT_STUDIO_AGENT_KEY_FILES = JSON.stringify(agentKeyFiles);
  return { agentKeyId: agentKeyIds[agentId] ?? '', agentKeyIds, agentId, agentIds, userId, filePath, agentKeyFiles };
}
