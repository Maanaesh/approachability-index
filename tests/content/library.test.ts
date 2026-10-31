import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { loadLibrary, type LineBand } from '../../src/lines/library.js';

const require = createRequire(import.meta.url);
const validEmoji = new Set<string>(
  (require('emoji-datasource/emoji.json') as { short_names: string[] }[]).flatMap((e) => e.short_names),
);
const lib = loadLibrary();
const blocklist = readFileSync('content/blocklist.txt', 'utf8')
  .split('\n').map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith('#'));
const BANDS: LineBand[] = ['high', 'mid', 'low', 'fallback'];

const normalize = (t: string) => t.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
const tokens = (t: string) => new Set(normalize(t).split(' ').filter(Boolean));
function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

describe('status line library content rules', () => {
  it('every line is ≤100 chars with no digits or %', () => {
    const bad = lib.lines.filter((l) => l.text.length > 100 || /[0-9%]/.test(l.text));
    expect(bad.map((l) => l.id)).toEqual([]);
  });

  it('no line contains a blocklisted word', () => {
    const bad = lib.lines.filter((l) => {
      const words = tokens(l.text);
      return blocklist.some((w) => (w.includes(' ') ? normalize(l.text).includes(w) : words.has(w)));
    });
    expect(bad.map((l) => `${l.id}: ${l.text}`)).toEqual([]);
  });

  it('ids are unique', () => {
    const ids = lib.lines.map((l) => l.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it('has no near-duplicate lines', () => {
    const toks = lib.lines.map((l) => ({ id: l.id, n: normalize(l.text), t: tokens(l.text) }));
    const dups: string[] = [];
    for (let i = 0; i < toks.length; i++) {
      for (let j = i + 1; j < toks.length; j++) {
        if (toks[i].n === toks[j].n || jaccard(toks[i].t, toks[j].t) >= 0.8) dups.push(`${toks[i].id}~${toks[j].id}`);
      }
    }
    expect(dups).toEqual([]);
  });

  it('every pack covers every band and the fallback', () => {
    const missing = lib.packs.flatMap((p) =>
      BANDS.filter((b) => !lib.lines.some((l) => l.pack === p.id && l.band === b)).map((b) => `${p.id}/${b}`),
    );
    expect(missing).toEqual([]);
  });

  it('every line pack exists', () => {
    const packIds = new Set(lib.packs.map((p) => p.id));
    expect(lib.lines.filter((l) => !packIds.has(l.pack)).map((l) => l.id)).toEqual([]);
  });

  it('all emojis are valid Slack short names', () => {
    const used = [...lib.lines.flatMap((l) => (l.emoji ? [l.emoji] : [])), ...Object.values(lib.emojiPools).flat(), ...lib.packs.map((p) => p.emoji)];
    expect(used.filter((e) => !validEmoji.has(e))).toEqual([]);
  });

  it('each emoji pool has 8–12 entries', () => {
    for (const b of BANDS) {
      expect(lib.emojiPools[b].length).toBeGreaterThanOrEqual(8);
      expect(lib.emojiPools[b].length).toBeLessThanOrEqual(12);
    }
  });

  it.runIf(process.env.LIBRARY_FULL)('full library size: ≥1000 total, ≥300 per tone, ≥100 fallback', () => {
    const count = (b: LineBand) => lib.lines.filter((l) => l.band === b).length;
    expect(lib.lines.length).toBeGreaterThanOrEqual(1000);
    for (const b of ['high', 'mid', 'low'] as const) expect(count(b)).toBeGreaterThanOrEqual(300);
    expect(count('fallback')).toBeGreaterThanOrEqual(100);
  });
});
