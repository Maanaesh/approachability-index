import type pg from 'pg';
import { lockConnection, markReauthRequired, saveConnection } from '../db/connections.js';
import { ReauthRequired, type Provider } from './types.js';

const REFRESH_SKEW_MS = 60_000;

// Refresh happens under a row lock: WHOOP rotates refresh tokens, so two
// concurrent refreshes would invalidate each other and lose the user's access.
export async function withFreshToken<T>(
  pool: pg.Pool,
  userId: string,
  provider: Provider,
  key: Buffer,
  fn: (accessToken: string) => Promise<T>,
): Promise<T | { reauth: true }> {
  const client = await pool.connect();
  let accessToken: string;
  try {
    await client.query('BEGIN');
    const conn = await lockConnection(client, userId, key);
    if (!conn) throw new Error('no provider connection');
    if (conn.reauthRequired) {
      await client.query('COMMIT');
      return { reauth: true };
    }
    accessToken = conn.accessToken;
    if (conn.expiresAt.getTime() < Date.now() + REFRESH_SKEW_MS) {
      try {
        const fresh = await provider.refresh(conn.refreshToken);
        await saveConnection(client, userId, { ...conn, ...fresh }, key);
        accessToken = fresh.accessToken;
      } catch (err) {
        if (!(err instanceof ReauthRequired)) throw err;
        await markReauthRequired(client, userId);
        await client.query('COMMIT');
        return { reauth: true };
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  try {
    return await fn(accessToken);
  } catch (err) {
    if (!(err instanceof ReauthRequired)) throw err;
    await markReauthRequired(pool, userId);
    return { reauth: true };
  }
}
