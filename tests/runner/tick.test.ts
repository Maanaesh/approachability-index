import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { testDb, testKey } from '../helpers/db.js';
import { testConfig } from '../helpers/config.js';
import { setSlackToken, upsertUser } from '../../src/db/users.js';
import { saveConnection } from '../../src/db/connections.js';
import { tick } from '../../src/runner/tick.js';
import type { RunDeps } from '../../src/runner/runUser.js';

vi.mock('../../src/runner/runUser.js', () => ({
  runUser: vi.fn(async (user: { slackUserId: string }) => {
    if (user.slackUserId === 'U1') throw new Error('boom');
    return 'set';
  }),
}));
const { runUser } = await import('../../src/runner/runUser.js');

let db: { pool: pg.Pool; close: () => Promise<void> };
beforeAll(async () => { db = await testDb(); });
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.pool.query('TRUNCATE users CASCADE');
  for (const id of ['U1', 'U2']) {
    await upsertUser(db.pool, { slackUserId: id, teamId: 'T', tz: 'UTC' });
    await setSlackToken(db.pool, id, 'x', testKey);
    await saveConnection(db.pool, id, { provider: 'whoop', accessToken: 'a', refreshToken: 'r', expiresAt: new Date('2030-01-01'), issuedAt: new Date(), reauthRequired: false }, testKey);
  }
});

describe('tick timezone refresh', () => {
  it('refreshes a stale timezone before running, at most every 12 hours, keeping it on lookup failure', async () => {
    vi.mocked(runUser).mockClear();
    const lookupTz = vi.fn(async (id: string) => {
      if (id === 'U1') throw new Error('users.info failed');
      return 'Asia/Kolkata';
    });
    const deps = { pool: db.pool, cfg: testConfig(), log: { info: () => {} }, lookupTz } as unknown as RunDeps;
    await tick(new Date('2026-11-02T07:00:00Z'), deps);
    const tzOf = (id: string) => vi.mocked(runUser).mock.calls.find((c) => c[0].slackUserId === id)![0].tz;
    expect(tzOf('U2')).toBe('Asia/Kolkata');
    expect(tzOf('U1')).toBe('UTC');
    await tick(new Date('2026-11-02T08:00:00Z'), deps);
    expect(lookupTz).toHaveBeenCalledTimes(2);
  });
});

describe('tick', () => {
  it('runs every schedulable user and isolates failures', async () => {
    vi.mocked(runUser).mockClear();
    const logs: string[] = [];
    const deps = { pool: db.pool, cfg: testConfig(), log: { info: (e: string) => logs.push(e) } } as unknown as RunDeps;
    await tick(new Date('2026-11-02T07:00:00Z'), deps);
    expect(vi.mocked(runUser).mock.calls.map((c) => c[0].slackUserId)).toEqual(['U1', 'U2']);
    expect(logs).toContain('tick_user_error');
  });
});
