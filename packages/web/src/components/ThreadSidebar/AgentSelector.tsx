'use client';

import { formatAgentName, useAgentData } from '@/hooks/useAgentData';
import { agentColorMix, agentColorVar } from '@/lib/agent-slug';

interface AgentSelectorProps {
  selectedAgents: string[];
  onSelectionChange: (ids: string[]) => void;
}

/**
 * F32-b Phase 3: Role-grouped agent chip selector.
 * Used in thread creation (DirectoryPickerModal) and thread settings.
 */
export function AgentSelector({ selectedAgents, onSelectionChange }: AgentSelectorProps) {
  const { getAgentsByRole } = useAgentData();
  const groups = getAgentsByRole();

  const toggleAgent = (agentId: string) => {
    if (selectedAgents.includes(agentId)) {
      onSelectionChange(selectedAgents.filter((id) => id !== agentId));
    } else {
      onSelectionChange([...selectedAgents, agentId]);
    }
  };

  // Client display name mapping
  const clientIdLabel = (clientId: string) => {
    const map: Record<string, string> = {
      anthropic: 'Anthropic',
      openai: 'OpenAI',
      google: 'Google',
    };
    return map[clientId] ?? clientId;
  };

  return (
    <div className="space-y-2">
      <div className="text-xs text-studio-secondary font-medium">默认角色 (可选)</div>
      {[...groups.entries()].map(([roleId, agents]) => {
        const roleName = agents[0].roleDisplayName ?? agents[0].displayName;
        return (
          <div key={roleId}>
            <div className="text-micro text-studio-muted mb-1">
              {roleName}家族 · {clientIdLabel(agents[0].clientId)}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {agents.map((agent) => {
                const isSelected = selectedAgents.includes(agent.id);
                return (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => toggleAgent(agent.id)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs transition-colors border ${
                      isSelected
                        ? 'font-medium border-current'
                        : 'border-studio text-studio-secondary hover:border-[var(--console-border-strong)]'
                    }`}
                    style={
                      isSelected
                        ? {
                            color: agentColorVar(agent.id, 'primary'),
                            backgroundColor: agentColorMix(agent.id, 0.1, 'primary'),
                            borderColor: agentColorVar(agent.id, 'primary'),
                          }
                        : undefined
                    }
                  >
                    <span
                      className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: agentColorVar(agent.id, 'primary') }}
                    />
                    {formatAgentName(agent)}
                    {!agent.variantLabel && agent.nickname ? `(${agent.nickname})` : ''}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
