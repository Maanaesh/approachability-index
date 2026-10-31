import { createHmac, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import type pg from 'pg';
import type { Config } from '../config.js';
import { saveConnection } from '../db/connections.js';
import { getUser } from '../db/users.js';
import { newOAuthState, type Provider, type ProviderId } from '../providers/types.js';

const LINK_TTL_MS = 15 * 60_000;
const COOKIE = 'oauth_state';

export type OAuthDeps = {
  pool: pg.Pool;
  cfg: Config;
  providers: { whoop: Provider; fitbit: Provider & { backfill?: (accessToken: string, userId: string, tz: string) => Promise<void> } };
};

const hmac = (payload: string, secret: string) => createHmac('sha256', secret).update(payload).digest('base64url');

export function signUserLink(slackUserId: string, secret: string, now = new Date()): string {
  const payload = `${slackUserId}.${now.getTime() + LINK_TTL_MS}`;
  return `${payload}.${hmac(payload, secret)}`;
}

export function verifyUserLink(token: string, secret: string, now = new Date()): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [id, exp, sig] = parts;
  const expected = Buffer.from(hmac(`${id}.${exp}`, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return Number(exp) >= now.getTime() ? id : null;
}

function readCookie(header: string | undefined, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

const page = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui;max-width:32rem;margin:4rem auto;text-align:center"><h1>${title}</h1><p>${body}</p></body>`;

export function oauthRouter(deps: OAuthDeps): Router {
  const router = Router();
  const providerFor = (name: string): Provider | null => {
    if (name === 'whoop') return deps.providers.whoop;
    if (name === 'fitbit' && deps.cfg.fitbitEnabled) return deps.providers.fitbit;
    return null;
  };

  router.get('/oauth/:provider/start', (req, res) => {
    const provider = providerFor(req.params.provider);
    if (!provider) return void res.status(404).send(page('not found', 'that provider is not available'));
    const u = String(req.query.u ?? '');
    if (!verifyUserLink(u, deps.cfg.slack.stateSecret)) {
      return void res.status(400).send(page('link expired', 'run <code>/approachability connect</code> in Slack for a fresh one'));
    }
    const state = newOAuthState();
    res.setHeader('Set-Cookie', `${COOKIE}=${state}.${encodeURIComponent(u)}; Path=/oauth; HttpOnly; Secure; SameSite=Lax; Max-Age=900`);
    res.redirect(302, provider.authUrl(state));
  });

  router.get('/oauth/:provider/callback', async (req, res) => {
    const provider = providerFor(req.params.provider);
    if (!provider) return void res.status(404).send(page('not found', 'that provider is not available'));
    const cookie = readCookie(req.headers.cookie, COOKIE) ?? '';
    const dot = cookie.indexOf('.');
    const state = cookie.slice(0, dot);
    const userId = dot > 0 ? verifyUserLink(decodeURIComponent(cookie.slice(dot + 1)), deps.cfg.slack.stateSecret) : null;
    if (!userId || !state || state !== req.query.state || typeof req.query.code !== 'string') {
      return void res.status(400).send(page('hmm, that didn’t work', 'run <code>/approachability connect</code> in Slack and try again'));
    }
    try {
      const tokens = await provider.exchangeCode(req.query.code);
      await saveConnection(deps.pool, userId, { provider: provider.id as ProviderId, ...tokens, issuedAt: new Date(), reauthRequired: false }, deps.cfg.tokenKey);
      if (provider.id === 'fitbit' && deps.providers.fitbit.backfill) {
        const user = await getUser(deps.pool, userId, deps.cfg.tokenKey);
        await deps.providers.fitbit.backfill(tokens.accessToken, userId, user?.tz ?? 'UTC').catch(() => {});
      }
      res.setHeader('Set-Cookie', `${COOKIE}=; Path=/oauth; Max-Age=0`);
      res.status(200).send(page('you’re connected ✨', 'head back to Slack — your vibe updates tomorrow morning'));
    } catch {
      res.status(502).send(page('the wearable didn’t answer', 'give it a minute and try <code>/approachability connect</code> again'));
    }
  });

  return router;
}
