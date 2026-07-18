/**
 * F229 Phase E0: resolvePetSprite unit tests.
 *
 * Pure function — no React mount needed.
 * Tests projection + path resolution for all ConciergeBallState values.
 * R1 fix: skin-aware resolution (yarn-ball legacy compat + studio-mark-v1 projection).
 */

import { describe, expect, it } from 'vitest';
import { FALLBACK_SPRITE_PATH, resolvePetSprite } from '../usePetSkin';

describe('resolvePetSprite — studio-mark-v1 (projection)', () => {
  it('idle ballState → idle sprite', () => {
    expect(resolvePetSprite('idle', 'studio-mark-v1')).toBe('/concierge/skins/studio-mark-v1/idle.png');
  });

  it('thinking → running sprite (projection)', () => {
    expect(resolvePetSprite('thinking', 'studio-mark-v1')).toBe('/concierge/skins/studio-mark-v1/running.png');
  });

  it('found → review sprite', () => {
    expect(resolvePetSprite('found', 'studio-mark-v1')).toBe('/concierge/skins/studio-mark-v1/review.png');
  });

  it('error → failed sprite', () => {
    expect(resolvePetSprite('error', 'studio-mark-v1')).toBe('/concierge/skins/studio-mark-v1/failed.png');
  });

  it('sleeping → idle sprite (quiet fallback)', () => {
    expect(resolvePetSprite('sleeping', 'studio-mark-v1')).toBe('/concierge/skins/studio-mark-v1/idle.png');
  });

  it('listening → idle sprite (passive fallback)', () => {
    expect(resolvePetSprite('listening', 'studio-mark-v1')).toBe('/concierge/skins/studio-mark-v1/idle.png');
  });

  it('handoff → running sprite (transitioning)', () => {
    expect(resolvePetSprite('handoff', 'studio-mark-v1')).toBe('/concierge/skins/studio-mark-v1/running.png');
  });

  it('needs-confirmation → idle sprite (v0 defers waiting)', () => {
    expect(resolvePetSprite('needs-confirmation', 'studio-mark-v1')).toBe('/concierge/skins/studio-mark-v1/idle.png');
  });

  it('unknown state → idle sprite (fallback invariant)', () => {
    expect(resolvePetSprite('garbage', 'studio-mark-v1')).toBe('/concierge/skins/studio-mark-v1/idle.png');
  });

  it('defaults to studio-mark-v1 when skin omitted', () => {
    expect(resolvePetSprite('idle')).toBe('/concierge/skins/studio-mark-v1/idle.png');
  });
});

describe('resolvePetSprite — yarn-ball (legacy compat)', () => {
  it('idle → legacy direct path', () => {
    expect(resolvePetSprite('idle', 'yarn-ball')).toBe('/concierge/sprites/legacy-mark/idle.png');
  });

  it('thinking → thinking.png (no projection, direct state name)', () => {
    expect(resolvePetSprite('thinking', 'yarn-ball')).toBe('/concierge/sprites/legacy-mark/thinking.png');
  });

  it('found → found.png (direct)', () => {
    expect(resolvePetSprite('found', 'yarn-ball')).toBe('/concierge/sprites/legacy-mark/found.png');
  });

  it('error → error.png (direct)', () => {
    expect(resolvePetSprite('error', 'yarn-ball')).toBe('/concierge/sprites/legacy-mark/error.png');
  });

  it('sleeping → sleeping.png (direct)', () => {
    expect(resolvePetSprite('sleeping', 'yarn-ball')).toBe('/concierge/sprites/legacy-mark/sleeping.png');
  });

  it('handoff → handoff.png (direct)', () => {
    expect(resolvePetSprite('handoff', 'yarn-ball')).toBe('/concierge/sprites/legacy-mark/handoff.png');
  });

  it('needs-confirmation → confirm.png (legacy filename differs from ballState)', () => {
    // Legacy sprite is "confirm.png", not "needs-confirmation.png" — filename audit R2
    expect(resolvePetSprite('needs-confirmation', 'yarn-ball')).toBe('/concierge/sprites/legacy-mark/confirm.png');
  });

  it('unknown state → idle.png fallback', () => {
    expect(resolvePetSprite('garbage', 'yarn-ball')).toBe('/concierge/sprites/legacy-mark/idle.png');
  });
});

describe('FALLBACK_SPRITE_PATH', () => {
  it('points to idle.png in studio-mark-v1', () => {
    expect(FALLBACK_SPRITE_PATH).toBe('/concierge/skins/studio-mark-v1/idle.png');
  });
});
