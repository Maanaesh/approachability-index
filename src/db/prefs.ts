import { DEFAULT_BANDS, type Band } from '../bands.js';
import type { Queryable } from './pool.js';

export type CustomLine = { id: string; bandKey: string; text: string };
export type Prefs = { bands: Band[]; packIds: string[]; customLines: CustomLine[] };

export async function getPrefs(db: Queryable, id: string, allPackIds: string[]): Promise<Prefs> {
  const [bands, packs, lines] = await Promise.all([
    db.query('SELECT config FROM bands WHERE slack_user_id = $1', [id]),
    db.query('SELECT pack_id FROM user_packs WHERE slack_user_id = $1 ORDER BY pack_id', [id]),
    db.query('SELECT id, band_key, text FROM custom_lines WHERE slack_user_id = $1 ORDER BY id', [id]),
  ]);
  return {
    bands: bands.rows[0]?.config ?? DEFAULT_BANDS,
    packIds: packs.rows.length ? packs.rows.map((r) => r.pack_id) : allPackIds,
    customLines: lines.rows.map((r) => ({ id: r.id, bandKey: r.band_key, text: r.text })),
  };
}

// Saving prefs invalidates every shuffle bag for the user; they rebuild on the next draw.
export async function savePrefs(db: Queryable, id: string, prefs: Prefs): Promise<void> {
  await db.query(
    `INSERT INTO bands (slack_user_id, config) VALUES ($1, $2)
     ON CONFLICT (slack_user_id) DO UPDATE SET config = $2`,
    [id, JSON.stringify(prefs.bands)],
  );
  await db.query('DELETE FROM user_packs WHERE slack_user_id = $1', [id]);
  for (const p of prefs.packIds) await db.query('INSERT INTO user_packs (slack_user_id, pack_id) VALUES ($1, $2)', [id, p]);
  await db.query('DELETE FROM custom_lines WHERE slack_user_id = $1', [id]);
  for (const l of prefs.customLines) {
    await db.query('INSERT INTO custom_lines (id, slack_user_id, band_key, text) VALUES ($1, $2, $3, $4)', [l.id, id, l.bandKey, l.text]);
  }
  await db.query('DELETE FROM shuffle_bags WHERE slack_user_id = $1', [id]);
}
