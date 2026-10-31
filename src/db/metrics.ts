import type { DailyMetrics } from '../score/fitbit.js';
import type { Queryable } from './pool.js';

export async function upsertMetrics(db: Queryable, id: string, rows: DailyMetrics[]): Promise<void> {
  for (const m of rows) {
    await db.query(
      `INSERT INTO fitbit_metrics (slack_user_id, date, hrv_ms, rhr_bpm, minutes_asleep) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (slack_user_id, date) DO UPDATE SET hrv_ms = COALESCE($3, fitbit_metrics.hrv_ms),
         rhr_bpm = COALESCE($4, fitbit_metrics.rhr_bpm), minutes_asleep = COALESCE($5, fitbit_metrics.minutes_asleep)`,
      [id, m.date, m.hrvMs, m.rhrBpm, m.minutesAsleep],
    );
  }
}

export async function getMetrics(db: Queryable, id: string, fromDate: string, toDate: string): Promise<DailyMetrics[]> {
  const r = await db.query(
    'SELECT date, hrv_ms, rhr_bpm, minutes_asleep FROM fitbit_metrics WHERE slack_user_id = $1 AND date BETWEEN $2 AND $3 ORDER BY date',
    [id, fromDate, toDate],
  );
  return r.rows.map((row) => ({ date: row.date, hrvMs: row.hrv_ms, rhrBpm: row.rhr_bpm, minutesAsleep: row.minutes_asleep }));
}

export async function pruneMetrics(db: Queryable, before: string): Promise<void> {
  await db.query('DELETE FROM fitbit_metrics WHERE date < $1', [before]);
}
