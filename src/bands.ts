export type Tone = 'high' | 'mid' | 'low';

export type Band = { key: string; label: string; min: number; max: number; tone: Tone; emoji: string };

export const DEFAULT_BANDS: Band[] = [
  { key: 'low', label: 'Low', min: 0, max: 33, tone: 'low', emoji: 'battery' },
  { key: 'mid', label: 'Mid', min: 34, max: 66, tone: 'mid', emoji: 'melting_face' },
  { key: 'high', label: 'High', min: 67, max: 100, tone: 'high', emoji: 'sparkles' },
];

export const FALLBACK = { key: 'fallback', emoji: 'shrug' } as const;

export const MIN_BANDS = 2;
export const MAX_BANDS = 5;

export function normalizeEmoji(name: string): string {
  return name.trim().replace(/^:|:$/g, '').toLowerCase();
}

// Scores are rounded half-up before lookup, so 66.5 lands in the 67+ band.
export function findBand(bands: Band[], score: number): Band {
  const s = Math.min(100, Math.max(0, Math.round(score)));
  const band = bands.find((b) => s >= b.min && s <= b.max);
  if (!band) throw new Error(`no band covers score bucket`);
  return band;
}

export function validateBands(bands: Band[]): string[] {
  const errors: string[] = [];
  if (bands.length < MIN_BANDS || bands.length > MAX_BANDS) {
    errors.push(`You need between ${MIN_BANDS} and ${MAX_BANDS} bands.`);
  }
  const keys = new Set<string>();
  for (const b of bands) {
    if (keys.has(b.key)) errors.push(`Band "${b.key}" appears twice.`);
    keys.add(b.key);
    if (!Number.isInteger(b.min) || !Number.isInteger(b.max) || b.min > b.max) {
      errors.push(`Band "${b.label}" needs whole numbers with min ≤ max.`);
    }
    if (!/^[a-z0-9_+\-']+$/.test(normalizeEmoji(b.emoji))) {
      errors.push(`Band "${b.label}" has an invalid emoji name.`);
    }
  }
  const sorted = [...bands].sort((a, z) => a.min - z.min);
  if (sorted.length && sorted[0].min !== 0) errors.push('Bands must start at 0.');
  if (sorted.length && sorted[sorted.length - 1].max !== 100) errors.push('Bands must end at 100.');
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (cur.min > prev.max + 1) errors.push(`Gap between "${prev.label}" and "${cur.label}".`);
    if (cur.min <= prev.max) errors.push(`"${prev.label}" and "${cur.label}" overlap.`);
  }
  return errors;
}
