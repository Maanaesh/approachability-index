import type { Bag } from '../lines/shuffle.js';
import type { Queryable } from './pool.js';

export async function getBag(db: Queryable, id: string, bandKey: string): Promise<Bag | null> {
  const r = await db.query('SELECT line_order, position, last_drawn FROM shuffle_bags WHERE slack_user_id = $1 AND band_key = $2', [id, bandKey]);
  const row = r.rows[0];
  return row ? { order: row.line_order, position: row.position, lastDrawn: row.last_drawn } : null;
}

export async function saveBag(db: Queryable, id: string, bandKey: string, bag: Bag): Promise<void> {
  await db.query(
    `INSERT INTO shuffle_bags (slack_user_id, band_key, line_order, position, last_drawn) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (slack_user_id, band_key) DO UPDATE SET line_order = $3, position = $4, last_drawn = $5`,
    [id, bandKey, JSON.stringify(bag.order), bag.position, bag.lastDrawn],
  );
}
