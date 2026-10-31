import { WebClient } from '@slack/web-api';
import type pg from 'pg';
import { getBotTokenForUser } from './installStore.js';
import { slackStatusClient, type SlackStatusClient } from './status.js';

// Status calls carry the user's own token; DMs need the bot token of the user's workspace.
export function teamSlackClient(
  pool: pg.Pool,
  key: Buffer,
  makeClient: (token?: string) => WebClient = (token) => new WebClient(token),
): SlackStatusClient {
  const anon = slackStatusClient(makeClient());
  return {
    get: (t) => anon.get(t),
    set: (t, s, e) => anon.set(t, s, e),
    clear: (t) => anon.clear(t),
    async dm(slackUserId, text, blocks) {
      const token = await getBotTokenForUser(pool, key, slackUserId);
      if (!token) throw new Error(`workspace not installed for ${slackUserId}`);
      await slackStatusClient(makeClient(token)).dm(slackUserId, text, blocks);
    },
  };
}
