/**
 * F232 Phase B — Agent filter logic for global artifacts.
 *
 * Pure functions: extract unique agent chips + filter by agentId.
 * Design spec: docs/designs/F232-phase-b-design-spec.md §2.4
 */
import type { GlobalArtifactDTO } from '@agent-studio/shared';

export interface AgentChip {
  agentId: string;
  label: string;
  count: number;
}

/**
 * Extract unique agents from artifacts, sorted by count descending (most prolific first).
 * Each chip has a stable `agentId` key, resolved `label` (nickname or fallback to agentId),
 * and the artifact count for that agent.
 */
export function extractAgentChips(
  artifacts: GlobalArtifactDTO[],
  resolveNickname: (agentId: string) => string | undefined,
): AgentChip[] {
  if (artifacts.length === 0) return [];

  const counts = new Map<string, number>();
  for (const a of artifacts) {
    const id = a.agentId ?? '—';
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort(([, a], [, b]) => b - a)
    .map(([agentId, count]) => ({
      agentId,
      label: (agentId !== '—' ? resolveNickname(agentId) : undefined) ?? agentId,
      count,
    }));
}

/**
 * Filter artifacts by agentId. Returns all if agentId is null (no filter).
 * Uses the same null→'—' normalization as extractAgentChips so that
 * clicking the '—' chip correctly matches null-agentId artifacts.
 */
export function filterByAgent(artifacts: GlobalArtifactDTO[], agentId: string | null): GlobalArtifactDTO[] {
  if (agentId === null) return artifacts;
  return artifacts.filter((a) => (a.agentId ?? '—') === agentId);
}
