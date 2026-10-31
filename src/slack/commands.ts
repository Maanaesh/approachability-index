import type { App } from '@slack/bolt';
import { findBand } from '../bands.js';
import { getConnection } from '../db/connections.js';
import { getPrefs } from '../db/prefs.js';
import { deleteUserCascade, getUser, setLastSetStatus, setPaused, type User } from '../db/users.js';
import { signUserLink } from '../oauth/routes.js';
import { withFreshToken } from '../providers/tokens.js';
import type { ProviderId, ScoreResult } from '../providers/types.js';
import type { RunDeps } from '../runner/runUser.js';
import { schedulePhase } from '../schedule.js';
import { canWriteStatus } from '../status/decision.js';

export type CommandDeps = RunDeps & { revokeSlackToken: (userToken: string) => Promise<void>; fetchFn?: typeof fetch };
export type CommandResponse = { response_type: 'ephemeral'; text: string; blocks?: unknown[] };

const NAMES: Record<ProviderId, string> = { whoop: 'WHOOP', fitbit: 'Fitbit' };
const HELP = [
  '*/approachability* — your vibe, never your score ✨',
  '• `connect` — link Slack and your WHOOP or Fitbit',
  '• `settings` — bands, packs and your own lines',
  '• `status` — see today’s vibe (and your score, only for you)',
  '• `pause` / `resume` — take a break from auto-updates',
  '• `disconnect` — remove everything',
].join('\n');

const reply = (text: string, blocks?: unknown[]): CommandResponse => ({ response_type: 'ephemeral', text, ...(blocks ? { blocks } : {}) });
const linkButton = (text: string, url: string, primary = false) => ({
  type: 'button', text: { type: 'plain_text', text }, url, ...(primary ? { style: 'primary' } : {}),
});

export function connectButtons(userId: string, deps: CommandDeps, only?: ProviderId): unknown[] {
  const { cfg } = deps;
  const u = encodeURIComponent(signUserLink(userId, cfg.slack.stateSecret));
  const providers: ProviderId[] = only ? [only] : cfg.fitbitEnabled ? ['whoop', 'fitbit'] : ['whoop'];
  return [{ type: 'actions', elements: providers.map((p) => linkButton(`Connect ${NAMES[p]}`, `${cfg.publicBaseUrl}/oauth/${p}/start?u=${u}`, true)) }];
}

async function clearIfOurs(user: User, deps: CommandDeps): Promise<void> {
  if (!user.slackUserToken || !user.lastSetStatus) return;
  const current = await deps.slack.get(user.slackUserToken);
  if (canWriteStatus(current, user.lastSetStatus)) await deps.slack.clear(user.slackUserToken);
  await setLastSetStatus(deps.pool, user.slackUserId, null);
}

async function status(user: User, deps: CommandDeps): Promise<CommandResponse> {
  const conn = await getConnection(deps.pool, user.slackUserId, deps.cfg.tokenKey);
  if (!conn) return reply('not connected yet — run `/approachability connect` 🔌');
  const provider = deps.providers[conn.provider];
  const { localDate } = schedulePhase(new Date(), user.tz);
  const res = await withFreshToken(deps.pool, user.slackUserId, provider, deps.cfg.tokenKey, (t) =>
    provider.getTodayScore(t, { userId: user.slackUserId, localDate, tz: user.tz }),
  );
  const result: ScoreResult = 'reauth' in res ? { score: null, reason: 'reauth_required' } : res;
  const state = user.paused ? 'paused ⏸️' : 'active';
  if (result.score == null) {
    const why = result.reason === 'reauth_required' ? 'reconnect needed' : result.reason.replace(/_/g, ' ');
    return reply(`🤷 no vibe yet today (${why}) · via ${NAMES[conn.provider]} · ${state}`);
  }
  const prefs = await getPrefs(deps.pool, user.slackUserId, deps.library.packs.map((p) => p.id));
  const band = findBand(prefs.bands, result.score);
  return reply(`:${band.emoji}: *${band.label}* · via ${NAMES[conn.provider]} · ${state}\nyour score today: ${Math.round(result.score)} — only you can see this 👀`);
}

export async function handleCommand(text: string, ctx: { userId: string }, deps: CommandDeps): Promise<CommandResponse> {
  const sub = text.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  const user = await getUser(deps.pool, ctx.userId, deps.cfg.tokenKey);

  if (sub === 'connect') {
    if (!user?.slackUserToken) {
      return reply('first, let me set your Slack status 🔑', [
        { type: 'section', text: { type: 'mrkdwn', text: 'first, let me set your Slack status 🔑 then run `/approachability connect` again.' } },
        { type: 'actions', elements: [linkButton('Authorize Slack', `${deps.cfg.publicBaseUrl}/slack/install`, true)] },
      ]);
    }
    return reply('pick your wearable ⌚', [{ type: 'section', text: { type: 'mrkdwn', text: 'pick your wearable ⌚ (links work for 15 minutes)' } }, ...connectButtons(ctx.userId, deps)]);
  }
  if (sub === 'help' || (sub !== '' && !['status', 'pause', 'resume', 'disconnect'].includes(sub))) return reply(HELP);
  if (!user) return reply('you’re not set up yet — run `/approachability connect` ✨');

  switch (sub) {
    case '':
    case 'status':
      return status(user, deps);
    case 'pause':
      await setPaused(deps.pool, user.slackUserId, true);
      await clearIfOurs(user, deps);
      return reply('paused ⏸️ your status is yours again. `/approachability resume` when you’re ready.');
    case 'resume':
      await setPaused(deps.pool, user.slackUserId, false);
      return reply('back on ▶️ your vibe updates tomorrow morning.');
    case 'disconnect': {
      await clearIfOurs(user, deps);
      const conn = await getConnection(deps.pool, user.slackUserId, deps.cfg.tokenKey);
      if (conn?.provider === 'fitbit') {
        await (deps.fetchFn ?? fetch)(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(conn.refreshToken)}`, { method: 'POST' }).catch(() => {});
      }
      if (user.slackUserToken) await deps.revokeSlackToken(user.slackUserToken).catch(() => {});
      await deleteUserCascade(deps.pool, user.slackUserId);
      return reply('disconnected 👋 all your data is gone. come back anytime.');
    }
  }
  return reply(HELP);
}

export function registerCommands(
  app: App,
  deps: CommandDeps,
  openSettings?: (args: { triggerId: string; userId: string; client: any }) => Promise<void>,
): void {
  app.command('/approachability', async ({ ack, command, respond, client }) => {
    await ack();
    if (command.text.trim().toLowerCase().startsWith('settings') && openSettings) {
      await openSettings({ triggerId: command.trigger_id, userId: command.user_id, client });
      return;
    }
    await respond(await handleCommand(command.text, { userId: command.user_id }, deps));
  });

  app.action(/^reconnect_(whoop|fitbit)$/, async ({ ack, body, action, respond }) => {
    await ack();
    const provider = (action as { action_id: string }).action_id.replace('reconnect_', '') as ProviderId;
    await respond({
      response_type: 'ephemeral',
      replace_original: false,
      text: 'here’s a fresh link ✨',
      blocks: connectButtons(body.user.id, deps, provider) as any[],
    });
  });
}
