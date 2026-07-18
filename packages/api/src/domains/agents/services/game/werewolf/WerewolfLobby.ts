/**
 * WerewolfLobby (F101 Task B4)
 *
 * Creates lobby state and handles role assignment + game start.
 */

import type { GameEvent, GameRuntime, Seat } from '@agent-studio/shared';
import { createWerewolfDefinition, WEREWOLF_PRESETS } from './WerewolfDefinition.js';

interface LobbyInput {
  threadId: string;
  playerCount: number;
  players: Array<{ actorType: string; actorId: string }>;
}

export class WerewolfLobby {
  createLobby(input: LobbyInput): GameRuntime {
    const { threadId, playerCount, players } = input;

    if (!WEREWOLF_PRESETS[playerCount]) {
      throw new Error(`No preset for ${playerCount} players`);
    }

    const definition = createWerewolfDefinition(playerCount);

    const seats: Seat[] = players.map((p, i) => ({
      seatId: `P${i + 1}` as `P${number}`,
      actorType: p.actorType as 'human' | 'agent' | 'system',
      actorId: p.actorId,
      role: '',
      alive: true,
      properties: {},
    }));

    return {
      gameId: `game-${threadId}-${Date.now()}`,
      threadId,
      gameType: 'werewolf',
      definition,
      seats,
      currentPhase: 'lobby',
      round: 0,
      eventLog: [],
      pendingActions: {},
      status: 'lobby' as GameRuntime['status'],
      config: { timeoutMs: 30000, voiceMode: false, humanRole: 'player' },
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  startGame(runtime: GameRuntime): void {
    const roles = this.buildRoleList(runtime);
    this.shuffle(roles);

    // Assign roles to seats
    for (let i = 0; i < runtime.seats.length; i++) {
      runtime.seats[i]!.role = roles[i]!;
    }

    // Emit scoped role_assigned events
    let eventCounter = runtime.eventLog.length;
    for (const seat of runtime.seats) {
      eventCounter++;
      const event: GameEvent = {
        eventId: `evt-${eventCounter}`,
        round: 1,
        phase: 'role_assignment',
        type: 'role_assigned',
        scope: `seat:${seat.seatId}`,
        payload: { seatId: seat.seatId, role: seat.role },
        timestamp: Date.now(),
      };
      runtime.eventLog.push(event);
    }

    // Transition to playing
    runtime.status = 'playing';
    runtime.currentPhase = runtime.definition.phases[0]?.name ?? 'night_guard';
    runtime.round = 1;
    runtime.updatedAt = Date.now();
    runtime.version++;
  }

  private buildRoleList(runtime: GameRuntime): string[] {
    const preset = WEREWOLF_PRESETS[runtime.seats.length];
    if (!preset) throw new Error(`No preset for ${runtime.seats.length} players`);

    const roles: string[] = [];
    for (const [roleName, count] of Object.entries(preset.roles)) {
      for (let i = 0; i < count; i++) {
        roles.push(roleName);
      }
    }
    return roles;
  }

  private shuffle(arr: string[]): void {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j]!, arr[i]!];
    }
  }
}
