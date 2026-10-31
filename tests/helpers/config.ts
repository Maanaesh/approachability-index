import type { Config } from '../../src/config.js';
import { testKey } from './db.js';

export const testConfig = (over: Partial<Config> = {}): Config => ({
  port: 3000,
  publicBaseUrl: 'https://app.test',
  databaseUrl: process.env.TEST_DATABASE_URL!,
  tokenKey: testKey,
  slack: { signingSecret: 'sig', clientId: 'sc', clientSecret: 'ss', stateSecret: 'state' },
  whoop: { clientId: 'wc', clientSecret: 'ws' },
  google: { clientId: 'gc', clientSecret: 'gs' },
  fitbitEnabled: true,
  ...over,
});
