import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { testDb, testKey } from '../helpers/db.js';
import { deleteUserCascade, getUser, listSchedulable, setInactive, setLastSetStatus, setPaused, setReconnectNotified, setSlackToken, upsertUser } from '../../src/db/users.js';
import { getConnection, lockConnection, markReauthRequired, saveConnection } from '../../src/db/connections.js';
import { getPrefs, savePrefs } from '../../src/db/prefs.js';
import { getBag, saveBag } from '../../src/db/bags.js';
import { finishRun, getRun, recordAttempt } from '../../src/db/runs.js';
import { getMetrics, pruneMetrics, upsertMetrics } from '../../src/db/metrics.js';
import { DEFAULT_BANDS } from '../../src/bands.js';

let db: { pool: pg.Pool; close: () => Promise<void> };
const U = 'U1';
const conn = (provider: 'whoop' | 'fitbit' = 'whoop') => ({
  provider, accessToken: 'access-secret', refreshToken: 'refresh-secret',
  expiresAt: new Date('2026-11-01T12:00:00Z'), issuedAt: new Date('2026-11-01T11:00:00Z'), reauthRequired: false,
});

beforeAll(async () => { db = await testDb(); });
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.pool.query('TRUNCATE users CASCADE');
  await upsertUser(db.pool, { slackUserId: U, teamId: 'T1', tz: 'Asia/Kolkata' });
});

