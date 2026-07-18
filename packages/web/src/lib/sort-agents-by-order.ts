/**
 * F166: Sort agents — agentOrder ids first (in that order), then remaining agents in original order.
 * Pure; silently drops agentOrder ids that don't exist in `agents`.
 */
export function sortAgentsByOrder<T extends { id: string }>(agents: T[], agentOrder: string[]): T[] {
  if (agentOrder.length === 0) return agents;
  const byId = new Map(agents.map((c) => [c.id, c]));
  const pinned: T[] = [];
  const pinnedIds = new Set<string>();
  for (const id of agentOrder) {
    if (pinnedIds.has(id)) continue;
    const agent = byId.get(id);
    if (agent) {
      pinned.push(agent);
      pinnedIds.add(id);
    }
  }
  const rest = agents.filter((c) => !pinnedIds.has(c.id));
  return [...pinned, ...rest];
}
