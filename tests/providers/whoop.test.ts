import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { newOAuthState, ReauthRequired } from '../../src/providers/types.js';
import { whoopProvider } from '../../src/providers/whoop.js';
import { fakeFetch, json } from '../helpers/fetch.js';
import { testConfig } from '../helpers/config.js';

const fx = (n: string) => JSON.parse(readFileSync(`tests/fixtures/whoop/${n}.json`, 'utf8'));
const isRecovery = (u: URL) => u.pathname === '/developer/v2/recovery';
const ctx = { userId: 'U1', localDate: '2026-11-02', tz: 'Asia/Kolkata' };
const record = (state: string, created = '2026-11-02T01:30:00.000Z') => ({
  records: [{ cycle_id: 1, created_at: created, score_state: state, ...(state === 'SCORED' ? { score: { recovery_score: 55 } } : {}) }],
  next_token: null,
});

describe('whoopProvider', () => {
  it('builds the auth URL with scopes and an 8-char state', () => {
    const state = newOAuthState();
    expect(state).toMatch(/^[A-Za-z0-9]{8}$/);
    const url = new URL(whoopProvider(testConfig()).authUrl(state));
    expect(`${url.origin}${url.pathname}`).toBe('https://api.prod.whoop.com/oauth/oauth2/auth');
    expect(url.searchParams.get('scope')).toBe('read:recovery read:cycles offline');
    expect(url.searchParams.get('state')).toBe(state);
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.test/oauth/whoop/callback');
  });

  it('exchanges a code for tokens', async () => {
    const f = fakeFetch([{ match: (u) => u.pathname === '/oauth/oauth2/token', respond: () => json(fx('token')) }]);
    const t = await whoopProvider(testConfig(), f).exchangeCode('abc');
    expect(t).toMatchObject({ accessToken: 'new-access', refreshToken: 'new-refresh' });
    expect(String(f.calls[0].init?.body)).toContain('grant_type=authorization_code');
  });

  it("returns today's scored recovery, following next_token", async () => {
    const f = fakeFetch([
      { match: (u) => isRecovery(u) && u.searchParams.get('nextToken') === 'page2', respond: () => json(fx('recovery-page2')) },
      { match: isRecovery, respond: () => json(fx('recovery-page1')) },
    ]);
    expect(await whoopProvider(testConfig(), f).getTodayScore('tok', ctx)).toEqual({ score: 72, reason: 'ok' });
    expect(f.calls[0].init?.headers).toMatchObject({ Authorization: 'Bearer tok' });
  });

  it('follows next_token when today is on the second page', async () => {
    const f = fakeFetch([
      { match: (u) => isRecovery(u) && u.searchParams.get('nextToken') === 'p2', respond: () => json(record('SCORED')) },
      { match: isRecovery, respond: () => json({ records: [], next_token: 'p2' }) },
    ]);
    expect(await whoopProvider(testConfig(), f).getTodayScore('tok', ctx)).toEqual({ score: 55, reason: 'ok' });
  });

  it.each([['PENDING_SCORE', 'pending'], ['UNSCORABLE', 'unscorable']])('%s → %s', async (state, reason) => {
    const f = fakeFetch([{ match: isRecovery, respond: () => json(record(state)) }]);
    expect(await whoopProvider(testConfig(), f).getTodayScore('tok', ctx)).toEqual({ score: null, reason });
  });

  it('ignores a record from yesterday in the user timezone even if it is today in UTC', async () => {
    // 2026-11-01T18:00Z is 23:30 on Nov 1 in Kolkata
    const f = fakeFetch([{ match: isRecovery, respond: () => json(record('SCORED', '2026-11-01T18:00:00.000Z')) }]);
    expect(await whoopProvider(testConfig(), f).getTodayScore('tok', { ...ctx, tz: 'Asia/Kolkata' })).toEqual({ score: null, reason: 'no_data' });
  });

  it('throws ReauthRequired on 401', async () => {
    const f = fakeFetch([{ match: isRecovery, respond: () => json({}, 401) }]);
    await expect(whoopProvider(testConfig(), f).getTodayScore('tok', ctx)).rejects.toBeInstanceOf(ReauthRequired);
  });

  it.each([429, 503])('HTTP %s → temporary_error', async (status) => {
    const f = fakeFetch([{ match: isRecovery, respond: () => json({}, status) }]);
    expect(await whoopProvider(testConfig(), f).getTodayScore('tok', ctx)).toEqual({ score: null, reason: 'temporary_error' });
  });
});
