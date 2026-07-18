/**
 * F075 Phase B — In-memory game record store
 * Tracks game results (推理局, 谁是卧底, etc.) and computes stats.
 */

import { randomUUID } from 'node:crypto';
import type { GameRecord, GameRecordInput, GameStats, RankedAgent } from '@agent-studio/shared';

export class GameStore {
  private records: GameRecord[] = [];

  append(input: GameRecordInput): GameRecord {
    const record: GameRecord = { ...input, id: randomUUID() };
    this.records.push(record);
    return record;
  }

  getByAgent(agentId: string): GameRecord[] {
    return this.records.filter((r) => r.agentId === agentId);
  }

  getByGame(game: string): GameRecord[] {
    return this.records.filter((r) => r.game === game);
  }

  computeGameStats(agentNames: Record<string, string>): GameStats {
    // Agent Kill stats
    const agentTeamDrillRecords = this.records.filter((r) => r.game === 'agent-kill');
    const wins = agentTeamDrillRecords.filter((r) => r.result === 'win' || r.result === 'mvp').length;
    const mvps = agentTeamDrillRecords.filter((r) => r.result === 'mvp').length;

    const winCount = new Map<string, number>();
    for (const r of agentTeamDrillRecords) {
      if (r.result === 'win' || r.result === 'mvp') {
        winCount.set(r.agentId, (winCount.get(r.agentId) ?? 0) + 1);
      }
    }
    const topAgent = this.topRanked(winCount, agentNames);

    // Who Spy stats
    const spyRecords = this.records.filter((r) => r.game === 'who-spy');
    const shameCount = spyRecords.filter((r) => r.result === 'shame').length;

    const shameMap = new Map<string, number>();
    for (const r of spyRecords) {
      if (r.result === 'shame') {
        shameMap.set(r.agentId, (shameMap.get(r.agentId) ?? 0) + 1);
      }
    }
    const shameAgent = this.topRanked(shameMap, agentNames);

    return {
      agentTeamDrill: { wins, mvps, ...(topAgent ? { topAgent } : {}) },
      whoSpy: { shameCount, ...(shameAgent ? { shameAgent } : {}) },
    };
  }

  private topRanked(counter: Map<string, number>, agentNames: Record<string, string>): RankedAgent | undefined {
    if (counter.size === 0) return undefined;
    const [agentId, count] = [...counter.entries()].sort((a, b) => b[1] - a[1])[0]!;
    return { agentId, displayName: agentNames[agentId] ?? agentId, count, rank: 1 };
  }

  get size(): number {
    return this.records.length;
  }
}
