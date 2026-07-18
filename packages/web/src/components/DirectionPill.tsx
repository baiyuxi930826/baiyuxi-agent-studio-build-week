import type { AgentData } from '@/hooks/useAgentData';
import { UNKNOWN_AGENT_COLOR } from '@/lib/color-defaults';
import type { DirectionInfo } from '@/lib/parse-direction';

interface DirectionPillProps {
  direction: DirectionInfo;
  getAgentById: (id: string) => AgentData | undefined;
}

/**
 * F098: Direction pill badge — shows "→ @角色名" in role color.
 * Placed in ChatMessage header row, after timestamp.
 */
export function DirectionPill({ direction, getAgentById }: DirectionPillProps) {
  const labels = direction.targets.map((target) => {
    if (direction.type === 'crossPost') return target;
    const agent = getAgentById(target);
    return agent ? `@${agent.displayName}` : `@${target}`;
  });
  const text = `${direction.arrow} ${labels.join(' + ')}`;

  // Role color from first target agent (fallback to lead-architect purple)
  const firstAgent = direction.type !== 'crossPost' ? getAgentById(direction.targets[0]) : undefined;
  const color = firstAgent?.color.primary ?? UNKNOWN_AGENT_COLOR.primary;

  return (
    <span
      className="text-micro font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap"
      style={{ backgroundColor: `${color}20`, color }}
    >
      {text}
    </span>
  );
}
