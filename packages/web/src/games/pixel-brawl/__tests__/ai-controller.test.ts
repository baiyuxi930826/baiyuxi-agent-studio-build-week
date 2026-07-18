import { describe, expect, it } from 'vitest';
import { AiController } from '../ai-controller';
import { GameState } from '../game-state';
import { createRng } from '../rng';
import { FIGHTER_STATS, SKILLS } from '../types';

describe('AiController', () => {
  it('deterministic: same seed produces same action sequence', () => {
    const gs1 = new GameState(['opus46', 'codex']);
    const gs2 = new GameState(['opus46', 'codex']);
    const ai1 = new AiController('codex', createRng(42));
    const ai2 = new AiController('codex', createRng(42));

    const actions1 = Array.from({ length: 20 }, () => ai1.decide(gs1));
    const actions2 = Array.from({ length: 20 }, () => ai2.decide(gs2));
    expect(actions1).toEqual(actions2);
  });

  it('returns a valid action', () => {
    const gs = new GameState(['opus46', 'codex']);
    const ai = new AiController('codex', createRng(1));
    const action = ai.decide(gs);
    expect(['idle', 'move_left', 'move_right', 'attack', 'skill']).toContain(action);
  });

  it('prefers attack when in range', () => {
    const gs = new GameState(['opus46', 'codex']);
    gs.p1.x = 200;
    gs.p2.x = 230; // close range
    const ai = new AiController('codex', createRng(1));
    // Run 50 decisions — at least some should be 'attack'
    const actions = Array.from({ length: 50 }, () => ai.decide(gs));
    expect(actions.filter((a) => a === 'attack').length).toBeGreaterThan(10);
  });

  it('uses skill when off cooldown and in skill range', () => {
    const gs = new GameState(['opus46', 'codex']);
    const skillRange = SKILLS[FIGHTER_STATS.opus46.skillId].range;
    gs.p2.x = gs.p1.x + skillRange - 10; // within skill range
    gs.p1.skillCooldownMs = 0;

    const ai = new AiController('opus46', createRng(42));
    let gotSkill = false;
    for (let i = 0; i < 200; i++) {
      const action = ai.decide(gs);
      if (action === 'skill') {
        gotSkill = true;
        break;
      }
    }
    expect(gotSkill).toBe(true);
  });

  it('never uses skill when on cooldown', () => {
    const gs = new GameState(['opus46', 'codex']);
    gs.p2.x = gs.p1.x + 50;
    gs.p1.skillCooldownMs = 5000; // on cooldown

    const ai = new AiController('opus46', createRng(42));
    const actions = Array.from({ length: 100 }, () => ai.decide(gs));
    expect(actions.filter((a) => a === 'skill')).toHaveLength(0);
  });
});
