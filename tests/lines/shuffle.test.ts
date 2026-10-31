import { describe, expect, it } from 'vitest';
import { drawFromBag, type Bag } from '../../src/lines/shuffle.js';

function seeded(seed = 42) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 2 ** 32;
    return s / 2 ** 32;
  };
}

describe('drawFromBag', () => {
  it('draws every id exactly once per cycle', () => {
    const pool = ['a', 'b', 'c', 'd', 'e', 'f'];
    const rng = seeded();
    let bag: Bag | null = null;
    const drawn: string[] = [];
    for (let i = 0; i < pool.length; i++) {
      const r = drawFromBag(bag, pool, rng);
      drawn.push(r.lineId);
      bag = r.bag;
    }
    expect([...drawn].sort()).toEqual(pool);
  });

  it('never repeats across a refill seam', () => {
    const pool = ['a', 'b', 'c', 'd', 'e'];
    const rng = seeded(7);
    let bag: Bag | null = null;
    let prev: string | null = null;
    for (let i = 0; i < pool.length * 50; i++) {
      const r = drawFromBag(bag, pool, rng);
      expect(r.lineId).not.toBe(prev);
      prev = r.lineId;
      bag = r.bag;
    }
  });

  it('skips ids removed from the pool', () => {
    const bag: Bag = { order: ['x', 'gone', 'y'], position: 1, lastDrawn: 'x' };
    expect(drawFromBag(bag, ['x', 'y'], seeded()).lineId).toBe('y');
  });

  it('refills from the current pool when all remaining ids are gone', () => {
    const bag: Bag = { order: ['x', 'gone1', 'gone2'], position: 1, lastDrawn: 'x' };
    const r = drawFromBag(bag, ['x', 'y', 'z'], seeded());
    expect(['y', 'z']).toContain(r.lineId);
    expect([...r.bag.order].sort()).toEqual(['x', 'y', 'z']);
  });

  it('adds new pool ids only after the next refill', () => {
    const bag: Bag = { order: ['a', 'b', 'c'], position: 1, lastDrawn: 'a' };
    const pool = ['a', 'b', 'c', 'new'];
    const r1 = drawFromBag(bag, pool, seeded());
    const r2 = drawFromBag(r1.bag, pool, seeded());
    expect([r1.lineId, r2.lineId]).toEqual(['b', 'c']);
    expect(drawFromBag(r2.bag, pool, seeded()).bag.order).toContain('new');
  });

  it('a pool of one always returns that id', () => {
    let bag: Bag | null = null;
    for (let i = 0; i < 3; i++) {
      const r = drawFromBag(bag, ['solo'], seeded());
      expect(r.lineId).toBe('solo');
      bag = r.bag;
    }
  });

  it('throws on an empty pool', () => {
    expect(() => drawFromBag(null, [], seeded())).toThrow();
  });
});
