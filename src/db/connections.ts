import { decrypt, encrypt } from '../crypto.js';
import type { Queryable } from './pool.js';

export type Connection = {
  provider: 'whoop' | 'fitbit';
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  issuedAt: Date;
  reauthRequired: boolean;
};

function toConnection(r: any, key: Buffer): Connection {
  return {
    provider: r.provider,
    accessToken: decrypt(r.access_token_enc, key),
    refreshToken: decrypt(r.refresh_token_enc, key),
    expiresAt: r.expires_at,
    issuedAt: r.issued_at,
    reauthRequired: r.reauth_required,
  };
}

export async function getConnection(db: Queryable, id: string, key: Buffer): Promise<Connection | null> {
  const r = await db.query('SELECT * FROM provider_connections WHERE slack_user_id = $1', [id]);
  return r.rows[0] ? toConnection(r.rows[0], key) : null;
}

// Call inside a transaction; holds the row until COMMIT so refreshes are single-flight.
export async function lockConnection(client: Queryable, id: string, key: Buffer): Promise<Connection | null> {
  const r = await client.query('SELECT * FROM provider_connections WHERE slack_user_id = $1 FOR UPDATE', [id]);
  return r.rows[0] ? toConnection(r.rows[0], key) : null;
}

export async function saveConnection(db: Queryable, id: string, c: Connection, key: Buffer): Promise<void> {
  await db.query(
    `INSERT INTO provider_connections (slack_user_id, provider, access_token_enc, refresh_token_enc, expires_at, issued_at, reauth_required)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (slack_user_id) DO UPDATE SET provider = $2, access_token_enc = $3, refresh_token_enc = $4,
       expires_at = $5, issued_at = $6, reauth_required = $7`,
    [id, c.provider, encrypt(c.accessToken, key), encrypt(c.refreshToken, key), c.expiresAt, c.issuedAt, c.reauthRequired],
  );
}

export async function markReauthRequired(db: Queryable, id: string): Promise<void> {
  await db.query('UPDATE provider_connections SET reauth_required = true WHERE slack_user_id = $1', [id]);
}
