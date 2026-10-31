import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { testDb, testKey } from '../helpers/db.js';
import { getUser } from '../../src/db/users.js';
import { getBotToken, installationStore } from '../../src/slack/installStore.js';

let db: { pool: pg.Pool; close: () => Promise<void> };
beforeAll(async () => { db = await testDb(); });
afterAll(async () => { await db.close(); });
beforeEach(async () => { await db.pool.query('TRUNCATE users, workspace CASCADE'); });

const installation = {
  team: { id: 'T1', name: 'Team' },
  enterprise: undefined,
  user: { id: 'U1', token: 'xoxp-user', scopes: ['users.profile:read', 'users.profile:write'] },
  bot: { id: 'B1', userId: 'UB1', token: 'xoxb-bot', scopes: ['commands'] },
  isEnterpriseInstall: false,
} as any;

describe('installationStore', () => {
  it('stores the user token, timezone and bot token', async () => {
    const lookupTz = vi.fn(async () => 'Asia/Kolkata');
    const store = installationStore({ pool: db.pool, key: testKey, lookupTz });
    await store.storeInstallation(installation);
    expect(lookupTz).toHaveBeenCalledWith('xoxb-bot', 'U1');
    expect(await getUser(db.pool, 'U1', testKey)).toMatchObject({ tz: 'Asia/Kolkata', slackUserToken: 'xoxp-user', teamId: 'T1' });
    expect(await getBotToken(db.pool, testKey, 'T1')).toBe('xoxb-bot');
    const fetched = await store.fetchInstallation({ teamId: 'T1', isEnterpriseInstall: false, enterpriseId: undefined });
    expect(fetched.bot?.token).toBe('xoxb-bot');
    expect(fetched.team?.id).toBe('T1');
  });

  it('keeps the existing bot token when a user-only install arrives', async () => {
    const store = installationStore({ pool: db.pool, key: testKey, lookupTz: async () => 'UTC' });
    await store.storeInstallation(installation);
    await store.storeInstallation({ ...installation, user: { ...installation.user, id: 'U2', token: 'xoxp-2' }, bot: undefined });
    expect(await getBotToken(db.pool, testKey, 'T1')).toBe('xoxb-bot');
    expect((await getUser(db.pool, 'U2', testKey))?.slackUserToken).toBe('xoxp-2');
  });
});
