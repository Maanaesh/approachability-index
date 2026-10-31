import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { Tone } from '../bands.js';

export type LineBand = Tone | 'fallback';
export type StatusLine = { id: string; pack: string; band: LineBand; text: string; emoji?: string };
export type Library = {
  version: number;
  packs: { id: string; name: string; emoji: string }[];
  emojiPools: Record<LineBand, string[]>;
  lines: StatusLine[];
};

const band = z.enum(['high', 'mid', 'low', 'fallback']);
const schema = z.object({
  version: z.number().int(),
  packs: z.array(z.object({ id: z.string(), name: z.string(), emoji: z.string() })),
  emojiPools: z.object({ high: z.array(z.string()), mid: z.array(z.string()), low: z.array(z.string()), fallback: z.array(z.string()) }),
  lines: z.array(z.object({ id: z.string(), pack: z.string(), band, text: z.string().min(1).max(100), emoji: z.string().optional() })),
});

const cache = new Map<string, Library>();

export function loadLibrary(path = join(process.cwd(), 'content', 'status-lines.json')): Library {
  let lib = cache.get(path);
  if (!lib) {
    lib = schema.parse(JSON.parse(readFileSync(path, 'utf8')));
    cache.set(path, lib);
  }
  return lib;
}

export function linesFor(lib: Library, band: LineBand, packIds: string[]): StatusLine[] {
  const packs = new Set(packIds);
  return lib.lines.filter((l) => l.band === band && packs.has(l.pack));
}

export function pickEmoji(line: StatusLine, lib: Library, rng: () => number): string {
  if (line.emoji) return line.emoji;
  const pool = lib.emojiPools[line.band];
  return pool[Math.floor(rng() * pool.length)];
}
