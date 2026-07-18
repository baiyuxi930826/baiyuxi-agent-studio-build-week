import {
  ATTACK_RANGE,
  FIGHTER_NAMES,
  FIGHTER_STATS,
  type Fighter,
  type FighterId,
  GROUND_Y,
  type HitResult,
  KNOCKBACK_FORCE,
  SKILLS,
  TEAM_COLORS,
} from './types';

/** Scale HP by fighter count — more opponents = more incoming damage */
function hpForCount(count: number): number {
  // 2 fighters: 100 HP, 4 fighters: 400 HP
  if (count <= 2) return 100;
  return count * 100;
}

function createFighter(id: FighterId, x: number, facing: 'left' | 'right', totalFighters: number): Fighter {
  const hp = hpForCount(totalFighters);
  return {
    id,
    name: FIGHTER_NAMES[id],
    teamColor: TEAM_COLORS[id],
    hp,
    maxHp: hp,
    x,
    y: GROUND_Y,
    facing,
    state: 'idle',
    attackCooldownMs: 0,
    hitLanded: false,
    skillCooldownMs: 0,
    skillActiveMs: 0,
    stunMs: 0,
  };
}

/** Spread N fighters evenly across the arena */
function spawnPositions(count: number): number[] {
  const margin = 120;
  const span = 640 - 2 * margin;
  if (count === 1) return [320];
  return Array.from({ length: count }, (_, i) => Math.round(margin + (span * i) / (count - 1)));
}

export class GameState {
  fighters: Fighter[];

  constructor(fighterIds: FighterId[]) {
    const positions = spawnPositions(fighterIds.length);
    this.fighters = fighterIds.map((id, i) =>
      createFighter(id, positions[i], i < fighterIds.length / 2 ? 'right' : 'left', fighterIds.length),
    );
  }

  /** Backward compat alias */
  get p1(): Fighter {
    return this.fighters[0];
  }
  /** Backward compat alias */
  get p2(): Fighter {
    return this.fighters[1];
  }

  getFighter(id: FighterId): Fighter {
    const f = this.fighters.find((f) => f.id === id);
    if (!f) throw new Error(`Fighter ${id} not found`);
    return f;
  }

  /** Returns the nearest living opponent */
  getOpponent(id: FighterId): Fighter {
    const me = this.getFighter(id);
    let nearest: Fighter | null = null;
    let bestDist = Infinity;
    for (const f of this.fighters) {
      if (f.id === id || f.hp <= 0) continue;
      const d = Math.abs(f.x - me.x);
      if (d < bestDist) {
        bestDist = d;
        nearest = f;
      }
    }
    // Fallback: if all others dead, return first non-self
    if (!nearest) {
      nearest = this.fighters.find((f) => f.id !== id) ?? me;
    }
    return nearest;
  }

  applyDamage(targetId: FighterId, damage: number): void {
    const target = this.getFighter(targetId);
    target.hp = Math.max(0, target.hp - damage);
  }

  isOver(): boolean {
    const alive = this.fighters.filter((f) => f.hp > 0);
    return alive.length <= 1;
  }

  winner(): FighterId | null {
    const alive = this.fighters.filter((f) => f.hp > 0);
    if (alive.length === 1) return alive[0].id;
    return null;
  }

  checkHit(attackerId: FighterId): HitResult | null {
    const attacker = this.getFighter(attackerId);
    const defender = this.getOpponent(attackerId);

    if (attacker.state !== 'attack') return null;
    if (attacker.hitLanded) return null;

    const distance = Math.abs(attacker.x - defender.x);
    if (distance > ATTACK_RANGE) return null;

    return {
      attackerId,
      defenderId: defender.id,
      damage: FIGHTER_STATS[attackerId].attackDamage,
      knockback: KNOCKBACK_FORCE,
    };
  }

  /** Mark current swing as having landed — prevents multi-hit */
  consumeHit(attackerId: FighterId): void {
    this.getFighter(attackerId).hitLanded = true;
  }

  /** Reset swing flag for a new attack */
  resetSwing(attackerId: FighterId): void {
    this.getFighter(attackerId).hitLanded = false;
  }

  // --- Skill System ---

  /** Activate fighter's unique skill. Returns true if activated. */
  activateSkill(id: FighterId): boolean {
    const fighter = this.getFighter(id);
    if (fighter.skillCooldownMs > 0 || fighter.stunMs > 0) return false;
    const skill = SKILLS[FIGHTER_STATS[id].skillId];
    fighter.skillCooldownMs = skill.cooldownMs;
    fighter.skillActiveMs = skill.durationMs;
    fighter.state = 'skill';
    return true;
  }

  /** Check if skill hits nearest opponent */
  checkSkillHit(attackerId: FighterId): HitResult | null {
    const attacker = this.getFighter(attackerId);
    if (attacker.skillActiveMs <= 0 && attacker.state !== 'skill') return null;
    const skill = SKILLS[FIGHTER_STATS[attackerId].skillId];
    const defender = this.getOpponent(attackerId);
    const distance = Math.abs(attacker.x - defender.x);
    if (distance > skill.range) return null;
    return {
      attackerId,
      defenderId: defender.id,
      damage: skill.damage,
      knockback: KNOCKBACK_FORCE,
    };
  }

  /** Apply skill-specific effect to target */
  applySkillEffect(attackerId: FighterId, defenderId: FighterId): void {
    const skillId = FIGHTER_STATS[attackerId].skillId;
    const skill = SKILLS[skillId];
    const defender = this.getFighter(defenderId);
    const attacker = this.getFighter(attackerId);

    this.applyDamage(defenderId, skill.damage);

    switch (skillId) {
      case 'architecture_lock':
        // Stun target for skill duration
        defender.stunMs = skill.durationMs;
        break;
      case 'logic_threads':
        // DoT effect — damage already applied, stun briefly
        defender.stunMs = Math.round(skill.durationMs * 0.3);
        break;
      case 'code_flood': {
        // Knockback push
        const dir = defender.x > attacker.x ? 1 : -1;
        defender.x = Math.max(24, Math.min(616, defender.x + dir * 60));
        break;
      }
      case 'golden_review':
        // Heavy damage + brief stun
        defender.stunMs = skill.durationMs;
        break;
    }
  }

  /** Reduce all cooldown/stun timers by deltaMs */
  tickCooldowns(deltaMs: number): void {
    for (const f of this.fighters) {
      f.skillCooldownMs = Math.max(0, f.skillCooldownMs - deltaMs);
      f.skillActiveMs = Math.max(0, f.skillActiveMs - deltaMs);
      f.stunMs = Math.max(0, f.stunMs - deltaMs);
    }
  }
}
