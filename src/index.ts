import { WebClient } from '@slack/web-api';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { pruneMetrics } from './db/metrics.js';
import { migrate } from './db/migrate.js';
import { createPool } from './db/pool.js';
import { loadLibrary } from './lines/library.js';
import { createLogger } from './log.js';
import { fitbitProvider } from './providers/fitbit.js';
import { whoopProvider } from './providers/whoop.js';
import type { RunDeps } from './runner/runUser.js';
import { tick } from './runner/tick.js';
import { getBotTokenForUser } from './slack/installStore.js';
import { teamSlackClient } from './slack/teamClient.js';

const TICK_MS = 5 * 60_000;
const METRICS_RETENTION_DAYS = 35;

const cfg = loadConfig();
const pool = createPool(cfg.databaseUrl);
await migrate(pool);
const log = createLogger();

const slack = teamSlackClient(pool, cfg.tokenKey);

const deps: RunDeps & { providers: { whoop: ReturnType<typeof whoopProvider>; fitbit: ReturnType<typeof fitbitProvider> } } = {
  pool,
  cfg,
  log,
  slack,
  library: loadLibrary(),
  rng: Math.random,
  providers: { whoop: whoopProvider(cfg), fitbit: fitbitProvider(cfg, { pool }) },
  lookupTz: async (userId) => {
    const token = await getBotTokenForUser(pool, cfg.tokenKey, userId);
    if (!token) throw new Error('workspace not installed');
    const tz = (await new WebClient(token).users.info({ user: userId })).user?.tz;
    if (!tz) throw new Error('no tz');
    return tz;
  },
};

const { app } = buildApp(deps);
await app.start(cfg.port);
log.info('started', { slackUserId: '-' });

let running = false;
async function safeTick() {
  if (running) return;
  running = true;
  try {
    await tick(new Date(), deps);
    const cutoff = new Date(Date.now() - METRICS_RETENTION_DAYS * 86_400_000).toISOString().slice(0, 10);
    await pruneMetrics(pool, cutoff);
  } catch (err) {
    log.info('tick_error', { slackUserId: '-', reason: err instanceof Error ? err.name : 'unknown' });
  } finally {
    running = false;
  }
}
setInterval(safeTick, TICK_MS);
void safeTick();
