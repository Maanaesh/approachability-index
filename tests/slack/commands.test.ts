import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { testDb, testKey } from '../helpers/db.js';
import { testConfig } from '../helpers/config.js';
import { getUser, setInactive, setLastSetStatus, setSlackToken, upsertUser } from '../../src/db/users.js';
import { SlackTokenRevoked } from '../../src/slack/status.js';
import { saveConnection } from '../../src/db/connections.js';
import { loadLibrary } from '../../src/lines/library.js';
import { handleCommand, registerCommands, type CommandDeps } from '../../src/slack/commands.js';
import type { Provider, ScoreResult } from '../../src/providers/types.js';
import type { SlackStatus } from '../../src/status/decision.js';
import { fakeFetch, json } from '../helpers/fetch.js';
import type { Config } from '../../src/config.js';

let db: { pool: pg.Pool; close: () => Promise<void> };
beforeAll(async () => { db = await testDb(); });
afterAll(async () => { await db.close(); });
beforeEach(async () => { await db.pool.query('TRUNCATE users CASCADE'); });

const provider = (id: 'whoop' | 'fitbit', r: ScoreResult = { score: 72, reason: 'ok' }): Provider => ({
  id, authUrl: () => '', exchangeCode: vi.fn(), refresh: vi.fn(), getTodayScore: vi.fn(async () => r),
});

function deps(current: SlackStatus = { emoji: '', text: '' }, cfg: Config = testConfig()) {
  const slack = { get: vi.fn(async () => current), set: vi.fn(), clear: vi.fn(), dm: vi.fn() };
  const revokeSlackToken = vi.fn(async () => {});
  const fetchFn = fakeFetch([{ match: (u) => u.host === 'oauth2.googleapis.com', respond: () => json({}) }]);
  const d: CommandDeps = {
    pool: db.pool, cfg, slack, library: loadLibrary(), rng: Math.random, log: { info: () => {} },
    providers: { whoop: provider('whoop'), fitbit: provider('fitbit') }, revokeSlackToken, fetchFn,
  };
  return { d, slack, revokeSlackToken, fetchFn };
}

async function connectedUser(provider: 'whoop' | 'fitbit' = 'whoop') {
  await upsertUser(db.pool, { slackUserId: 'U1', teamId: 'T', tz: 'UTC' });
  await setSlackToken(db.pool, 'U1', 'xoxp-u', testKey);
  await saveConnection(db.pool, 'U1', { provider, accessToken: 'a', refreshToken: 'r', expiresAt: new Date('2030-01-01'), issuedAt: new Date(), reauthRequired: false }, testKey);
}
const buttons = (r: { blocks?: any[] }) => JSON.stringify(r.blocks ?? []);

