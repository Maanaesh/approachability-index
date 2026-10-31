import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { fetchDailyMetrics, fitbitProvider, needsReconnectReminder } from '../../src/providers/fitbit.js';
import { ReauthRequired } from '../../src/providers/types.js';
import { upsertUser } from '../../src/db/users.js';
import { getMetrics, upsertMetrics } from '../../src/db/metrics.js';
import { fakeFetch, json, type Route } from '../helpers/fetch.js';
import { testConfig } from '../helpers/config.js';
import { testDb } from '../helpers/db.js';

const fx = (n: string) => JSON.parse(readFileSync(`tests/fixtures/google/${n}.json`, 'utf8'));
const type = (t: string) => (u: URL) => u.pathname === `/v4/users/me/dataTypes/${t}/dataPoints`;
const routes = (): Route[] => [
  { match: type('daily-heart-rate-variability'), respond: () => json(fx('hrv')) },
  { match: (u) => type('daily-resting-heart-rate')(u) && u.searchParams.get('pageToken') === 'rhr2', respond: () => json(fx('rhr-page2')) },
  { match: type('daily-resting-heart-rate'), respond: () => json(fx('rhr-page1')) },
  { match: type('sleep'), respond: () => json(fx('sleep')) },
];

let db: { pool: pg.Pool; close: () => Promise<void> };
beforeAll(async () => { db = await testDb(); });
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.pool.query('TRUNCATE users CASCADE');
  await upsertUser(db.pool, { slackUserId: 'U1', teamId: 'T', tz: 'Asia/Kolkata' });
});

function history(days: number) {
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(Date.UTC(2026, 10, 2 - (i + 1)));
    return { date: d.toISOString().slice(0, 10), hrvMs: i % 2 ? 50 : 60, rhrBpm: i % 2 ? 55 : 65, minutesAsleep: 450 };
  });
}

describe('fitbitProvider', () => {
  it('auth URL requests both scopes with offline access and consent', () => {
    const url = new URL(fitbitProvider(testConfig(), { pool: db.pool }).authUrl('state123'));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('scope')).toBe(
      'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly https://www.googleapis.com/auth/googlehealth.sleep.readonly',
    );
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.test/oauth/fitbit/callback');
  });

  it('exchanges a code against the Google token endpoint', async () => {
    const f = fakeFetch([{ match: (u) => u.href === 'https://oauth2.googleapis.com/token', respond: () => json(fx('token')) }]);
    expect(await fitbitProvider(testConfig(), { pool: db.pool }, f).exchangeCode('c')).toMatchObject({ accessToken: 'g-access', refreshToken: 'g-refresh' });
  });
});

describe('fetchDailyMetrics', () => {
  it('maps HRV, RHR and main sleep only, following pagination', async () => {
    const f = fakeFetch(routes());
    const rows = await fetchDailyMetrics('tok', '2026-11-01', '2026-11-02', 'Asia/Kolkata', f);
    expect(rows).toEqual([
      { date: '2026-11-01', hrvMs: null, rhrBpm: 60, minutesAsleep: null },
      { date: '2026-11-02', hrvMs: 62.5, rhrBpm: 57, minutesAsleep: 420 },
    ]);
    const hrvCall = f.calls.find((c) => type('daily-heart-rate-variability')(c.url))!;
    // Live API (2026-10-31): daily dates only support >= and <; sleep filters only on interval.end_time (UTC timestamps).
    expect(hrvCall.url.searchParams.get('filter')).toBe('daily_heart_rate_variability.date >= "2026-11-01" AND daily_heart_rate_variability.date < "2026-11-03"');
    expect(f.calls.find((c) => type('sleep')(c.url))!.url.searchParams.get('filter')).toBe(
      'sleep.interval.end_time >= "2026-10-31T18:30:00Z" AND sleep.interval.end_time < "2026-11-02T18:30:00Z"',
    );
    expect(f.calls.find((c) => type('sleep')(c.url))!.url.searchParams.get('pageSize')).toBe('25');
  });

  it('throws ReauthRequired on 401', async () => {
    const f = fakeFetch([{ match: () => true, respond: () => json({}, 401) }]);
    await expect(fetchDailyMetrics('tok', '2026-11-01', '2026-11-02', 'UTC', f)).rejects.toBeInstanceOf(ReauthRequired);
  });
});

describe('getTodayScore and backfill', () => {
  const ctx = { userId: 'U1', localDate: '2026-11-02', tz: 'Asia/Kolkata' };

  it('scores today against 30 stored days', async () => {
    await upsertMetrics(db.pool, 'U1', history(30));
    const r = await fitbitProvider(testConfig(), { pool: db.pool }, fakeFetch(routes())).getTodayScore('tok', ctx);
    expect(r.reason).toBe('ok');
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });

  it('returns insufficient_history with fewer than 7 days', async () => {
    await upsertMetrics(db.pool, 'U1', history(5));
    expect(await fitbitProvider(testConfig(), { pool: db.pool }, fakeFetch(routes())).getTodayScore('tok', ctx)).toEqual({ score: null, reason: 'insufficient_history' });
  });

  it('returns temporary_error on 5xx', async () => {
    const f = fakeFetch([{ match: () => true, respond: () => json({}, 503) }]);
    expect(await fitbitProvider(testConfig(), { pool: db.pool }, f).getTodayScore('tok', ctx)).toEqual({ score: null, reason: 'temporary_error' });
  });

  it('backfill stores the returned days', async () => {
    const p = fitbitProvider(testConfig(), { pool: db.pool }, fakeFetch(routes()));
    await p.backfill('tok', 'U1', 'Asia/Kolkata', 30, new Date('2026-11-02T06:00:00Z'));
    expect(await getMetrics(db.pool, 'U1', '2026-10-01', '2026-11-02')).toHaveLength(2);
  });
});

describe('needsReconnectReminder', () => {
  const issued = new Date('2026-11-01T00:00:00Z');
  it('is false just before 6 days and true at 6 days', () => {
    expect(needsReconnectReminder(issued, new Date('2026-11-06T23:00:00Z'))).toBe(false);
    expect(needsReconnectReminder(issued, new Date('2026-11-07T00:00:00Z'))).toBe(true);
  });
});