describe('users', () => {
  it('round-trips a user with a decrypted Slack token', async () => {
    expect((await getUser(db.pool, U, testKey))?.slackUserToken).toBeNull();
    await setSlackToken(db.pool, U, 'xoxp-secret', testKey);
    await setLastSetStatus(db.pool, U, { emoji: 'sparkles', text: 'hi' });
    await setReconnectNotified(db.pool, U, new Date('2026-11-01T00:00:00Z'));
    const u = await getUser(db.pool, U, testKey);
    expect(u).toMatchObject({ slackUserId: U, teamId: 'T1', tz: 'Asia/Kolkata', paused: false, active: true, slackUserToken: 'xoxp-secret', lastSetStatus: { emoji: 'sparkles', text: 'hi' } });
    expect(u?.reconnectNotifiedAt?.toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });

  it('stores tokens encrypted', async () => {
    await setSlackToken(db.pool, U, 'xoxp-secret', testKey);
    await saveConnection(db.pool, U, conn(), testKey);
    const raw = JSON.stringify((await db.pool.query('SELECT * FROM slack_tokens, provider_connections')).rows);
    expect(raw).not.toMatch(/xoxp-secret|access-secret|refresh-secret/);
  });

  it('listSchedulable excludes paused, inactive and unconnected users', async () => {
    for (const id of ['U2', 'U3', 'U4']) await upsertUser(db.pool, { slackUserId: id, teamId: 'T1', tz: 'UTC' });
    for (const id of [U, 'U2', 'U3', 'U4']) await setSlackToken(db.pool, id, 'xoxp', testKey);
    for (const id of [U, 'U2', 'U3']) await saveConnection(db.pool, id, conn(), testKey);
    await setPaused(db.pool, 'U2', true);
    await setInactive(db.pool, 'U3');
    expect((await listSchedulable(db.pool, testKey)).map((u) => u.slackUserId)).toEqual([U]);
  });

  it('deleteUserCascade leaves no rows anywhere', async () => {
    await setSlackToken(db.pool, U, 'x', testKey);
    await saveConnection(db.pool, U, conn(), testKey);
    await savePrefs(db.pool, U, { bands: DEFAULT_BANDS, packIds: ['soft'], customLines: [{ id: 'c1', bandKey: 'high', text: 'yo' }] });
    await saveBag(db.pool, U, 'high', { order: ['a'], position: 1, lastDrawn: 'a' });
    await recordAttempt(db.pool, U, '2026-11-01', new Date());
    await upsertMetrics(db.pool, U, [{ date: '2026-11-01', hrvMs: 50, rhrBpm: 60, minutesAsleep: 400 }]);
    await deleteUserCascade(db.pool, U);
    for (const t of ['users', 'slack_tokens', 'provider_connections', 'bands', 'user_packs', 'custom_lines', 'shuffle_bags', 'daily_runs', 'fitbit_metrics']) {
      expect((await db.pool.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n, t).toBe(0);
    }
  });

  it('has no score column anywhere', async () => {
    const r = await db.pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND column_name ILIKE '%score%'");
    expect(r.rows).toEqual([]);
  });
});

describe('connections', () => {
  it('saveConnection replaces WHOOP with Fitbit', async () => {
    await saveConnection(db.pool, U, conn('whoop'), testKey);
    await saveConnection(db.pool, U, conn('fitbit'), testKey);
    expect(await getConnection(db.pool, U, testKey)).toMatchObject({ provider: 'fitbit', accessToken: 'access-secret', refreshToken: 'refresh-secret', reauthRequired: false });
  });

  it('markReauthRequired and lockConnection', async () => {
    await saveConnection(db.pool, U, conn(), testKey);
    await markReauthRequired(db.pool, U);
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      expect((await lockConnection(client, U, testKey))?.reauthRequired).toBe(true);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });
});

describe('prefs and bags', () => {
  it('returns defaults when nothing is saved', async () => {
    const p = await getPrefs(db.pool, U, ['soft', 'tech']);
    expect(p).toEqual({ bands: DEFAULT_BANDS, packIds: ['soft', 'tech'], customLines: [] });
  });

  it('savePrefs round-trips and deletes bags', async () => {
    await saveBag(db.pool, U, 'high', { order: ['a', 'b'], position: 1, lastDrawn: 'a' });
    expect(await getBag(db.pool, U, 'high')).toEqual({ order: ['a', 'b'], position: 1, lastDrawn: 'a' });
    const prefs = { bands: DEFAULT_BANDS, packIds: ['soft'], customLines: [{ id: 'c1', bandKey: 'high', text: 'yo' }] };
    await savePrefs(db.pool, U, prefs);
    expect(await getPrefs(db.pool, U, ['soft', 'tech'])).toEqual(prefs);
    expect(await getBag(db.pool, U, 'high')).toBeNull();
  });
});

describe('runs', () => {
  it('records attempts and outcomes per local date', async () => {
    expect(await getRun(db.pool, U, '2026-11-01')).toBeNull();
    await recordAttempt(db.pool, U, '2026-11-01', new Date('2026-11-01T01:00:00Z'));
    expect(await getRun(db.pool, U, '2026-11-01')).toEqual({ lastAttemptAt: new Date('2026-11-01T01:00:00Z'), outcome: null });
    await finishRun(db.pool, U, '2026-11-01', 'set', 'high');
    expect((await getRun(db.pool, U, '2026-11-01'))?.outcome).toBe('set');
  });
});

describe('metrics', () => {
  it('upserts, reads a range, and prunes', async () => {
    await upsertMetrics(db.pool, U, [
      { date: '2026-09-01', hrvMs: 40, rhrBpm: 60, minutesAsleep: 400 },
      { date: '2026-10-30', hrvMs: 50, rhrBpm: null, minutesAsleep: 420 },
    ]);
    await upsertMetrics(db.pool, U, [{ date: '2026-10-30', hrvMs: 55, rhrBpm: 58, minutesAsleep: 430 }]);
    expect(await getMetrics(db.pool, U, '2026-10-01', '2026-10-31')).toEqual([{ date: '2026-10-30', hrvMs: 55, rhrBpm: 58, minutesAsleep: 430 }]);
    await upsertMetrics(db.pool, U, [{ date: '2026-10-30', hrvMs: null, rhrBpm: null, minutesAsleep: 440 }]);
    expect((await getMetrics(db.pool, U, '2026-10-30', '2026-10-30'))[0]).toEqual({ date: '2026-10-30', hrvMs: 55, rhrBpm: 58, minutesAsleep: 440 });
    await pruneMetrics(db.pool, '2026-10-01');
    expect(await getMetrics(db.pool, U, '2026-01-01', '2026-12-31')).toHaveLength(1);
  });
});
