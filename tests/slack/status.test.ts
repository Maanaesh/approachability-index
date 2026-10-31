import { describe, expect, it, vi } from 'vitest';
import { slackStatusClient, SlackTokenRevoked } from '../../src/slack/status.js';

function fakeClient(over: Record<string, any> = {}) {
  return {
    users: { profile: { set: vi.fn(async () => ({ ok: true })), get: vi.fn(async () => ({ ok: true, profile: { status_emoji: ':palm_tree:', status_text: 'on vacation' } })) } },
    chat: { postMessage: vi.fn(async () => ({ ok: true })) },
    ...over,
  } as any;
}
const slackError = (code: string) => Object.assign(new Error(code), { code: 'slack_webapi_platform_error', data: { ok: false, error: code } });

describe('slackStatusClient', () => {
  it('sets status with the user token, colon-wrapped emoji and expiration', async () => {
    const c = fakeClient();
    await slackStatusClient(c).set('xoxp-u', { emoji: 'sparkles', text: 'hi' }, 1234);
    expect(c.users.profile.set).toHaveBeenCalledWith({ token: 'xoxp-u', profile: { status_emoji: ':sparkles:', status_text: 'hi', status_expiration: 1234 } });
  });

  it('gets status back as SlackStatus', async () => {
    expect(await slackStatusClient(fakeClient()).get('xoxp-u')).toEqual({ emoji: ':palm_tree:', text: 'on vacation' });
  });

  it('clears status', async () => {
    const c = fakeClient();
    await slackStatusClient(c).clear('xoxp-u');
    expect(c.users.profile.set).toHaveBeenCalledWith({ token: 'xoxp-u', profile: { status_emoji: '', status_text: '', status_expiration: 0 } });
  });

  it.each(['token_revoked', 'invalid_auth', 'account_inactive'])('%s throws SlackTokenRevoked', async (code) => {
    const c = fakeClient();
    c.users.profile.get.mockRejectedValueOnce(slackError(code));
    await expect(slackStatusClient(c).get('xoxp-u')).rejects.toBeInstanceOf(SlackTokenRevoked);
  });

  it('other Slack errors are rethrown as-is', async () => {
    const c = fakeClient();
    c.users.profile.set.mockRejectedValueOnce(slackError('ratelimited'));
    await expect(slackStatusClient(c).set('x', { emoji: 'a', text: 'b' }, 1)).rejects.not.toBeInstanceOf(SlackTokenRevoked);
  });

  it('DMs the user via chat.postMessage', async () => {
    const c = fakeClient();
    await slackStatusClient(c).dm('U1', 'hello', [{ type: 'section' }]);
    expect(c.chat.postMessage).toHaveBeenCalledWith({ channel: 'U1', text: 'hello', blocks: [{ type: 'section' }] });
  });
});
