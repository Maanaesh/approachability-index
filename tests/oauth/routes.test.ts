import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { testDb, testKey } from '../helpers/db.js';
import { testConfig } from '../helpers/config.js';
import { upsertUser } from '../../src/db/users.js';
import { getConnection } from '../../src/db/connections.js';
import { oauthRouter, signUserLink, verifyUserLink } from '../../src/oauth/routes.js';
import { whoopProvider } from '../../src/providers/whoop.js';
import { fakeFetch, json } from '../helpers/fetch.js';
import type { Config } from '../../src/config.js';

let db: { pool: pg.Pool; close: () => Promise<void> };
beforeAll(async () => { db = await testDb(); });
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.pool.query('TRUNCATE users CASCADE');
  await upsertUser(db.pool, { slackUserId: 'U1', teamId: 'T', tz: 'UTC' });
});

async function serve(cfg: Config, fetchFn = fakeFetch([])) {
  const backfill = vi.fn(async () => {});
  const app = express();
  const whoop = whoopProvider(cfg, fetchFn);
  const fitbit = { ...whoop, id: 'fitbit' as const, backfill };
  app.use(oauthRouter({ pool: db.pool, cfg, providers: { whoop, fitbit } }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, backfill, close: () => new Promise<void>((r) => server.close(() => r())) };
}

describe('signed user links', () => {
  it('round-trips and rejects tampering and expiry', () => {
    const now = new Date('2026-11-01T00:00:00Z');
    const t = signUserLink('U1', 'secret', now);
    expect(verifyUserLink(t, 'secret', now)).toBe('U1');
    expect(verifyUserLink(t.replace('U1', 'U2'), 'secret', now)).toBeNull();
    expect(verifyUserLink(t, 'other', now)).toBeNull();
    expect(verifyUserLink(t, 'secret', new Date(now.getTime() + 16 * 60_000))).toBeNull();
  });
});

describe('oauth routes', () => {
  it('start sets a state cookie and redirects to the provider', async () => {
    const s = await serve(testConfig());
    const res = await fetch(`${s.base}/oauth/whoop/start?u=${encodeURIComponent(signUserLink('U1', 'state'))}`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get('location')!);
    expect(loc.host).toBe('api.prod.whoop.com');
    expect(res.headers.get('set-cookie')).toContain(`oauth_state=${loc.searchParams.get('state')}`);
    await s.close();
  });

  it('start rejects an invalid user link', async () => {
    const s = await serve(testConfig());
    expect((await fetch(`${s.base}/oauth/whoop/start?u=nope`, { redirect: 'manual' })).status).toBe(400);
    await s.close();
  });

  it('fitbit start is 404 when FITBIT_ENABLED=false', async () => {
    const s = await serve(testConfig({ fitbitEnabled: false }));
    expect((await fetch(`${s.base}/oauth/fitbit/start?u=${encodeURIComponent(signUserLink('U1', 'state'))}`, { redirect: 'manual' })).status).toBe(404);
    await s.close();
  });

  it('callback with a mismatched state returns 400 and saves nothing', async () => {
    const s = await serve(testConfig());
    const u = signUserLink('U1', 'state');
    const res = await fetch(`${s.base}/oauth/whoop/callback?code=c&state=AAAAAAAA`, { headers: { cookie: `oauth_state=BBBBBBBB.${u}` } });
    expect(res.status).toBe(400);
    expect(await getConnection(db.pool, 'U1', testKey)).toBeNull();
    await s.close();
  });

  it('a valid callback saves the connection', async () => {
    const token = JSON.parse(readFileSync('tests/fixtures/whoop/token.json', 'utf8'));
    const s = await serve(testConfig(), fakeFetch([{ match: (u) => u.pathname === '/oauth/oauth2/token', respond: () => json(token) }]));
    const u = signUserLink('U1', 'state');
    const res = await fetch(`${s.base}/oauth/whoop/callback?code=c&state=ABCDEFGH`, { headers: { cookie: `oauth_state=ABCDEFGH.${encodeURIComponent(u)}` } });
    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/connected/i);
    expect(await getConnection(db.pool, 'U1', testKey)).toMatchObject({ provider: 'whoop', accessToken: 'new-access', reauthRequired: false });
    await s.close();
  });

  it('a valid fitbit callback triggers a backfill', async () => {
    const token = JSON.parse(readFileSync('tests/fixtures/whoop/token.json', 'utf8'));
    const s = await serve(testConfig(), fakeFetch([{ match: (u) => u.pathname === '/oauth/oauth2/token', respond: () => json(token) }]));
    const u = signUserLink('U1', 'state');
    await fetch(`${s.base}/oauth/fitbit/callback?code=c&state=ABCDEFGH`, { headers: { cookie: `oauth_state=ABCDEFGH.${encodeURIComponent(u)}` } });
    expect(s.backfill).toHaveBeenCalledWith('new-access', 'U1', 'UTC');
    expect((await getConnection(db.pool, 'U1', testKey))?.provider).toBe('fitbit');
    await s.close();
  });
});
