import type { WebClient } from '@slack/web-api';
import type { SlackStatus } from '../status/decision.js';

export interface SlackStatusClient {
  get(userToken: string): Promise<SlackStatus>;
  set(userToken: string, s: SlackStatus, expiration: number): Promise<void>;
  clear(userToken: string): Promise<void>;
  dm(slackUserId: string, text: string, blocks?: unknown[]): Promise<void>;
}

export class SlackTokenRevoked extends Error {
  name = 'SlackTokenRevoked';
}

export class InvalidStatusEmoji extends Error {
  name = 'InvalidStatusEmoji';
}

const REVOKED = new Set(['token_revoked', 'invalid_auth', 'account_inactive', 'not_authed']);

async function guard<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err: any) {
    if (REVOKED.has(err?.data?.error)) throw new SlackTokenRevoked(err.data.error);
    if (err?.data?.error === 'profile_status_set_failed_not_valid_emoji') throw new InvalidStatusEmoji(err.data.error);
    throw err;
  }
}

export function slackStatusClient(botClient: WebClient): SlackStatusClient {
  const setProfile = (token: string, emoji: string, text: string, expiration: number) =>
    guard(() => botClient.users.profile.set({ token, profile: { status_emoji: emoji, status_text: text, status_expiration: expiration } as any }));

  return {
    async get(token) {
      const r = await guard(() => botClient.users.profile.get({ token }));
      return { emoji: r.profile?.status_emoji ?? '', text: r.profile?.status_text ?? '' };
    },
    async set(token, s, expiration) {
      await setProfile(token, `:${s.emoji.replace(/^:|:$/g, '')}:`, s.text, expiration);
    },
    async clear(token) {
      await setProfile(token, '', '', 0);
    },
    async dm(slackUserId, text, blocks) {
      await botClient.chat.postMessage({ channel: slackUserId, text, ...(blocks ? { blocks: blocks as any } : {}) });
    },
  };
}
