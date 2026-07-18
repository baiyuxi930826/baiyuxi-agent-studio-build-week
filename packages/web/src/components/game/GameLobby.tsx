'use client';

import { useCallback, useMemo, useState } from 'react';
import type { AgentData } from '@/hooks/useAgentData';
import { agentColorVar } from '@/lib/agent-slug';

/** Available board presets — mirrors WEREWOLF_PRESETS on backend */
const BOARD_PRESETS = [
  { count: 6, label: '6人局', desc: '2狼 1预言 1女巫 2村民' },
  { count: 7, label: '7人局', desc: '2狼 1预言 1女巫 1猎人 2村民' },
  { count: 8, label: '8人局', desc: '3狼 1预言 1女巫 1猎人 2村民' },
  { count: 9, label: '9人局', desc: '3狼 1预言 1女巫 1猎人 3村民' },
  { count: 10, label: '10人局', desc: '3狼 1预言 1女巫 1猎人 4村民' },
  { count: 12, label: '12人局', desc: '4狼 1预言 1女巫 1猎人 1守卫 4村民' },
] as const;

export interface GameStartPayload {
  gameType: 'werewolf';
  humanRole: 'player' | 'god-view' | 'detective';
  playerCount: number;
  agentIds: string[];
  voiceMode: boolean;
  detectiveAgentId?: string;
}

interface GameLobbyProps {
  mode: 'player' | 'god-view' | 'detective';
  agents: AgentData[];
  onConfirm: (payload: GameStartPayload) => void;
  onCancel: () => void;
}

