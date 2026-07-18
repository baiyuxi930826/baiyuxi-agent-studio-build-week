import { useGameStore } from '@/stores/gameStore';
import { fetchGameState } from './useGameApi';

/**
 * Fetch current game state from API and hydrate the game store.
 * Called on socket reconnect or page refresh to recover game state.
 */
export async function reconnectGame(threadId: string): Promise<void> {
  try {
    const view = await fetchGameState(threadId);
    if (view) {
      useGameStore.getState().setGameView(view, view.gameId, threadId);
    } else {
      useGameStore.getState().clearGame();
    }
  } catch {
    useGameStore.getState().clearGame();
  }
}
