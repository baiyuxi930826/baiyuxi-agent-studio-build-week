'use client';

/**
 * F32-b Phase 3: Central hook for dynamic agent data from /api/agents.
 * Fetches once per session, caches module-level. All consumers share same data.
 */

import { useEffect, useMemo, useState } from 'react';
import { UNKNOWN_AGENT_COLOR } from '@/lib/color-defaults';
import { refreshMentionData } from '@/lib/mention-highlight';
import { sortAgentsByOrder } from '@/lib/sort-agents-by-order';
import { apiFetch } from '@/utils/api-client';
import { refreshSpeechAliases } from '@/utils/transcription-corrector';

export interface AgentData {
  id: string;
  name?: string;
  displayName: string;
  nickname?: string;
  color: { primary: string; secondary: string };
  mentionPatterns: string[];
  roleId?: string;
  accountRef?: string;
  /** baiyuxi-agent-studio#340 P5: CLI client identity (renamed from provider). */
  clientId: string;
  defaultModel: string;
  cli?: {
    command?: string;
    outputFormat?: string;
    defaultArgs?: string[];
    effort?: string;
  };
  commandArgs?: string[];
  cliConfigArgs?: string[];
  /** baiyuxi-agent-studio#340 P5: Model provider name (renamed from ocProviderName). */
  provider?: string;
  contextBudget?: {
    maxPromptTokens: number;
    maxContextTokens: number;
    maxMessages: number;
    maxContentLengthPerMsg: number;
  };
  avatar: string;
  roleDescription: string;
  personality: string;
  teamStrengths?: string;
  caution?: string | null;
  strengths?: string[];
  sessionChain?: boolean;
  /** F32-b P4: Human-readable variant label (e.g. "4.5", "Sonnet") */
  variantLabel?: string;
  /** F32-b P4: Whether this is the default variant for its role */
  isDefaultVariant?: boolean;
  /** F32-b P4: Family-level display name, for group headings */
  roleDisplayName?: string;
  voiceConfig?: {
    voice: string;
    langCode: string;
    speed?: number;
    refAudio?: string;
    refText?: string;
    instruct?: string;
    temperature?: number;
  };
  /** F149: Adapter mode for Google provider agents (ACP vs legacy CLI) */
  adapterMode?: 'acp' | 'cli';
  /** F127: Roster metadata used by Hub ownership/lead markers */
  roster?: {
    family: string;
    roles: string[];
    lead: boolean;
    available: boolean;
    evaluation: string;
  } | null;
}

// ── Module-level cache ──────────────────────────────────
let _cached: AgentData[] | null = null;
let _fetchPromise: Promise<FetchResult> | null = null;
let _agentOrder: string[] = [];
const _listeners = new Set<(agents: AgentData[]) => void>();
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 10_000;

function notifyListeners(agents: AgentData[]): void {
  for (const listener of _listeners) {
    listener(agents);
  }
}

interface FetchResult {
  agents: AgentData[];
  fromApi: boolean;
}

async function fetchAgentOrder(): Promise<string[]> {
  try {
    const res = await apiFetch('/api/config/agent-order');
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data?.agentOrder)) return [];
    return (data.agentOrder as unknown[]).filter((id): id is string => typeof id === 'string');
  } catch {
    return [];
  }
}

async function fetchAgents(): Promise<FetchResult> {
  try {
    const [agentsRes, orderIds] = await Promise.all([apiFetch('/api/agents'), fetchAgentOrder()]);
    _agentOrder = orderIds;
    if (!agentsRes.ok) return { agents: [], fromApi: false };
    const data = await agentsRes.json();
    const normalized = Array.isArray(data?.agents) ? normalizeAgents(data.agents) : null;
    return { agents: normalized ? sortAgentsByOrder(normalized, _agentOrder) : [], fromApi: normalized !== null };
  } catch {
    return { agents: [], fromApi: false };
  }
}

function normalizeAgents(rawAgents: unknown[]): AgentData[] {
  return rawAgents.map((raw) => {
    const agent = raw as Partial<AgentData>;
    return {
      ...agent,
      id: agent.id ?? '',
      displayName: agent.displayName ?? agent.id ?? '',
      color: agent.color ?? UNKNOWN_AGENT_COLOR,
      mentionPatterns: Array.isArray(agent.mentionPatterns) ? agent.mentionPatterns : [],
      accountRef: agent.accountRef,
      clientId: agent.clientId ?? 'openai',
      defaultModel: agent.defaultModel ?? '',
      cli: agent.cli,
      avatar: agent.avatar ?? '',
      roleDescription: agent.roleDescription ?? '',
      personality: agent.personality ?? '',
      teamStrengths: agent.teamStrengths,
      caution: agent.caution,
      strengths: Array.isArray(agent.strengths) ? agent.strengths : undefined,
      sessionChain: agent.sessionChain,
      roster: agent.roster ?? null,
    };
  });
}

