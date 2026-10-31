import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const key = Buffer.alloc(32, 7).toString('base64');
const base = {
  PUBLIC_BASE_URL: 'https://x.test',
  DATABASE_URL: 'postgres://x',
  TOKEN_ENCRYPTION_KEY: key,
  SLACK_SIGNING_SECRET: 's',
  SLACK_CLIENT_ID: 'c',
  SLACK_CLIENT_SECRET: 'cs',
  SLACK_STATE_SECRET: 'st',
  WHOOP_CLIENT_ID: 'w',
  WHOOP_CLIENT_SECRET: 'ws',
  GOOGLE_CLIENT_ID: 'g',
  GOOGLE_CLIENT_SECRET: 'gs',
};

describe('loadConfig', () => {
  it('throws naming TOKEN_ENCRYPTION_KEY when missing', () => {
    const { TOKEN_ENCRYPTION_KEY, ...env } = base;
    expect(() => loadConfig(env)).toThrow(/TOKEN_ENCRYPTION_KEY/);
  });

  it('throws when the key is not 32 bytes', () => {
    expect(() => loadConfig({ ...base, TOKEN_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') })).toThrow(/32 bytes/);
  });

  it('defaults fitbitEnabled to false and port to 3000', () => {
    const cfg = loadConfig(base);
    expect(cfg.fitbitEnabled).toBe(false);
    expect(cfg.port).toBe(3000);
    expect(cfg.tokenKey.length).toBe(32);
  });

  it('reads FITBIT_ENABLED=true', () => {
    expect(loadConfig({ ...base, FITBIT_ENABLED: 'true' }).fitbitEnabled).toBe(true);
  });
});
