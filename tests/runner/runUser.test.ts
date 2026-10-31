import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { testDb, testKey } from '../helpers/db.js';
import { testConfig } from '../helpers/config.js';
import { getUser, setSlackToken, upsertUser } from '../../src/db/users.js';
import { saveConnection } from '../../src/db/connections.js';
import { getRun } from '../../src/db/runs.js';
import { loadLibrary } from '../../src/lines/library.js';
import { runUser, type RunDeps } from '../../src/runner/runUser.js';
import { ReauthRequired, type Provider, type ScoreResult } from '../../src/providers/types.js';
import { InvalidStatusEmoji, SlackTokenRevoked, type SlackStatusClient } from '../../src/slack/status.js';
import { getBag } from '../../src/db/bags.js';
import { endOfLocalDay } from '../../src/schedule.js';
import type { SlackStatus } from '../../src/status/decision.js';

const U = 'U1';
const TZ = 'Asia/Kolkata';
const lib = loadLibrary();
const local = (date: string, hhmm: string) => new Date(new Date(`${date}T${hhmm}:00+05:30`).toISOString());

let db: { pool: pg.Pool; close: () => Promise<void> };
let logs: string[];
let dms: string[];

function fakeSlack(initial: SlackStatus = { emoji: '', text: '' }) {
  let current = initial;
  const s = {
    get: vi.fn(async () => current),
    set: vi.fn(async (_t: string, st: SlackStatus, _exp: number) => { current = { emoji: `:${st.emoji}:`, text: st.text }; }),
    clear: vi.fn(async () => { current = { emoji: '', text: '' }; }),
    dm: vi.fn(async (_u: string, text: string, blocks?: unknown[]) => { dms.push(text + JSON.stringify(blocks ?? [])); }),
  };
  return s as SlackStatusClient & typeof s;
}

function fakeProvider(id: 'whoop' | 'fitbit', result: () => Promise<ScoreResult> | ScoreResult, refresh?: Provider['refresh']): Provider {
  return { id, authUrl: () => '', exchangeCode: vi.fn(), refresh: refresh ?? vi.fn(), getTodayScore: vi.fn(async () => result()) };
}

function deps(slack: SlackStatusClient, providers: Partial<Record<'whoop' | 'fitbit', Provider>>): RunDeps {
  let seed = 1;
  return {
    pool: db.pool,
    providers: { whoop: fakeProvider('whoop', () => ({ score: null, reason: 'no_data' })), fitbit: fakeProvider('fitbit', () => ({ score: null, reason: 'no_data' })), ...providers },
    slack,
    library: lib,
    rng: () => ((seed = (seed * 16807) % 2147483647) / 2147483647),
    log: { info: (event, fields) => { logs.push(`${event} ${JSON.stringify(fields)}`); } },
    cfg: testConfig(),
  };
}

async function connect(provider: 'whoop' | 'fitbit', expiresAt = new Date('2030-01-01'), issuedAt = new Date('2026-11-01T00:00:00Z')) {
  await saveConnection(db.pool, U, { provider, accessToken: 'a', refreshToken: 'r', expiresAt, issuedAt, reauthRequired: false }, testKey);
}
const user = async () => (await getUser(db.pool, U, testKey))!;

beforeAll(async () => { db = await testDb(); });
afterAll(async () => {
  // Privacy: no score value or percentage ever reached logs or DMs in any test.
  await db.close();
});
beforeEach(async () => {
  logs = [];
  dms = [];
  await db.pool.query('TRUNCATE users CASCADE');
  await upsertUser(db.pool, { slackUserId: U, teamId: 'T', tz: TZ });
  await setSlackToken(db.pool, U, 'xoxp-u', testKey);
});

function assertNoScoreLeak(...scores: number[]) {
  const all = [...logs, ...dms].join('\n');
  for (const s of scores) expect(all).not.toMatch(new RegExp(`\\b${s}\\b`));
  expect(all).not.toMatch(/\d+\s*%/);
}

