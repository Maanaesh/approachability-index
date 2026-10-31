# Approachability Index

A Slack app that sets each teammate's Slack status to today's vibe, based on their WHOOP recovery or a readiness score computed from Fitbit. **Teammates only see the vibe, never the score.**

- Rotates through 1,000+ reviewed, workplace-safe status lines in 7 themed packs, with no repeats (shuffle bag per user and band).
- Never overwrites a status you set yourself.
- Statuses expire at 23:59 your local time.
- Shows a neutral fallback vibe if there's no score by 11:00.

Design: `docs/superpowers/specs/2026-10-31-approachability-slack-status-design.md`

## Commands

`/approachability connect | settings | status | pause | resume | disconnect | help`

## Setup

1. Run the checks in `docs/preflight.md` (Google Health API access and the WHOOP app). Keep `FITBIT_ENABLED=false` until Google access is confirmed.
2. Create the Slack app from `slack-manifest.yml`, replacing `YOUR_PUBLIC_BASE_URL`.
3. Copy `.env.example` to `.env` and fill it in. Generate the key with `openssl rand -base64 32`.
4. Deploy:
   - Docker: `docker build -t approachability . && docker run --env-file .env -p 3000:3000 approachability`
   - Or locally: `npm ci && npm run build && npm start`

   Migrations run on start.
5. Install the app to the workspace by visiting `${PUBLIC_BASE_URL}/slack/install`.
6. Before inviting the team, get `docs/library-review.md` signed off.

## Development

```bash
npm ci
docker compose up -d db           # or any Postgres on port 54329
npm test                          # unit + integration tests
LIBRARY_FULL=1 npx vitest run tests/content   # full library size check
npx tsx scripts/sample-lines.ts 20             # sample status lines
npx tsx scripts/tick-now.ts                    # run one scheduler tick now
```
