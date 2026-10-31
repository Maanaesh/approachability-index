import type { Queryable } from './pool.js';

export type RunOutcome = 'set' | 'skipped_manual' | 'fallback' | 'error';
export type Run = { lastAttemptAt: Date | null; outcome: RunOutcome | null };

export async function getRun(db: Queryable, id: string, localDate: string): Promise<Run | null> {
  const r = await db.query('SELECT last_attempt_at, outcome FROM daily_runs WHERE slack_user_id = $1 AND local_date = $2', [id, localDate]);
  return r.rows[0] ? { lastAttemptAt: r.rows[0].last_attempt_at, outcome: r.rows[0].outcome } : null;
}

export async function recordAttempt(db: Queryable, id: string, localDate: string, at: Date): Promise<void> {
  await db.query(
    `INSERT INTO daily_runs (slack_user_id, local_date, last_attempt_at) VALUES ($1, $2, $3)
     ON CONFLICT (slack_user_id, local_date) DO UPDATE SET last_attempt_at = $3`,
    [id, localDate, at],
  );
}

export async function finishRun(db: Queryable, id: string, localDate: string, outcome: RunOutcome, bandKey: string | null): Promise<void> {
  await db.query(
    `INSERT INTO daily_runs (slack_user_id, local_date, outcome, band_key) VALUES ($1, $2, $3, $4)
     ON CONFLICT (slack_user_id, local_date) DO UPDATE SET outcome = $3, band_key = $4`,
    [id, localDate, outcome, bandKey],
  );
}