describe('runUser', () => {
  it('happy path: WHOOP score 72 at 07:00 sets a high-band library line expiring at 23:59 local', async () => {
    await connect('whoop');
    const slack = fakeSlack();
    const now = local('2026-11-02', '07:00');
    const d = deps(slack, { whoop: fakeProvider('whoop', () => ({ score: 72, reason: 'ok' })) });
    expect(await runUser(await user(), now, d)).toBe('set');
    const [, status, exp] = slack.set.mock.calls[0];
    const line = lib.lines.find((l) => l.text === status.text);
    expect(line?.band).toBe('high');
    expect(exp).toBe(endOfLocalDay(now, TZ));
    expect(await getRun(db.pool, U, '2026-11-02')).toMatchObject({ outcome: 'set' });
    expect((await db.pool.query('SELECT band_key FROM daily_runs')).rows[0].band_key).toBe('high');
    expect((await user()).lastSetStatus).toEqual(status);
    assertNoScoreLeak(72);
  });

  it('is not due before 06:00 local', async () => {
    await connect('whoop');
    expect(await runUser(await user(), local('2026-11-02', '05:59'), deps(fakeSlack(), {}))).toBe('not_due');
  });

  it('leaves a manual status alone and does not retry the same day', async () => {
    await connect('whoop');
    const slack = fakeSlack({ emoji: ':palm_tree:', text: 'on vacation' });
    const d = deps(slack, { whoop: fakeProvider('whoop', () => ({ score: 72, reason: 'ok' })) });
    expect(await runUser(await user(), local('2026-11-02', '07:00'), d)).toBe('skipped_manual');
    expect(slack.set).not.toHaveBeenCalled();
    expect(await runUser(await user(), local('2026-11-02', '08:00'), d)).toBe('not_due');
  });

  it('waits while pending during polling, then sets the fallback after 11:00', async () => {
    await connect('whoop');
    const slack = fakeSlack();
    const d = deps(slack, { whoop: fakeProvider('whoop', () => ({ score: null, reason: 'pending' })) });
    expect(await runUser(await user(), local('2026-11-02', '07:00'), d)).toBe('waiting');
    expect(await runUser(await user(), local('2026-11-02', '07:20'), d)).toBe('not_due'); // <30 min since last poll
    expect(await runUser(await user(), local('2026-11-02', '11:05'), d)).toBe('fallback');
    const text = slack.set.mock.calls[0][1].text;
    expect(lib.lines.find((l) => l.text === text)?.band).toBe('fallback');
  });

  it('goes straight to fallback for unscorable during polling', async () => {
    await connect('whoop');
    const d = deps(fakeSlack(), { whoop: fakeProvider('whoop', () => ({ score: null, reason: 'unscorable' })) });
    expect(await runUser(await user(), local('2026-11-02', '07:00'), d)).toBe('fallback');
  });

  it('expired Fitbit token: fallback, and the friendly reconnect DM is sent exactly once across two days', async () => {
    await connect('fitbit', new Date('2020-01-01T00:00:00Z'), new Date('2026-10-26T00:00:00Z'));
    const slack = fakeSlack();
    const refresh = vi.fn(async () => { throw new ReauthRequired('invalid_grant'); });
    const d = deps(slack, { fitbit: fakeProvider('fitbit', () => ({ score: 46, reason: 'ok' }), refresh) });
    expect(await runUser(await user(), local('2026-11-02', '07:00'), d)).toBe('fallback');
    expect(await runUser(await user(), local('2026-11-03', '07:00'), d)).toBe('fallback');
    expect(slack.dm).toHaveBeenCalledTimes(1);
    expect(dms[0]).toMatch(/reconnect your Fitbit/i);
    assertNoScoreLeak(46);
  });

  it('sends the day-6 Fitbit reminder once while still scoring normally', async () => {
    await connect('fitbit', new Date('2030-01-01'), new Date('2026-10-27T00:00:00Z'));
    const slack = fakeSlack();
    const d = deps(slack, { fitbit: fakeProvider('fitbit', () => ({ score: 46, reason: 'ok' })) });
    expect(await runUser(await user(), local('2026-11-02', '07:00'), d)).toBe('set');
    expect(await runUser(await user(), local('2026-11-03', '07:00'), d)).toBe('set');
    expect(slack.dm).toHaveBeenCalledTimes(1);
    expect(dms[0]).toMatch(/weekly vibe check-in/);
    assertNoScoreLeak(46);
  });

  it('never repeats a line across 10 days in the same band', async () => {
    await connect('whoop');
    const slack = fakeSlack();
    const d = deps(slack, { whoop: fakeProvider('whoop', () => ({ score: 80, reason: 'ok' })) });
    for (let day = 1; day <= 10; day++) {
      const date = `2026-11-${String(day).padStart(2, '0')}`;
      expect(await runUser(await user(), local(date, '07:00'), d)).toBe('set');
    }
    const texts = slack.set.mock.calls.map((c) => c[1].text);
    expect(new Set(texts).size).toBe(10);
    assertNoScoreLeak(80);
  });

  it('marks the user inactive when Slack revokes the token', async () => {
    await connect('whoop');
    const slack = fakeSlack();
    slack.get.mockRejectedValueOnce(new SlackTokenRevoked('token_revoked'));
    const d = deps(slack, { whoop: fakeProvider('whoop', () => ({ score: 72, reason: 'ok' })) });
    expect(await runUser(await user(), local('2026-11-02', '07:00'), d)).toBe('error');
    expect((await user()).active).toBe(false);
    expect((await user()).slackUserToken).toBeNull();
  });

  it('a provider network error waits during polling and falls back after 11:00', async () => {
    await connect('whoop');
    const d = deps(fakeSlack(), { whoop: fakeProvider('whoop', () => { throw new TypeError('fetch failed'); }) });
    expect(await runUser(await user(), local('2026-11-02', '07:00'), d)).toBe('waiting');
    expect(await runUser(await user(), local('2026-11-02', '11:05'), d)).toBe('fallback');
  });

  it('throttles retries to every 30 minutes after 11:00 too', async () => {
    await connect('whoop');
    const slack = fakeSlack();
    slack.get.mockRejectedValueOnce(new Error('socket hang up'));
    const d = deps(slack, { whoop: fakeProvider('whoop', () => ({ score: null, reason: 'no_data' })) });
    expect(await runUser(await user(), local('2026-11-02', '11:05'), d)).toBe('error');
    expect(await runUser(await user(), local('2026-11-02', '11:10'), d)).toBe('not_due');
    expect(await runUser(await user(), local('2026-11-02', '11:36'), d)).toBe('fallback');
  });

  it('does not advance the shuffle bag when Slack fails to set the status', async () => {
    await connect('whoop');
    const slack = fakeSlack();
    slack.set.mockRejectedValueOnce(new Error('internal_error'));
    const d = deps(slack, { whoop: fakeProvider('whoop', () => ({ score: 72, reason: 'ok' })) });
    expect(await runUser(await user(), local('2026-11-02', '07:00'), d)).toBe('error');
    expect(await getBag(db.pool, U, 'high')).toBeNull();
  });

  it('retries with a pool emoji when Slack rejects the emoji', async () => {
    await connect('whoop');
    const slack = fakeSlack();
    slack.set.mockRejectedValueOnce(new InvalidStatusEmoji('profile_status_set_failed_not_valid_emoji'));
    const d = deps(slack, { whoop: fakeProvider('whoop', () => ({ score: 72, reason: 'ok' })) });
    expect(await runUser(await user(), local('2026-11-02', '07:00'), d)).toBe('set');
    expect(slack.set).toHaveBeenCalledTimes(2);
    expect(lib.emojiPools.high).toContain(slack.set.mock.calls[1][1].emoji);
  });

  it('does not record an outcome on a transient error, so the next tick retries', async () => {
    await connect('whoop');
    const slack = fakeSlack();
    slack.get.mockRejectedValueOnce(new Error('socket hang up'));
    const d = deps(slack, { whoop: fakeProvider('whoop', () => ({ score: 72, reason: 'ok' })) });
    expect(await runUser(await user(), local('2026-11-02', '07:00'), d)).toBe('error');
    expect((await getRun(db.pool, U, '2026-11-02'))?.outcome).toBeNull();
    expect(await runUser(await user(), local('2026-11-02', '07:30'), d)).toBe('set');
    expect(logs.join('\n')).toContain('run_error');
    assertNoScoreLeak(72);
  });
});
