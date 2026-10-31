import { listSchedulable, setTzChecked } from '../db/users.js';
import { runUser, type RunDeps } from './runUser.js';

const TZ_REFRESH_MS = 12 * 3600_000;

// Users run one after another: team-sized, and it keeps provider rate limits comfortable.
export async function tick(now: Date, deps: RunDeps): Promise<void> {
  for (const user of await listSchedulable(deps.pool, deps.cfg.tokenKey)) {
    try {
      if (deps.lookupTz && (!user.tzCheckedAt || now.getTime() - user.tzCheckedAt.getTime() >= TZ_REFRESH_MS)) {
        const tz = await deps.lookupTz(user.slackUserId).catch(() => null);
        await setTzChecked(deps.pool, user.slackUserId, tz, now);
        if (tz) user.tz = tz;
      }
      await runUser(user, now, deps);
    } catch (err) {
      deps.log.info('tick_user_error', { slackUserId: user.slackUserId, reason: err instanceof Error ? err.name : 'unknown' });
    }
  }
}
