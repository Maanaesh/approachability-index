import { decrypt, encrypt } from '../crypto.js';
import type { SlackStatus } from '../status/decision.js';
import type { Queryable } from './pool.js';

export type User = {
  slackUserId: string;
  teamId: string;
  tz: string;
  paused: boolean;
  active: boolean;
  slackUserToken: string | null;
  lastSetStatus: SlackStatus | null;
  reconnectNotifiedAt: Date | null;
  tzCheckedAt: Date | null;
};

const SELECT = `
  SELECT u.*, t.token_enc FROM users u
  LEFT JOIN slack_tokens t USING (slack_user_id)`;

function toUser(r: any, key: Buffer): User {
  return {
    slackUserId: r.slack_user_id,
    teamId: r.team_id,
    tz: r.tz,
    paused: r.paused,
    active: r.active,
    slackUserToken: r.token_enc ? decrypt(r.token_enc, key) : null,
    lastSetStatus: r.last_set_emoji != null ? { emoji: r.last_set_emoji, text: r.last_set_text ?? '' } : null,
    reconnectNotifiedAt: r.reconnect_notified_at,
    tzCheckedAt: r.tz_checked_at,
  };
}

export async function upsertUser(db: Queryable, u: { slackUserId: string; teamId: string; tz: string }): Promise<void> {
  await db.query(
    `INSERT INTO users (slack_user_id, team_id, tz) VALUES ($1, $2, $3)
     ON CONFLICT (slack_user_id) DO UPDATE SET team_id = $2, tz = $3, active = true`,
    [u.slackUserId, u.teamId, u.tz],
  );
}

export async function getUser(db: Queryable, slackUserId: string, key: Buffer): Promise<User | null> {
  const r = await db.query(`${SELECT} WHERE u.slack_user_id = $1`, [slackUserId]);
  return r.rows[0] ? toUser(r.rows[0], key) : null;
}

export async function listSchedulable(db: Queryable, key: Buffer): Promise<User[]> {
  const r = await db.query(
    `${SELECT} JOIN provider_connections c USING (slack_user_id)
     WHERE u.active AND NOT u.paused AND t.token_enc IS NOT NULL
     ORDER BY u.slack_user_id`,
  );
  return r.rows.map((row) => toUser(row, key));
}

export async function setPaused(db: Queryable, id: string, paused: boolean): Promise<void> {
  await db.query('UPDATE users SET paused = $2 WHERE slack_user_id = $1', [id, paused]);
}

export async function setInactive(db: Queryable, id: string): Promise<void> {
  await db.query('UPDATE users SET active = false WHERE slack_user_id = $1', [id]);
}

export async function setSlackToken(db: Queryable, id: string, token: string, key: Buffer): Promise<void> {
  await db.query(
    `INSERT INTO slack_tokens (slack_user_id, token_enc) VALUES ($1, $2)
     ON CONFLICT (slack_user_id) DO UPDATE SET token_enc = $2`,
    [id, encrypt(token, key)],
  );
}

export async function clearSlackToken(db: Queryable, id: string): Promise<void> {
  await db.query('DELETE FROM slack_tokens WHERE slack_user_id = $1', [id]);
}

// tz is null when the lookup failed: keep the old value but still record the check.
export async function setTzChecked(db: Queryable, id: string, tz: string | null, at: Date): Promise<void> {
  await db.query('UPDATE users SET tz = COALESCE($2, tz), tz_checked_at = $3 WHERE slack_user_id = $1', [id, tz, at]);
}

export async function setLastSetStatus(db: Queryable, id: string, s: SlackStatus | null): Promise<void> {
  await db.query('UPDATE users SET last_set_emoji = $2, last_set_text = $3 WHERE slack_user_id = $1', [id, s?.emoji ?? null, s?.text ?? null]);
}

export async function setReconnectNotified(db: Queryable, id: string, at: Date | null): Promise<void> {
  await db.query('UPDATE users SET reconnect_notified_at = $2 WHERE slack_user_id = $1', [id, at]);
}

export async function deleteUserCascade(db: Queryable, id: string): Promise<void> {
  await db.query('DELETE FROM users WHERE slack_user_id = $1', [id]);
}
