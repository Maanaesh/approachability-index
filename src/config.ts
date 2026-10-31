import { z } from 'zod';

export type Config = {
  port: number;
  publicBaseUrl: string;
  databaseUrl: string;
  tokenKey: Buffer;
  slack: { signingSecret: string; clientId: string; clientSecret: string; stateSecret: string };
  whoop: { clientId: string; clientSecret: string };
  google: { clientId: string; clientSecret: string };
  fitbitEnabled: boolean;
  supportEmail?: string;
};

const required = (name: string) => z.string({ error: `${name} is required` }).min(1, `${name} is required`);

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_BASE_URL: required('PUBLIC_BASE_URL').url(),
  DATABASE_URL: required('DATABASE_URL'),
  TOKEN_ENCRYPTION_KEY: required('TOKEN_ENCRYPTION_KEY').refine(
    (v) => Buffer.from(v, 'base64').length === 32,
    'TOKEN_ENCRYPTION_KEY must decode to 32 bytes',
  ),
  SLACK_SIGNING_SECRET: required('SLACK_SIGNING_SECRET'),
  SLACK_CLIENT_ID: required('SLACK_CLIENT_ID'),
  SLACK_CLIENT_SECRET: required('SLACK_CLIENT_SECRET'),
  SLACK_STATE_SECRET: required('SLACK_STATE_SECRET'),
  WHOOP_CLIENT_ID: required('WHOOP_CLIENT_ID'),
  WHOOP_CLIENT_SECRET: required('WHOOP_CLIENT_SECRET'),
  GOOGLE_CLIENT_ID: required('GOOGLE_CLIENT_ID'),
  GOOGLE_CLIENT_SECRET: required('GOOGLE_CLIENT_SECRET'),
  FITBIT_ENABLED: z.enum(['true', 'false']).default('false'),
  SUPPORT_EMAIL: z.string().email().optional(),
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid config: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  const e = parsed.data;
  return {
    port: e.PORT,
    publicBaseUrl: e.PUBLIC_BASE_URL.replace(/\/$/, ''),
    databaseUrl: e.DATABASE_URL,
    tokenKey: Buffer.from(e.TOKEN_ENCRYPTION_KEY, 'base64'),
    slack: {
      signingSecret: e.SLACK_SIGNING_SECRET,
      clientId: e.SLACK_CLIENT_ID,
      clientSecret: e.SLACK_CLIENT_SECRET,
      stateSecret: e.SLACK_STATE_SECRET,
    },
    whoop: { clientId: e.WHOOP_CLIENT_ID, clientSecret: e.WHOOP_CLIENT_SECRET },
    google: { clientId: e.GOOGLE_CLIENT_ID, clientSecret: e.GOOGLE_CLIENT_SECRET },
    fitbitEnabled: e.FITBIT_ENABLED === 'true',
    supportEmail: e.SUPPORT_EMAIL,
  };
}
