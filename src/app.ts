import bolt from '@slack/bolt';
import { WebClient } from '@slack/web-api';
import type { RunDeps } from './runner/runUser.js';
import { oauthRouter, type OAuthDeps } from './oauth/routes.js';
import { registerCommands } from './slack/commands.js';
import { installationStore } from './slack/installStore.js';

const { App, ExpressReceiver } = bolt;

export const BOT_SCOPES = ['commands', 'chat:write', 'users:read', 'emoji:read'];
export const USER_SCOPES = ['users.profile:read', 'users.profile:write'];

export type AppDeps = RunDeps & { providers: OAuthDeps['providers'] };

export function buildApp(deps: AppDeps) {
  const { cfg, pool } = deps;
  const receiver = new ExpressReceiver({
    signingSecret: cfg.slack.signingSecret,
    clientId: cfg.slack.clientId,
    clientSecret: cfg.slack.clientSecret,
    stateSecret: cfg.slack.stateSecret,
    scopes: BOT_SCOPES,
    installerOptions: { userScopes: USER_SCOPES, directInstall: true },
    installationStore: installationStore({
      pool,
      key: cfg.tokenKey,
      lookupTz: async (botToken, userId) => (await new WebClient(botToken).users.info({ user: userId })).user?.tz ?? 'UTC',
    }),
  });
  receiver.router.use(oauthRouter({ pool, cfg, providers: deps.providers }));
  receiver.router.get('/healthz', (_req, res) => void res.send('ok'));
  const app = new App({ receiver });
  const commandDeps = { ...deps, revokeSlackToken: async (token: string) => void (await new WebClient(token).auth.revoke()) };
  registerCommands(app, commandDeps);
  return { app, receiver, commandDeps };
}
