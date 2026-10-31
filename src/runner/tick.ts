import { listSchedulable } from '../db/users.js';
import { runUser, type RunDeps } from './runUser.js';

// Users run one after another: team-sized, and it keeps provider rate limits comfortable.
export async function tick(now: Date, deps: RunDeps): Promise<void> {
  for (const user of await listSchedulable(deps.pool, deps.cfg.tokenKey)) {
    try {
      await runUser(user, now, deps);
    } catch (err) {
      deps.log.info('tick_user_error', { slackUserId: user.slackUserId, reason: err instanceof Error ? err.name : 'unknown' });
    }
  }
}
