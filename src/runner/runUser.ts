import type pg from 'pg';
import { FALLBACK, findBand, type Band } from '../bands.js';
import type { Config } from '../config.js';
import { getBag, saveBag } from '../db/bags.js';
import { getConnection } from '../db/connections.js';
import { getPrefs, type Prefs } from '../db/prefs.js';
import { finishRun, getRun, recordAttempt } from '../db/runs.js';
import { setInactive, setLastSetStatus, setReconnectNotified, type User } from '../db/users.js';
import { linesFor, pickEmoji, type Library, type LineBand } from '../lines/library.js';
import { drawFromBag } from '../lines/shuffle.js';
import type { Logger } from '../log.js';
import { needsReconnectReminder } from '../providers/fitbit.js';
import { withFreshToken } from '../providers/tokens.js';
import type { Provider, ProviderId, ScoreResult } from '../providers/types.js';
import { endOfLocalDay, isPollDue, schedulePhase } from '../schedule.js';
import { SlackTokenRevoked, type SlackStatusClient } from '../slack/status.js';
import { canWriteStatus, type SlackStatus } from '../status/decision.js';
import { reconnectMessage } from './copy.js';

export type RunDeps = {
  pool: pg.Pool;
  providers: Record<ProviderId, Provider>;
  slack: SlackStatusClient;
  library: Library;
  rng: () => number;
  log: Logger;
  cfg: Config;
};

export type RunResult = 'set' | 'skipped_manual' | 'fallback' | 'error' | 'waiting' | 'not_due';

// Reasons that won't improve by polling again today.
const FINAL_REASONS = new Set(['unscorable', 'reauth_required', 'insufficient_history']);
const CUSTOM_PREFIX = 'custom:';

async function pickStatus(deps: RunDeps, user: User, prefs: Prefs, band: Band | null): Promise<SlackStatus> {
  const { library: lib } = deps;
  const tone: LineBand = band?.tone ?? 'fallback';
  const bagKey = band?.key ?? FALLBACK.key;
  let libraryLines = linesFor(lib, tone, prefs.packIds);
  const custom = prefs.customLines.filter((l) => l.bandKey === bagKey);
  if (libraryLines.length === 0 && custom.length === 0) libraryLines = linesFor(lib, tone, lib.packs.map((p) => p.id));
  const pool = [...libraryLines.map((l) => l.id), ...custom.map((l) => `${CUSTOM_PREFIX}${l.id}`)];

  const { lineId, bag } = drawFromBag(await getBag(deps.pool, user.slackUserId, bagKey), pool, deps.rng);
  await saveBag(deps.pool, user.slackUserId, bagKey, bag);

  if (lineId.startsWith(CUSTOM_PREFIX)) {
    const line = custom.find((l) => `${CUSTOM_PREFIX}${l.id}` === lineId)!;
    return { emoji: band?.emoji ?? FALLBACK.emoji, text: line.text };
  }
  const line = libraryLines.find((l) => l.id === lineId)!;
  return { emoji: pickEmoji(line, lib, deps.rng), text: line.text };
}

export async function runUser(user: User, now: Date, deps: RunDeps): Promise<RunResult> {
  const id = user.slackUserId;
  const { phase, localDate } = schedulePhase(now, user.tz);
  if (phase === 'before') return 'not_due';
  const run = await getRun(deps.pool, id, localDate);
  if (run?.outcome) return 'not_due';
  if (phase === 'polling' && !isPollDue(now, run?.lastAttemptAt ?? null)) return 'not_due';

  const conn = await getConnection(deps.pool, id, deps.cfg.tokenKey);
  if (!conn || !user.slackUserToken) return 'not_due';
  const provider = deps.providers[conn.provider];
  const log = (event: string, extra: { bandKey?: string; outcome?: string; reason?: string }) =>
    deps.log.info(event, { slackUserId: id, provider: conn.provider, ...extra });

  try {
    await recordAttempt(deps.pool, id, localDate, now);

    let notifiedThisConnection = user.reconnectNotifiedAt != null && user.reconnectNotifiedAt >= conn.issuedAt;
    const sendReconnect = async () => {
      if (notifiedThisConnection) return;
      notifiedThisConnection = true;
      const msg = reconnectMessage(conn.provider);
      await deps.slack.dm(id, msg.text, msg.blocks);
      await setReconnectNotified(deps.pool, id, now);
      log('reconnect_dm', { reason: conn.provider === 'fitbit' ? 'weekly' : 'reauth' });
    };
    if (conn.provider === 'fitbit' && needsReconnectReminder(conn.issuedAt, now)) await sendReconnect();

    const res = await withFreshToken(deps.pool, id, provider, deps.cfg.tokenKey, (token) =>
      provider.getTodayScore(token, { userId: id, localDate, tz: user.tz }),
    );
    const result: ScoreResult = 'reauth' in res ? { score: null, reason: 'reauth_required' } : res;
    if (result.reason === 'reauth_required') await sendReconnect();

    const prefs = await getPrefs(deps.pool, id, deps.library.packs.map((p) => p.id));
    let band: Band | null = null;
    if (result.score != null) {
      band = findBand(prefs.bands, result.score);
    } else if (phase === 'polling' && !FINAL_REASONS.has(result.reason)) {
      log('run_waiting', { reason: result.reason });
      return 'waiting';
    }

    const current = await deps.slack.get(user.slackUserToken);
    if (!canWriteStatus(current, user.lastSetStatus)) {
      await finishRun(deps.pool, id, localDate, 'skipped_manual', band?.key ?? null);
      log('run_done', { outcome: 'skipped_manual', bandKey: band?.key ?? FALLBACK.key });
      return 'skipped_manual';
    }

    const status = await pickStatus(deps, user, prefs, band);
    await deps.slack.set(user.slackUserToken, status, endOfLocalDay(now, user.tz));
    await setLastSetStatus(deps.pool, id, status);
    const outcome = band ? 'set' : 'fallback';
    await finishRun(deps.pool, id, localDate, outcome, band?.key ?? FALLBACK.key);
    log('run_done', { outcome, bandKey: band?.key ?? FALLBACK.key, reason: result.reason });
    return outcome;
  } catch (err) {
    if (err instanceof SlackTokenRevoked) {
      await setInactive(deps.pool, id);
      await finishRun(deps.pool, id, localDate, 'error', null);
      log('slack_token_revoked', { outcome: 'error' });
      return 'error';
    }
    log('run_error', { reason: err instanceof Error ? err.name : 'unknown' });
    return 'error';
  }
}
