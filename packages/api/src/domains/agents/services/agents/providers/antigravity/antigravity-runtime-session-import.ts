import { existsSync, readFileSync } from 'node:fs';
import type { AgentId, SessionRecord } from '@agent-studio/shared';
import type { RuntimeSessionMetadata } from '../../../runtime-session/RuntimeSessionMetadata.js';
import type { IRuntimeSessionStore } from '../../../runtime-session/RuntimeSessionStore.js';
import type { ISessionChainStore } from '../../../stores/ports/SessionChainStore.js';

export type LegacyAntigravitySessionDiagnosticCode =
  | 'missing_file'
  | 'invalid_json'
  | 'invalid_shape'
  | 'invalid_key'
  | 'invalid_cascade_id'
  | 'missing_agent_id'
  | 'missing_host_session'
  | 'host_session_identity_mismatch'
  | 'runtime_session_conflict';

export interface LegacyAntigravitySessionDiagnostic {
  code: LegacyAntigravitySessionDiagnosticCode;
  message: string;
  key?: string;
  cascadeId?: string;
}

export interface LegacyAntigravitySessionEntry {
  key: string;
  threadId: string;
  agentId?: AgentId;
  cascadeId: string;
}

export interface LegacyAntigravitySessionMapReadResult {
  entries: LegacyAntigravitySessionEntry[];
  diagnostics: LegacyAntigravitySessionDiagnostic[];
}

export interface ImportLegacyAntigravitySessionsInput {
  path: string;
  runtimeSessionStore: IRuntimeSessionStore;
  sessionChainStore: Pick<ISessionChainStore, 'getByCliSessionId'>;
  fallbackAgentId?: AgentId;
  now?: number;
}

export interface ImportLegacyAntigravitySessionsResult {
  imported: RuntimeSessionMetadata[];
  diagnostics: LegacyAntigravitySessionDiagnostic[];
}

export function readLegacyAntigravitySessionMap(path: string): LegacyAntigravitySessionMapReadResult {
  const diagnostics: LegacyAntigravitySessionDiagnostic[] = [];
  if (!existsSync(path)) {
    return {
      entries: [],
      diagnostics: [{ code: 'missing_file', message: `legacy Antigravity session map not found: ${path}` }],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (err) {
    return {
      entries: [],
      diagnostics: [{ code: 'invalid_json', message: `legacy Antigravity session map is not valid JSON: ${err}` }],
    };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      entries: [],
      diagnostics: [{ code: 'invalid_shape', message: 'legacy Antigravity session map must be an object' }],
    };
  }

  const entries: LegacyAntigravitySessionEntry[] = [];
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== 'string' || value.trim() === '') {
      diagnostics.push({ code: 'invalid_cascade_id', key, message: 'legacy cascade id must be a non-empty string' });
      continue;
    }

    const parsedKey = parseLegacySessionKey(key);
    if (!parsedKey) {
      diagnostics.push({ code: 'invalid_key', key, cascadeId: value, message: 'legacy session key is invalid' });
      continue;
    }

    entries.push({
      key,
      threadId: parsedKey.threadId,
      ...(parsedKey.agentId ? { agentId: parsedKey.agentId as AgentId } : {}),
      cascadeId: value,
    });
  }

  return { entries, diagnostics };
}

export async function importLegacyAntigravitySessions(
  input: ImportLegacyAntigravitySessionsInput,
): Promise<ImportLegacyAntigravitySessionsResult> {
  const readResult = readLegacyAntigravitySessionMap(input.path);
  const diagnostics = [...readResult.diagnostics];
  const imported: RuntimeSessionMetadata[] = [];

  for (const entry of readResult.entries) {
    const keyAgentId = entry.agentId ?? input.fallbackAgentId;
    if (!keyAgentId) {
      diagnostics.push({
        code: 'missing_agent_id',
        key: entry.key,
        cascadeId: entry.cascadeId,
        message: 'thread-only legacy key requires an explicit fallback agent id',
      });
      continue;
    }

    const hostSession = await input.sessionChainStore.getByCliSessionId(entry.cascadeId);
    if (!hostSession) {
      diagnostics.push({
        code: 'missing_host_session',
        key: entry.key,
        cascadeId: entry.cascadeId,
        message: 'legacy cascade id does not resolve to an existing SessionRecord',
      });
      continue;
    }

    if (hostSession.threadId !== entry.threadId || hostSession.agentId !== keyAgentId) {
      diagnostics.push({
        code: 'host_session_identity_mismatch',
        key: entry.key,
        cascadeId: entry.cascadeId,
        message: 'legacy key identity does not match the resolved SessionRecord',
      });
      continue;
    }

    const existing = await input.runtimeSessionStore.getByRuntimeSession('antigravity-desktop', entry.cascadeId);
    if (existing && existing.sessionId !== hostSession.id) {
      diagnostics.push({
        code: 'runtime_session_conflict',
        key: entry.key,
        cascadeId: entry.cascadeId,
        message: 'runtime cascade id is already bound to a different SessionRecord',
      });
      continue;
    }

    const metadata = metadataFromHostSession(hostSession, entry.cascadeId, input.now);
    imported.push(await input.runtimeSessionStore.upsert(metadata));
  }

  return { imported, diagnostics };
}

function parseLegacySessionKey(key: string): { threadId: string; agentId?: string } | null {
  if (key.trim() === '') return null;
  const separator = key.lastIndexOf(':');
  if (separator === -1) return { threadId: key };

  const threadId = key.slice(0, separator);
  const agentId = key.slice(separator + 1);
  if (threadId.trim() === '' || agentId.trim() === '') return null;
  return { threadId, agentId };
}

function metadataFromHostSession(
  hostSession: SessionRecord,
  runtimeSessionId: string,
  now = Date.now(),
): RuntimeSessionMetadata {
  const startedAt = hostSession.createdAt;
  const lastObservedAt = Math.max(startedAt, hostSession.updatedAt, now);
  const state = hostSession.status === 'sealed' ? 'sealed' : 'active';

  return {
    sessionId: hostSession.id,
    runtime: 'antigravity-desktop',
    runtimeSessionId,
    threadId: hostSession.threadId,
    agentId: hostSession.agentId,
    userId: hostSession.userId,
    surface: 'agent-studio-dispatch',
    identityHistory: [
      {
        agentId: hostSession.agentId,
        model: 'unknown',
        modelVerified: false,
        from: startedAt,
        source: 'legacy_json_import',
      },
    ],
    lifecycle: {
      state,
      startedAt,
      lastObservedAt,
      ...(hostSession.sealReason ? { sealReason: hostSession.sealReason } : {}),
      ...(hostSession.status === 'sealed' && hostSession.sealedAt ? { drainResult: 'complete' } : {}),
    },
  };
}
