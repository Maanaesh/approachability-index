// Runs one scheduler tick immediately against the configured database (for the manual E2E check).
// Usage: npx tsx scripts/tick-now.ts
import { WebClient } from '@slack/web-api';
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db/pool.js';
import { loadLibrary } from '../src/lines/library.js';
import { createLogger } from '../src/log.js';
import { fitbitProvider } from '../src/providers/fitbit.js';
import { whoopProvider } from '../src/providers/whoop.js';
import { tick } from '../src/runner/tick.js';
import { getBotToken } from '../src/slack/installStore.js';
import { slackStatusClient } from '../src/slack/status.js';

const cfg = loadConfig();
const pool = createPool(cfg.databaseUrl);
const botToken = await getBotToken(pool, cfg.tokenKey);
if (!botToken) throw new Error('install the Slack app first');
await tick(new Date(), {
  pool,
  cfg,
  log: createLogger(),
  slack: slackStatusClient(new WebClient(botToken)),
  library: loadLibrary(),
  rng: Math.random,
  providers: { whoop: whoopProvider(cfg), fitbit: fitbitProvider(cfg, { pool }) },
});
await pool.end();
