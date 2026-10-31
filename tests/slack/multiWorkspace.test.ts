import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { testDb, testKey } from '../helpers/db.js';
import { getUser, setLastSetStatus } from '../../src/db/users.js';
import { saveConnection } from '../../src/db/connections.js';
import { getBotToken, getBotTokenForUser, installationStore } from '../../src/slack/installStore.js';
import { teamSlackClient } from '../../src/slack/teamClient.js';
import { handleAppUninstalled, handleTokensRevoked } from '../../src/slack/lifecycle.js';

let db: { pool: pg.Pool; close: () => Promise<void> };
beforeAll(async () => { db = await testDb(); });
afterAll(async () => { await db.close(); });

const install = (team: string, user: string, bot?: string) => ({
  team: { id: team }, enterprise: undefined, isEnterpriseInstall: false,
  user: { id: user, token: `xoxp-${user}`, scopes: [] },
  bot: bot ? { id: `B-${team}`, userId: `UB-${team}`, token: bot, scopes: [] } : undefined,
}) as any;

async function seedTwoWorkspaces() {
  const store = installationStore({ pool: db.pool, key: testKey, lookupTz: async () => 'UTC' });
  await store.storeInstallation(install('TA', 'UA1', 'xoxb-A'));
  await store.storeInstallation(install('TB', 'UB1', 'xoxb-B'));
  await store.storeInstallation(install('TA', 'UA2')); // user-only install into an existing workspace
  for (const u of ['UA1', 'UA2', 'UB1']) {
    await saveConnection(db.pool, u, { provider: 'whoop', accessToken: 'a', refreshToken: 'r', expiresAt: new Date('2030-01-01'), issuedAt: new Date(), reauthRequired: false }, testKey);
  }
  return store;
}

beforeEach(async () => { await db.pool.query('TRUNCATE users, workspace CASCADE'); });

describe('per-workspace bot tokens', () => {
  it('keeps each workspace bot token separate', async () => {
    const store = await seedTwoWorkspaces();
    expect(await getBotToken(db.pool, testKey, 'TA')).toBe('xoxb-A');
    expect(await getBotToken(db.pool, testKey, 'TB')).toBe('xoxb-B');
    expect(await getBotTokenForUser(db.pool, testKey, 'UA2')).toBe('xoxb-A');
    expect(await getBotTokenForUser(db.pool, testKey, 'UB1')).toBe('xoxb-B');
    expect((await store.fetchInstallation({ teamId: 'TB', isEnterpriseInstall: false, enterpriseId: undefined })).bot?.token).toBe('xoxb-B');
    expect((await getUser(db.pool, 'UA2', testKey))?.teamId).toBe('TA');
  });

  it('a user-only install looks up the timezone with its own workspace bot token', async () => {
    await seedTwoWorkspaces();
    const lookupTz = vi.fn(async () => 'Asia/Kolkata');
    await installationStore({ pool: db.pool, key: testKey, lookupTz }).storeInstallation(install('TB', 'UB2'));
    expect(lookupTz).toHaveBeenCalledWith('xoxb-B', 'UB2');
  });
});

describe('teamSlackClient', () => {
  it('sends DMs with the bot token of the user own workspace', async () => {
    await seedTwoWorkspaces();
    const posted: { token: string; channel: string }[] = [];
    const makeClient = (token?: string) => ({
      chat: { postMessage: vi.fn(async (a: any) => { posted.push({ token: token!, channel: a.channel }); return { ok: true }; }) },
      users: { profile: { get: vi.fn(async () => ({ profile: {} })), set: vi.fn(async () => ({ ok: true })) } },
    }) as any;
    const slack = teamSlackClient(db.pool, testKey, makeClient);
    await slack.dm('UA1', 'hi');
    await slack.dm('UB1', 'hi');
    expect(posted).toEqual([{ token: 'xoxb-A', channel: 'UA1' }, { token: 'xoxb-B', channel: 'UB1' }]);
  });

  it('throws a clear error when the workspace is not installed', async () => {
    const slack = teamSlackClient(db.pool, testKey, () => ({}) as any);
    await expect(slack.dm('UNKNOWN', 'hi')).rejects.toThrow(/not installed/);
  });
});

describe('workspace lifecycle', () => {
  it('app_uninstalled deletes that workspace and all its users, leaving others alone', async () => {
    await seedTwoWorkspaces();
    await handleAppUninstalled(db.pool, 'TA');
    expect((await db.pool.query('SELECT slack_user_id FROM users ORDER BY 1')).rows.map((r) => r.slack_user_id)).toEqual(['UB1']);
    expect((await db.pool.query('SELECT team_id FROM workspace')).rows.map((r) => r.team_id)).toEqual(['TB']);
    expect((await db.pool.query("SELECT count(*)::int AS n FROM provider_connections WHERE slack_user_id LIKE 'UA%'")).rows[0].n).toBe(0);
  });

  it('tokens_revoked for users clears their Slack token and deactivates them', async () => {
    await seedTwoWorkspaces();
    await setLastSetStatus(db.pool, 'UA1', { emoji: 'sparkles', text: 'x' });
    await handleTokensRevoked(db.pool, 'TA', { oauth: ['UA1'] });
    const u = await getUser(db.pool, 'UA1', testKey);
    expect(u).toMatchObject({ active: false, slackUserToken: null });
    expect((await getUser(db.pool, 'UA2', testKey))?.active).toBe(true);
  });

  it('tokens_revoked for the bot removes the workspace install', async () => {
    await seedTwoWorkspaces();
    await handleTokensRevoked(db.pool, 'TB', { bot: ['UB-TB'] });
    expect(await getBotToken(db.pool, testKey, 'TB')).toBeNull();
    expect(await getBotToken(db.pool, testKey, 'TA')).toBe('xoxb-A');
  });
});