describe('handleCommand', () => {
  it('connect without a Slack token shows only the authorize button', async () => {
    const r = await handleCommand('connect', { userId: 'U1' }, deps().d);
    expect(r.response_type).toBe('ephemeral');
    expect(buttons(r)).toContain('https://app.test/slack/install');
    expect(buttons(r)).not.toContain('/oauth/whoop/start');
  });

  it('connect with a Slack token shows provider buttons with signed links', async () => {
    await connectedUser();
    const r = await handleCommand('connect', { userId: 'U1' }, deps().d);
    expect(buttons(r)).toMatch(/https:\/\/app\.test\/oauth\/whoop\/start\?u=U1\./);
    expect(buttons(r)).toContain('/oauth/fitbit/start');
  });

  it('connect hides WHOOP when WHOOP_ENABLED=false', async () => {
    await connectedUser();
    const r = await handleCommand('connect', { userId: 'U1' }, deps(undefined, testConfig({ whoopEnabled: false })).d);
    expect(buttons(r)).not.toContain('/oauth/whoop/start');
    expect(buttons(r)).toContain('/oauth/fitbit/start');
  });

  it('every link button has an open_link action id', async () => {
    const authorize = await handleCommand('connect', { userId: 'U1' }, deps().d);
    await connectedUser();
    const connect = await handleCommand('connect', { userId: 'U1' }, deps().d);
    const ids = [...buttons(authorize).matchAll(/"action_id":"([^"]+)"/g), ...buttons(connect).matchAll(/"action_id":"([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThanOrEqual(3);
    expect(ids.every((id) => id.startsWith('open_link_'))).toBe(true);
  });

  it('registerCommands acknowledges link button clicks', async () => {
    const actions: { matcher: RegExp | string; handler: (args: any) => Promise<void> }[] = [];
    const app = { command: vi.fn(), action: vi.fn((matcher, handler) => actions.push({ matcher, handler })) } as any;
    registerCommands(app, deps().d);
    const linkAction = actions.find((a) => (a.matcher instanceof RegExp ? a.matcher.test('open_link_fitbit') : a.matcher === 'open_link_fitbit'));
    expect(linkAction).toBeDefined();
    const ack = vi.fn(async () => {});
    await linkAction!.handler({ ack });
    expect(ack).toHaveBeenCalled();
  });

  it('connect hides Fitbit when FITBIT_ENABLED=false', async () => {
    await connectedUser();
    const r = await handleCommand('connect', { userId: 'U1' }, deps(undefined, testConfig({ fitbitEnabled: false })).d);
    expect(buttons(r)).not.toContain('/oauth/fitbit/start');
  });

  it('status shows the band and the user own score, ephemerally', async () => {
    await connectedUser();
    const r = await handleCommand('status', { userId: 'U1' }, deps().d);
    expect(r.response_type).toBe('ephemeral');
    expect(r.text).toContain('High');
    expect(r.text).toContain('72');
    expect(r.text).toMatch(/only you can see this/);
  });

  it('empty text behaves like status', async () => {
    await connectedUser();
    expect((await handleCommand('', { userId: 'U1' }, deps().d)).text).toContain('High');
  });

  it('pause clears our status but not a manual one', async () => {
    await connectedUser();
    await setLastSetStatus(db.pool, 'U1', { emoji: 'sparkles', text: 'ours' });
    const ours = deps({ emoji: ':sparkles:', text: 'ours' });
    await handleCommand('pause', { userId: 'U1' }, ours.d);
    expect(ours.slack.clear).toHaveBeenCalledWith('xoxp-u');
    expect((await getUser(db.pool, 'U1', testKey))?.paused).toBe(true);

    await handleCommand('resume', { userId: 'U1' }, ours.d);
    expect((await getUser(db.pool, 'U1', testKey))?.paused).toBe(false);

    await setLastSetStatus(db.pool, 'U1', { emoji: 'sparkles', text: 'ours' });
    const manual = deps({ emoji: ':palm_tree:', text: 'on vacation' });
    await handleCommand('pause', { userId: 'U1' }, manual.d);
    expect(manual.slack.clear).not.toHaveBeenCalled();
  });

  it('disconnect clears, revokes Slack and Google tokens, and deletes all rows', async () => {
    await connectedUser('fitbit');
    await setLastSetStatus(db.pool, 'U1', { emoji: 'sparkles', text: 'ours' });
    const x = deps({ emoji: 'sparkles', text: 'ours' });
    const r = await handleCommand('disconnect', { userId: 'U1' }, x.d);
    expect(x.slack.clear).toHaveBeenCalled();
    expect(x.revokeSlackToken).toHaveBeenCalledWith('xoxp-u');
    expect(x.fetchFn.calls.some((c) => c.url.href.startsWith('https://oauth2.googleapis.com/revoke'))).toBe(true);
    expect((await db.pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n).toBe(0);
    expect(r.text).toMatch(/disconnected/i);
  });

  it('disconnect still deletes everything when Slack rejects the token', async () => {
    await connectedUser('fitbit');
    await setLastSetStatus(db.pool, 'U1', { emoji: 'sparkles', text: 'ours' });
    const x = deps();
    x.slack.get.mockRejectedValueOnce(new SlackTokenRevoked('token_revoked'));
    const r = await handleCommand('disconnect', { userId: 'U1' }, x.d);
    expect(r.text).toMatch(/disconnected/i);
    expect((await db.pool.query('SELECT count(*)::int AS n FROM provider_connections')).rows[0].n).toBe(0);
  });

  it('pause still pauses when Slack errors', async () => {
    await connectedUser();
    await setLastSetStatus(db.pool, 'U1', { emoji: 'sparkles', text: 'ours' });
    const x = deps();
    x.slack.get.mockRejectedValueOnce(new Error('ratelimited'));
    await handleCommand('pause', { userId: 'U1' }, x.d);
    expect((await getUser(db.pool, 'U1', testKey))?.paused).toBe(true);
  });

  it('status tells an inactive user to re-authorise Slack', async () => {
    await connectedUser();
    await setInactive(db.pool, 'U1');
    expect((await handleCommand('status', { userId: 'U1' }, deps().d)).text).toMatch(/re-authori[sz]e/i);
  });

  it('unknown subcommands show help', async () => {
    const r = await handleCommand('dance', { userId: 'U1' }, deps().d);
    expect(r.text).toMatch(/connect/);
    expect(r.text).toMatch(/settings/);
  });
});
