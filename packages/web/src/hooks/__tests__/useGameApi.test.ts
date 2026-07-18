import { beforeEach, describe, expect, it, vi } from 'vitest';
import { abortGame, fetchGameState, submitAction } from '../useGameApi';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock api-client and userId
vi.mock('@/utils/api-client', () => ({ API_URL: 'http://localhost:3102' }));
vi.mock('@/utils/userId', () => ({ getUserId: () => 'test-user-id' }));

beforeEach(() => {
  mockFetch.mockReset();
});

describe('fetchGameState', () => {
  it('calls GET /api/threads/:threadId/game', async () => {
    const view = { gameId: 'g1', status: 'playing' };
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(view) });
    const result = await fetchGameState('t1');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3102/api/threads/t1/game',
      expect.objectContaining({ headers: expect.objectContaining({ 'x-user-id': 'test-user-id' }) }),
    );
    expect(result).toEqual(view);
  });

  it('passes viewer query param', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });
    await fetchGameState('t1', 'P2');
    expect(mockFetch).toHaveBeenCalledWith('http://localhost:3102/api/threads/t1/game?viewer=P2', expect.any(Object));
  });

  it('returns null on error', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404, text: () => Promise.resolve('not found') });
    const result = await fetchGameState('t1');
    expect(result).toBeNull();
  });
});

describe('submitAction', () => {
  it('calls POST /api/threads/:threadId/game/action', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });
    const result = await submitAction('t1', 'P2', 'vote', 'P3');
    expect(result).toEqual({ success: true });
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3102/api/threads/t1/game/action',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ seatId: 'P2', actionName: 'vote', targetSeat: 'P3', params: undefined }),
      }),
    );
  });

  it('returns error on failure', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 400, text: () => Promise.resolve('bad request') });
    const result = await submitAction('t1', 'P2', 'vote', 'P3');
    expect(result.success).toBe(false);
    expect(result.error).toContain('400');
  });
});

describe('abortGame', () => {
  it('calls DELETE /api/threads/:threadId/game', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });
    await abortGame('t1');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3102/api/threads/t1/game',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
