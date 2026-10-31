import type { Installation, InstallationQuery, InstallationStore } from '@slack/oauth';
import type pg from 'pg';
import { decrypt, encrypt } from '../crypto.js';
import { setSlackToken, upsertUser } from '../db/users.js';

type Deps = { pool: pg.Pool; key: Buffer; lookupTz: (botToken: string, userId: string) => Promise<string> };

export async function getBotToken(pool: pg.Pool, key: Buffer): Promise<string | null> {
  const r = await pool.query('SELECT bot_token_enc FROM workspace LIMIT 1');
  return r.rows[0] ? decrypt(r.rows[0].bot_token_enc, key) : null;
}

export function installationStore({ pool, key, lookupTz }: Deps): InstallationStore {
  return {
    async storeInstallation(installation: Installation) {
      const teamId = installation.team?.id ?? installation.enterprise?.id;
      if (!teamId) throw new Error('installation without team');
      if (installation.bot?.token) {
        await pool.query(
          `INSERT INTO workspace (team_id, bot_token_enc, bot_user_id, bot_id) VALUES ($1, $2, $3, $4)
           ON CONFLICT (team_id) DO UPDATE SET bot_token_enc = $2, bot_user_id = $3, bot_id = $4`,
          [teamId, encrypt(installation.bot.token, key), installation.bot.userId, installation.bot.id],
        );
      }
      if (installation.user.token) {
        const botToken = installation.bot?.token ?? (await getBotToken(pool, key));
        const tz = botToken ? await lookupTz(botToken, installation.user.id).catch(() => 'UTC') : 'UTC';
        await upsertUser(pool, { slackUserId: installation.user.id, teamId, tz });
        await setSlackToken(pool, installation.user.id, installation.user.token, key);
      }
    },
    async fetchInstallation(query: InstallationQuery<boolean>) {
      const r = await pool.query('SELECT * FROM workspace WHERE team_id = $1', [query.teamId ?? query.enterpriseId]);
      const row = r.rows[0];
      if (!row) throw new Error('workspace not installed');
      return {
        team: { id: row.team_id },
        enterprise: undefined,
        user: { id: query.userId ?? '', token: undefined, scopes: undefined },
        bot: { id: row.bot_id, userId: row.bot_user_id, token: decrypt(row.bot_token_enc, key), scopes: [] },
        isEnterpriseInstall: false,
      } as Installation;
    },
    async deleteInstallation(query: InstallationQuery<boolean>) {
      await pool.query('DELETE FROM workspace WHERE team_id = $1', [query.teamId]);
    },
  };
}
