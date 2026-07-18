/**
 * WerewolfAIPlayer (F101 Task B5)
 *
 * Bridges game engine and LLM: receives scoped GameView,
 * builds role-specific prompt, calls LLM provider for structured output.
 */

import type { GameAction, GameView } from '@agent-studio/shared';
import { buildWerewolfPrompt } from './werewolf-prompts.js';

export interface AIActionResponse {
  actionName: string;
  targetSeat?: string;
}

export interface AIProvider {
  generateAction(prompt: string, schema: Record<string, unknown>): Promise<AIActionResponse>;
  generateSpeech(prompt: string): Promise<string>;
}

export class WerewolfAIPlayer {
  private provider: AIProvider;

  constructor(provider: AIProvider) {
    this.provider = provider;
  }

  async decideNightAction(seatId: string, role: string, view: GameView, round: number): Promise<GameAction> {
    const prompt = buildWerewolfPrompt(role, view, round);
    const actionPrompt = `${prompt}\n\nChoose your night action. Return a JSON with actionName and targetSeat.`;

    const response = await this.provider.generateAction(actionPrompt, {
      type: 'object',
      properties: {
        actionName: { type: 'string' },
        targetSeat: { type: 'string' },
      },
      required: ['actionName', 'targetSeat'],
    });

    const action: GameAction = {
      seatId: seatId as `P${number}`,
      actionName: response.actionName,
      submittedAt: Date.now(),
    };
    if (response.targetSeat) {
      action.targetSeat = response.targetSeat as `P${number}`;
    }
    return action;
  }

  async decideSpeech(seatId: string, role: string, view: GameView, round: number): Promise<string> {
    const prompt = buildWerewolfPrompt(role, view, round);
    const speechPrompt = `${prompt}\n\nIt is the discussion phase. Give a brief speech (1-3 sentences) as ${seatId}.`;

    return this.provider.generateSpeech(speechPrompt);
  }

  async decideSpeechWithFormat(
    seatId: string,
    role: string,
    view: GameView,
    round: number,
    voiceMode: boolean,
  ): Promise<{ kind: 'audio' | 'text'; text: string; seatId: string }> {
    const text = await this.decideSpeech(seatId, role, view, round);
    return { kind: voiceMode ? 'audio' : 'text', text, seatId };
  }

  async decideVote(seatId: string, role: string, view: GameView, round: number): Promise<GameAction> {
    const prompt = buildWerewolfPrompt(role, view, round);
    const votePrompt = `${prompt}\n\nChoose who to vote for exile. Return a JSON with actionName "vote" and targetSeat.`;

    const response = await this.provider.generateAction(votePrompt, {
      type: 'object',
      properties: {
        actionName: { type: 'string', const: 'vote' },
        targetSeat: { type: 'string' },
      },
      required: ['actionName', 'targetSeat'],
    });

    const action: GameAction = {
      seatId: seatId as `P${number}`,
      actionName: response.actionName,
      submittedAt: Date.now(),
    };
    if (response.targetSeat) {
      action.targetSeat = response.targetSeat as `P${number}`;
    }
    return action;
  }
}