export function GameLobby({ mode, agents, onConfirm, onCancel }: GameLobbyProps) {
  const [selectedPreset, setSelectedPreset] = useState(7);
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(() => new Set<string>());
  const [voiceMode, setVoiceMode] = useState(false);
  // Detective mode: which agent to bind to
  const [detectiveAgentId, setDetectiveAgentId] = useState<string | null>(null);

  // How many agent seats needed (detective = same as god-view: all agents)
  const agentSeatsNeeded = mode === 'player' ? selectedPreset - 1 : selectedPreset;
  const selectedAgentList = useMemo(() => agents.filter((c) => selectedAgents.has(c.id)), [agents, selectedAgents]);
  // Must select enough agents to fill all seats (no duplicate actors!)
  const canStart =
    selectedAgentList.length >= agentSeatsNeeded &&
    (mode !== 'detective' || (detectiveAgentId !== null && selectedAgents.has(detectiveAgentId)));

  const toggleAgent = useCallback((agentId: string) => {
    setSelectedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) {
        next.delete(agentId);
        // Clear detective binding if the bound agent was deselected
        setDetectiveAgentId((prev) => (prev === agentId ? null : prev));
      } else {
        next.add(agentId);
      }
      return next;
    });
  }, []);

  const handleConfirm = useCallback(() => {
    onConfirm({
      gameType: 'werewolf',
      humanRole: mode,
      playerCount: selectedPreset,
      agentIds: selectedAgentList.map((c) => c.id),
      voiceMode,
      ...(mode === 'detective' && detectiveAgentId ? { detectiveAgentId } : {}),
    });
  }, [mode, selectedPreset, selectedAgentList, voiceMode, detectiveAgentId, onConfirm]);

  return (
    <div
      data-testid="game-lobby"
      data-theme="werewolf-cute"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ww-base-overlay backdrop-blur-sm"
    >
      <div className="bg-ww-topbar rounded-2xl border border-ww-subtle w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-ww-subtle">
          <h2 className="text-ww-main font-semibold text-lg">
            狼人杀 — {mode === 'player' ? '玩家模式' : mode === 'detective' ? '推理模式' : '上帝视角'}
          </h2>
          <button
            onClick={onCancel}
            className="text-ww-dim hover:text-ww-main transition-colors p-1 rounded"
            aria-label="取消"
          >
            <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>

        {/* Board preset selection */}
        <div className="px-6 py-4">
          <div className="text-sm text-ww-muted font-medium mb-3">选择板子</div>
          <div className="grid grid-cols-3 gap-2">
            {BOARD_PRESETS.map((preset) => (
              <button
                key={preset.count}
                data-testid={`preset-${preset.count}`}
                onClick={() => setSelectedPreset(preset.count)}
                className={`rounded-lg px-3 py-2 text-left transition-colors border ${
                  selectedPreset === preset.count
                    ? 'border-ww-cute bg-ww-cute-soft text-ww-cute'
                    : 'border-ww-subtle text-ww-muted hover:border-ww-active'
                }`}
              >
                <div className="text-sm font-semibold">{preset.label}</div>
                <div className="text-micro opacity-70 mt-0.5">{preset.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Agent selection */}
        <div className="px-6 py-4 border-t border-ww-subtle">
          <div className="text-sm text-ww-muted font-medium mb-3">
            选择参赛Agent（点击添加）
            <span className="ml-2 text-xs">
              ({selectedAgentList.length}/{agentSeatsNeeded} 席位
              {selectedAgentList.length < agentSeatsNeeded && (
                <span className="text-ww-danger ml-1">还需 {agentSeatsNeeded - selectedAgentList.length} 只</span>
              )}
              )
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {agents.map((agent) => (
              <button
                key={agent.id}
                data-testid={`agent-toggle-${agent.id}`}
                onClick={() => toggleAgent(agent.id)}
                className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm transition-colors border ${
                  selectedAgents.has(agent.id)
                    ? 'border-current bg-studio-surface/5 font-medium'
                    : 'border-ww-subtle text-ww-dim hover:border-ww-active'
                }`}
                style={selectedAgents.has(agent.id) ? { color: agentColorVar(agent.id, 'primary') } : undefined}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={agent.avatar}
                  alt={agent.displayName}
                  className="w-5 h-5 rounded-full"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
                {agent.displayName}
              </button>
            ))}
          </div>
        </div>

        {/* Detective mode: pick ONE agent to bind */}
        {mode === 'detective' && (
          <div className="px-6 py-4 border-t border-ww-subtle">
            <div className="text-sm text-ww-muted font-medium mb-3">
              选择绑定Agent
              <span className="ml-2 text-xs opacity-70">（只能看到这个角色的视角）</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {selectedAgentList.map((agent) => (
                <button
                  key={agent.id}
                  data-testid={`detective-bind-${agent.id}`}
                  onClick={() => setDetectiveAgentId(agent.id)}
                  className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm transition-colors border ${
                    detectiveAgentId === agent.id
                      ? 'border-ww-cute bg-ww-cute-soft text-ww-cute font-medium'
                      : 'border-ww-subtle text-ww-dim hover:border-ww-active'
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={agent.avatar}
                    alt={agent.displayName}
                    className="w-5 h-5 rounded-full"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                  {agent.displayName}
                </button>
              ))}
            </div>
            {!detectiveAgentId && <div className="text-xs text-ww-danger mt-2">请选择一个角色绑定视角</div>}
          </div>
        )}

        {/* Voice mode toggle + actions */}
        <div className="px-6 py-4 border-t border-ww-subtle flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-ww-muted cursor-pointer">
            <input
              type="checkbox"
              checked={voiceMode}
              onChange={(e) => setVoiceMode(e.target.checked)}
              className="rounded border-ww-subtle"
            />
            语音模式
          </label>
          <div className="flex gap-3">
            <button
              onClick={onCancel}
              className="px-4 py-2 rounded-lg text-sm text-ww-muted hover:text-ww-main transition-colors"
            >
              取消
            </button>
            <button
              data-testid="lobby-confirm"
              onClick={handleConfirm}
              disabled={!canStart}
              className="px-6 py-2 rounded-lg text-sm font-semibold bg-ww-cute text-ww-base hover:brightness-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              开始游戏
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
