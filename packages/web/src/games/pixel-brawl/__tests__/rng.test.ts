import { describe, expect, it } from 'vitest';
import { createRng } from '../rng';

describe('createRng', () => {
  it('produces deterministic sequence from same seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 10 }, () => a.random());
    const seqB = Array.from({ length: 10 }, () => b.random());
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences from different seeds', () => {
    const a = createRng(42);
    const b = createRng(99);
    const seqA = Array.from({ length: 5 }, () => a.random());
    const seqB = Array.from({ length: 5 }, () => b.random());
    expect(seqA).not.toEqual(seqB);
  });

  it('int() returns values in range', () => {
    const rng = createRng(123);
    for (let i = 0; i < 100; i++) {
      const v = rng.int(1, 6);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
    }
  });

  it('pick() returns element from array', () => {
    const rng = createRng(7);
    const arr = ['a', 'b', 'c'] as const;
    for (let i = 0; i < 20; i++) {
      expect(arr).toContain(rng.pick(arr));
    }
  });
});
