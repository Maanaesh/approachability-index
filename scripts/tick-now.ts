// Runs one scheduler tick immediately against the configured database (for the manual E2E check).
// Usage: npx tsx scripts/tick-now.ts
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db/pool.js';
import { loadLibrary } from '../src/lines/library.js';
import { createLogger } from '../src/log.js';
import { fitbitProvider } from '../src/providers/fitbit.js';
import { whoopProvider } from '../src/providers/whoop.js';
import { tick } from '../src/runner/tick.js';
import { teamSlackClient } from '../src/slack/teamClient.js';

const cfg = loadConfig();
const pool = createPool(cfg.databaseUrl);
await tick(new Date(), {
  pool,
  cfg,
  log: createLogger(),
  slack: teamSlackClient(pool, cfg.tokenKey),
  library: loadLibrary(),
  rng: Math.random,
  providers: { whoop: whoopProvider(cfg), fitbit: fitbitProvider(cfg, { pool }) },
});
await pool.end();
