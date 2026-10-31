import type { App } from '@slack/bolt';
import type pg from 'pg';
import { clearSlackToken, setInactive } from '../db/users.js';

// Uninstalling the app removes the workspace and every user's data in it (rows cascade from users).
export async function handleAppUninstalled(pool: pg.Pool, teamId: string): Promise<void> {
  await pool.query('DELETE FROM users WHERE team_id = $1', [teamId]);
  await pool.query('DELETE FROM workspace WHERE team_id = $1', [teamId]);
}

export async function handleTokensRevoked(pool: pg.Pool, teamId: string, tokens: { oauth?: string[]; bot?: string[] }): Promise<void> {
  for (const userId of tokens.oauth ?? []) {
    await clearSlackToken(pool, userId);
    await setInactive(pool, userId);
  }
  if (tokens.bot?.length) await pool.query('DELETE FROM workspace WHERE team_id = $1', [teamId]);
}

export function registerLifecycle(app: App, pool: pg.Pool): void {
  app.event('app_uninstalled', async ({ context }) => {
    if (context.teamId) await handleAppUninstalled(pool, context.teamId);
  });
  app.event('tokens_revoked', async ({ event, context }) => {
    if (context.teamId) await handleTokensRevoked(pool, context.teamId, event.tokens);
  });
}
