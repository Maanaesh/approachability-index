import { describe, expect, it } from 'vitest';
import { DEFAULT_BANDS, findBand, normalizeEmoji, validateBands, type Band } from '../src/bands.js';

const b = (key: string, min: number, max: number, extra: Partial<Band> = {}): Band => ({
  key, label: key, min, max, tone: 'mid', emoji: 'sparkles', ...extra,
});

describe('findBand', () => {
  it.each([
    [0, 'low'], [33, 'low'], [34, 'mid'], [66, 'mid'], [66.5, 'high'], [67, 'high'], [100, 'high'],
  ])('score %s → %s', (score, key) => {
    expect(findBand(DEFAULT_BANDS, score).key).toBe(key);
  });
});

describe('validateBands', () => {
  it('accepts the defaults', () => {
    expect(validateBands(DEFAULT_BANDS)).toEqual([]);
  });
  it('rejects a single band', () => {
    expect(validateBands([b('a', 0, 100)])).not.toEqual([]);
  });
  it('rejects six bands', () => {
    const six = [0, 17, 34, 51, 68, 85].map((min, i, arr) => b(`b${i}`, min, i === 5 ? 100 : arr[i + 1] - 1));
    expect(validateBands(six)).not.toEqual([]);
  });
  it('rejects a gap', () => {
    expect(validateBands([b('a', 0, 33), b('c', 35, 100)])).not.toEqual([]);
  });
  it('rejects an overlap', () => {
    expect(validateBands([b('a', 0, 40), b('c', 35, 100)])).not.toEqual([]);
  });
  it('rejects coverage not starting at 0', () => {
    expect(validateBands([b('a', 1, 50), b('c', 51, 100)])).not.toEqual([]);
  });
  it('rejects coverage not ending at 100', () => {
    expect(validateBands([b('a', 0, 50), b('c', 51, 99)])).not.toEqual([]);
  });
  it('rejects duplicate keys', () => {
    expect(validateBands([b('a', 0, 50), b('a', 51, 100)])).not.toEqual([]);
  });
  it('rejects an emoji name with spaces', () => {
    expect(validateBands([b('a', 0, 50, { emoji: 'big smile' }), b('c', 51, 100)])).not.toEqual([]);
  });
});

describe('normalizeEmoji', () => {
  it('strips colons and lowercases', () => {
    expect(normalizeEmoji(':Sparkles:')).toBe('sparkles');
  });
});
