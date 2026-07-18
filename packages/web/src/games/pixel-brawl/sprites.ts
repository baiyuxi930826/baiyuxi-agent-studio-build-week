import type { FighterId } from './types';

export interface SpriteConfig {
  key: string;
  path: string;
  frameWidth: number;
  frameHeight: number;
  animations: Record<string, { start: number; end: number; frameRate: number; repeat: number }>;
}

/**
 * Sprite configs per fighter.
 * null = use colored rectangle placeholder (current state).
 * When CUTE LEGENDS sprites are on disk, update paths here.
 */
export const SPRITE_CONFIGS: Record<FighterId, SpriteConfig | null> = {
  opus46: null,
  opus45: null,
  codex: null,
  gpt54: null,
};
