import { describe, expect, it } from 'vitest';
import { linesFor, pickEmoji, type Library } from '../../src/lines/library.js';

const lib: Library = {
  version: 1,
  packs: [{ id: 'a', name: 'A', emoji: 'sparkles' }, { id: 'b', name: 'B', emoji: 'zap' }],
  emojiPools: { high: ['zap', 'rocket'], mid: ['coffee'], low: ['battery'], fallback: ['shrug'] },
  lines: [
    { id: 'a-high-1', pack: 'a', band: 'high', text: 'one' },
    { id: 'b-high-1', pack: 'b', band: 'high', text: 'two', emoji: 'egg' },
    { id: 'a-low-1', pack: 'a', band: 'low', text: 'three' },
  ],
};

describe('linesFor', () => {
  it('filters by band and enabled packs', () => {
    expect(linesFor(lib, 'high', ['a']).map((l) => l.id)).toEqual(['a-high-1']);
    expect(linesFor(lib, 'high', ['a', 'b']).map((l) => l.id)).toEqual(['a-high-1', 'b-high-1']);
  });
});

describe('pickEmoji', () => {
  it('uses the line fixed emoji when present', () => {
    expect(pickEmoji(lib.lines[1], lib, () => 0.99)).toBe('egg');
  });
  it('otherwise picks from the band pool using rng', () => {
    expect(pickEmoji(lib.lines[0], lib, () => 0)).toBe('zap');
    expect(pickEmoji(lib.lines[0], lib, () => 0.99)).toBe('rocket');
  });
});
