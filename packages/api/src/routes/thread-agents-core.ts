/**
 * Thread agents categorization core — shared by F142 route and MCP callback.
 * Single source of truth for participant/routable/notRoutable classification.
 */

export interface ParticipantActivityInput {
  agentId: string;
  lastMessageAt: number;
  messageCount: number;
  lastResponseHealthy?: boolean;
}

export interface AgentEntry {
  agentId: string;
  displayName: string;
}

export interface ThreadAgentsCategorization {
  participants: Array<AgentEntry & { lastMessageAt: number; messageCount: number; lastResponseHealthy?: boolean }>;
  routableNow: AgentEntry[];
  routableNotJoined: AgentEntry[];
  notRoutable: AgentEntry[];
}

export interface CategorizeThreadAgentsInput {
  participantActivity: ParticipantActivityInput[];
  registeredServices: Map<string, unknown>;
  allAgentIds: string[];
  getAgentDisplayName: (agentId: string) => string;
  isAgentAvailable: (agentId: string) => boolean;
}

/**
 * Categorize agents for a thread (KD-9 logic).
 * - routableNow: participants with active service + available
 * - routableNotJoined: non-participants with active service + available
 * - notRoutable: non-participants with available=false
 */
export function categorizeThreadAgents(input: CategorizeThreadAgentsInput): ThreadAgentsCategorization {
  const { participantActivity, registeredServices, allAgentIds, getAgentDisplayName, isAgentAvailable } = input;
  const participantIds = new Set(participantActivity.map((p) => p.agentId));

  const routableNow: AgentEntry[] = [];
  const routableNotJoined: AgentEntry[] = [];
  const notRoutable: AgentEntry[] = [];

  for (const agentId of allAgentIds) {
    const hasService = registeredServices.has(agentId);
    const available = isAgentAvailable(agentId);
    const isParticipant = participantIds.has(agentId);

    if (!available && !isParticipant) {
      notRoutable.push({ agentId, displayName: getAgentDisplayName(agentId) });
    } else if (hasService && available && !isParticipant) {
      routableNotJoined.push({ agentId, displayName: getAgentDisplayName(agentId) });
    }
  }

  for (const p of participantActivity) {
    if (registeredServices.has(p.agentId) && isAgentAvailable(p.agentId)) {
      routableNow.push({ agentId: p.agentId, displayName: getAgentDisplayName(p.agentId) });
    }
  }

  const participants = participantActivity.map((p) => ({
    agentId: p.agentId,
    displayName: getAgentDisplayName(p.agentId),
    lastMessageAt: p.lastMessageAt,
    messageCount: p.messageCount,
    ...(p.lastResponseHealthy !== undefined && { lastResponseHealthy: p.lastResponseHealthy }),
  }));

  return { participants, routableNow, routableNotJoined, notRoutable };
}
