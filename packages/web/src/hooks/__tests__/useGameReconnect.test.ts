import type { GameView } from '@agent-studio/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameStore } from '../../stores/gameStore';

// Mock useGameApi
const mockFetchGameState = vi.fn();
vi.mock('../../hooks/useGameApi', () => ({
  fetchGameState: (...args: unknown[]) => mockFetchGameState(...args),
}));

const mockView: GameView = {
  gameId: 'g1',
  threadId: 't1',
  gameType: 'werewolf',
  status: 'playing',
  currentPhase: 'day_discuss',
  round: 1,
  seats: [{ seatId: 'P1', actorType: 'agent', actorId: 'opus', displayName: '宪宪', alive: true }],
  visibleEvents: [],
  config: { timeoutMs: 120000, voiceMode: false, humanRole: 'player' as const },
};

beforeEach(() => {
  mockFetchGameState.mockReset();
  useGameStore.getState().clearGame();
});

describe('reconnectGame', () => {
  it('fetches game state and hydrates store on reconnect', async () => {
    mockFetchGameState.mockResolvedValueOnce(mockView);

    const { reconnectGame } = await import('../useGameReconnect');
    await reconnectGame('t1');

    expect(mockFetchGameState).toHaveBeenCalledWith('t1');
    const state = useGameStore.getState();
    expect(state.gameView).toEqual(mockView);
    expect(state.isGameActive).toBe(true);
    expect(state.gameId).toBe('g1');
  });

  it('clears game if API returns null', async () => {
    // First set some state
    useGameStore.getState().setGameView(mockView, 'g1', 't1');
    expect(useGameStore.getState().isGameActive).toBe(true);

    mockFetchGameState.mockResolvedValueOnce(null);

    const { reconnectGame } = await import('../useGameReconnect');
    await reconnectGame('t1');

    expect(useGameStore.getState().gameView).toBeNull();
    expect(useGameStore.getState().isGameActive).toBe(false);
  });

  it('clears game if API throws', async () => {
    useGameStore.getState().setGameView(mockView, 'g1', 't1');

    mockFetchGameState.mockRejectedValueOnce(new Error('network error'));

    const { reconnectGame } = await import('../useGameReconnect');
    await reconnectGame('t1');

    expect(useGameStore.getState().gameView).toBeNull();
    expect(useGameStore.getState().isGameActive).toBe(false);
  });
});
