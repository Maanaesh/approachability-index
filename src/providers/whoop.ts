import { DateTime } from 'luxon';
import type { Config } from '../config.js';
import { postTokenForm, ReauthRequired, type Provider, type ScoreResult } from './types.js';

const AUTH_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth';
const TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
const API = 'https://api.prod.whoop.com/developer';
const SCOPES = 'read:recovery read:cycles offline';
const MAX_PAGES = 5;

type RecoveryRecord = { created_at: string; score_state: 'SCORED' | 'PENDING_SCORE' | 'UNSCORABLE'; score?: { recovery_score: number } };

export function whoopProvider(cfg: Config, fetchFn: typeof fetch = fetch): Provider {
  const redirectUri = `${cfg.publicBaseUrl}/oauth/whoop/callback`;
  const tokenParams = { client_id: cfg.whoop.clientId, client_secret: cfg.whoop.clientSecret };

  return {
    id: 'whoop',
    authUrl(state) {
      const q = new URLSearchParams({ response_type: 'code', client_id: cfg.whoop.clientId, redirect_uri: redirectUri, scope: SCOPES, state });
      return `${AUTH_URL}?${q}`;
    },
    exchangeCode: (code) => postTokenForm(fetchFn, TOKEN_URL, { ...tokenParams, grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
    refresh: (refreshToken) => postTokenForm(fetchFn, TOKEN_URL, { ...tokenParams, grant_type: 'refresh_token', refresh_token: refreshToken, scope: 'offline' }),

    async getTodayScore(accessToken, { localDate, tz }): Promise<ScoreResult> {
      const start = DateTime.fromISO(localDate, { zone: tz }).minus({ days: 1 }).toUTC().toISO()!;
      let nextToken: string | null = null;
      for (let page = 0; page < MAX_PAGES; page++) {
        const q = new URLSearchParams({ limit: '25', start });
        if (nextToken) q.set('nextToken', nextToken);
        const res = await fetchFn(`${API}/v2/recovery?${q}`, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (res.status === 401) throw new ReauthRequired('whoop 401');
        if (!res.ok) return { score: null, reason: 'temporary_error' };
        const body = (await res.json()) as { records: RecoveryRecord[]; next_token?: string | null };
        const today = body.records.find((r) => DateTime.fromISO(r.created_at, { zone: tz }).toISODate() === localDate);
        if (today) {
          if (today.score_state === 'SCORED' && today.score) return { score: today.score.recovery_score, reason: 'ok' };
          return { score: null, reason: today.score_state === 'PENDING_SCORE' ? 'pending' : 'unscorable' };
        }
        nextToken = body.next_token ?? null;
        if (!nextToken) break;
      }
      return { score: null, reason: 'no_data' };
    },
  };
}
