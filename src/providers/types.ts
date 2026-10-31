import { randomInt } from 'node:crypto';

export type ProviderId = 'whoop' | 'fitbit';
export type ScoreReason = 'ok' | 'pending' | 'unscorable' | 'no_data' | 'insufficient_history' | 'reauth_required' | 'temporary_error';
export type ScoreResult = { score: number | null; reason: ScoreReason };
export type TokenSet = { accessToken: string; refreshToken: string; expiresAt: Date };
export type ScoreContext = { userId: string; localDate: string; tz: string };

export interface Provider {
  id: ProviderId;
  authUrl(state: string): string;
  exchangeCode(code: string): Promise<TokenSet>;
  refresh(refreshToken: string): Promise<TokenSet>;
  getTodayScore(accessToken: string, ctx: ScoreContext): Promise<ScoreResult>;
}

export class ReauthRequired extends Error {
  name = 'ReauthRequired';
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

// WHOOP requires the state parameter to be exactly 8 characters.
export function newOAuthState(): string {
  return Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
}

export async function postTokenForm(fetchFn: typeof fetch, url: string, params: Record<string, string>): Promise<TokenSet & { raw: any }> {
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const body: any = await res.json().catch(() => ({}));
  if (res.status === 400 || res.status === 401) throw new ReauthRequired(body.error ?? `token endpoint ${res.status}`);
  if (!res.ok) throw new Error(`token endpoint ${res.status}`);
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? params.refresh_token,
    expiresAt: new Date(Date.now() + Number(body.expires_in ?? 3600) * 1000),
    raw: body,
  };
}
