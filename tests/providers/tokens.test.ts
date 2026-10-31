import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { testDb, testKey } from '../helpers/db.js';
import { upsertUser } from '../../src/db/users.js';
import { getConnection, saveConnection } from '../../src/db/connections.js';
import { withFreshToken } from '../../src/providers/tokens.js';
import { ReauthRequired, type Provider } from '../../src/providers/types.js';

let db: { pool: pg.Pool; close: () => Promise<void> };
const U = 'U1';

function provider(refresh: Provider['refresh']): Provider {
  return { id: 'whoop', authUrl: () => '', exchangeCode: vi.fn(), refresh, getTodayScore: vi.fn() };
}

beforeAll(async () => { db = await testDb(); });
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.pool.query('TRUNCATE users CASCADE');
  await upsertUser(db.pool, { slackUserId: U, teamId: 'T', tz: 'UTC' });
  await saveConnection(db.pool, U, {
    provider: 'whoop', accessToken: 'old-access', refreshToken: 'old-refresh',
    expiresAt: new Date(Date.now() - 1000), issuedAt: new Date('2026-10-01T00:00:00Z'), reauthRequired: false,
  }, testKey);
});

describe('withFreshToken', () => {
  it('refreshes an expired token once and saves both new tokens', async () => {
    const refresh = vi.fn(async () => ({ accessToken: 'new-access', refreshToken: 'new-refresh', expiresAt: new Date(Date.now() + 3600_000) }));
    const result = await withFreshToken(db.pool, U, provider(refresh), testKey, async (t) => t);
    expect(result).toBe('new-access');
    expect(refresh).toHaveBeenCalledWith('old-refresh');
    expect(await getConnection(db.pool, U, testKey)).toMatchObject({ accessToken: 'new-access', refreshToken: 'new-refresh', issuedAt: new Date('2026-10-01T00:00:00Z') });
  });

  it('two concurrent calls refresh only once', async () => {
    const refresh = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 100));
      return { accessToken: 'new-access', refreshToken: 'new-refresh', expiresAt: new Date(Date.now() + 3600_000) };
    });
    const p = provider(refresh);
    const [a, b] = await Promise.all([
      withFreshToken(db.pool, U, p, testKey, async (t) => t),
      withFreshToken(db.pool, U, p, testKey, async (t) => t),
    ]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect([a, b]).toEqual(['new-access', 'new-access']);
  });

  it('marks reauth when refresh is rejected', async () => {
    const refresh = vi.fn(async () => { throw new ReauthRequired('invalid_grant'); });
    expect(await withFreshToken(db.pool, U, provider(refresh), testKey, async (t) => t)).toEqual({ reauth: true });
    expect((await getConnection(db.pool, U, testKey))?.reauthRequired).toBe(true);
  });

  it('marks reauth when the API call itself returns ReauthRequired', async () => {
    await saveConnection(db.pool, U, { provider: 'whoop', accessToken: 'a', refreshToken: 'r', expiresAt: new Date(Date.now() + 3600_000), issuedAt: new Date(), reauthRequired: false }, testKey);
    const res = await withFreshToken(db.pool, U, provider(vi.fn()), testKey, async () => { throw new ReauthRequired('401'); });
    expect(res).toEqual({ reauth: true });
    expect((await getConnection(db.pool, U, testKey))?.reauthRequired).toBe(true);
  });

  it('does not call the provider when reauth is already required', async () => {
    await db.pool.query('UPDATE provider_connections SET reauth_required = true');
    const fn = vi.fn();
    expect(await withFreshToken(db.pool, U, provider(vi.fn()), testKey, fn)).toEqual({ reauth: true });
    expect(fn).not.toHaveBeenCalled();
  });
});