async function refreshAgentsNow(): Promise<FetchResult> {
  const prev = _cached;
  _cached = null;
  _fetchPromise = fetchAgents();
  const result = await _fetchPromise;
  if (result.fromApi) {
    _cached = result.agents;
  } else {
    // Preserve previous cache on failure — avoids false-empty states during transient outages
    _cached = prev;
    _fetchPromise = null;
  }
  const effective = result.fromApi ? result.agents : (_cached ?? []);
  refreshMentionData(effective);
  refreshSpeechAliases(effective);
  notifyListeners(effective);
  return { agents: effective, fromApi: result.fromApi };
}

// ── Hook ────────────────────────────────────────────────

export function useAgentData() {
  const [agents, setAgents] = useState<AgentData[]>(() => _cached ?? []);
  const [isLoading, setIsLoading] = useState(!_cached);
  const [hasFetched, setHasFetched] = useState(!!_cached);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    const listener = (nextAgents: AgentData[]) => {
      setAgents(nextAgents);
      setIsLoading(false);
    };
    _listeners.add(listener);
    return () => {
      _listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (_cached) {
      setAgents(_cached);
      setIsLoading(false);
      return;
    }
    if (!_fetchPromise) {
      _fetchPromise = fetchAgents();
    }
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    _fetchPromise.then(({ agents: result, fromApi }) => {
      if (fromApi) {
        _cached = result;
      } else {
        _fetchPromise = null;
        // Schedule retry for already-mounted hooks (max 3 attempts, 10s apart)
        if (retryCount < MAX_RETRIES) {
          retryTimer = setTimeout(() => {
            if (!cancelled) setRetryCount((c) => c + 1);
          }, RETRY_DELAY_MS);
        }
      }
      refreshMentionData(result);
      refreshSpeechAliases(result);
      notifyListeners(result);
      if (!cancelled) {
        setAgents(result);
        setIsLoading(false);
        if (fromApi) setHasFetched(true);
      }
    });
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
    };
  }, [retryCount]);

  const refresh = useMemo(
    () => async () => {
      setIsLoading(true);
      const result = await refreshAgentsNow();
      setAgents(result.agents);
      if (result.fromApi) setHasFetched(true);
      setIsLoading(false);
      return result.agents;
    },
    [],
  );

  const getAgentById = useMemo(() => {
    const map = new Map(agents.map((c) => [c.id, c]));
    return (id: string) => map.get(id);
  }, [agents]);

  const getAgentsByRole = useMemo(() => {
    return () => {
      const groups = new Map<string, AgentData[]>();
      for (const agent of agents) {
        const key = agent.roleId ?? agent.id;
        const arr = groups.get(key) ?? [];
        arr.push(agent);
        groups.set(key, arr);
      }
      return groups;
    };
  }, [agents]);

  return { agents, isLoading, hasFetched, getAgentById, getAgentsByRole, refresh };
}

/** Format agent name with optional variant label for multi-variant disambiguation */
export function formatAgentName(agent: { displayName: string; variantLabel?: string }): string {
  return agent.variantLabel ? `${agent.displayName}（${agent.variantLabel}）` : agent.displayName;
}

/** Get cached agents synchronously (for non-hook contexts). Returns empty if not loaded. */
export function getCachedAgents(): AgentData[] {
  return _cached ?? [];
}

/** Reset module-level cache (for testing) */
export function _resetAgentDataCache(): void {
  _cached = null;
  _fetchPromise = null;
  _agentOrder = [];
  _saveSeq = 0;
  _lastSuccessSeq = 0;
  _listeners.clear();
}

let _saveSeq = 0;
let _lastSuccessSeq = 0;

/**
 * F166: Persist custom agent order and update the cached list optimistically.
 * Throws on network failure — callers are expected to roll back UI state.
 * Uses monotonic sequences: _saveSeq tracks all requests, _lastSuccessSeq tracks
 * the newest successful one. Stale success still updates cache if no newer success exists.
 */
export async function saveAgentOrder(agentOrder: string[]): Promise<void> {
  const mySeq = ++_saveSeq;
  const res = await apiFetch('/api/config/agent-order', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentOrder }),
  });
  if (!res.ok) throw new Error(`Failed to save agent order: ${res.status}`);
  if (mySeq <= _lastSuccessSeq) return;
  _lastSuccessSeq = mySeq;
  _agentOrder = agentOrder;
  if (_cached) {
    const reordered = sortAgentsByOrder(_cached, agentOrder);
    _cached = reordered;
    notifyListeners(reordered);
  }
}
