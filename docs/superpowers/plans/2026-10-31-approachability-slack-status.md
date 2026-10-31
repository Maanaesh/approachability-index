# Approachability Slack Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A self-hosted Slack app that sets each opted-in teammate's Slack status, once a day, to a rotating, workplace-safe, Gen Z emoji and line of text chosen from the band their WHOOP recovery (or computed Fitbit score) falls in. It never shows the score.

**Architecture:** One Node/TypeScript process runs Slack Bolt in HTTP mode, with an Express receiver for the Slack, WHOOP and Google OAuth callbacks, and an in-process scheduler that ticks every 5 minutes. Pure modules (bands, score, shuffle bag, schedule, manual-status decision) hold all the logic and are unit-tested. Providers and Slack sit behind small interfaces so the per-user runner can be tested with fakes. Postgres stores users, encrypted tokens, band config, shuffle bags and run outcomes.

**Tech Stack:**
- Node 20+, TypeScript (strict, ESM), `@slack/bolt`
- `pg` with plain SQL migrations (`node-pg-migrate`)
- `luxon` for timezones, `zod` for config and validation
- `vitest` for tests, with `undici` `MockAgent` for HTTP fixtures
- `emoji-datasource` for valid Slack emoji names
- Docker and docker-compose

**Spec:** `docs/superpowers/specs/2026-10-31-approachability-slack-status-design.md`

## Global Constraints

- The score, percentages and raw metrics (HRV, resting heart rate, sleep) never appear in a status, a channel message, a DM to anyone else, or logs. Log only `slackUserId`, `provider`, `bandKey`, `outcome`, `reason`.
- Never overwrite a status the user set themselves (see Task 7).
- Status text is at most 100 characters. Status lines from the library contain no digits and no `%`.
- Every status is set with `status_expiration` = 23:59:00 in the user's local timezone.
- Schedule (user's local time): poll every 30 min from 06:00 to before 11:00. At or after 11:00 with no score, use the fallback.
- WHOOP:
  - auth `https://api.prod.whoop.com/oauth/oauth2/auth`, token `https://api.prod.whoop.com/oauth/oauth2/token`
  - scopes `read:recovery read:cycles offline`; `state` is exactly 8 characters
  - data `GET https://api.prod.whoop.com/developer/v2/recovery`
- Google Health:
  - scopes `https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly` and `https://www.googleapis.com/auth/googlehealth.sleep.readonly`, with `access_type=offline` and `prompt=consent`
  - data `GET https://health.googleapis.com/v4/users/me/dataTypes/{type}/dataPoints`
  - never use the legacy Fitbit Web API
- Slack: user scopes `users.profile:read users.profile:write`; bot scopes `commands chat:write users:read emoji:read`.
- Tokens are encrypted at rest with AES-256-GCM, using the key from `TOKEN_ENCRYPTION_KEY` (32 bytes, base64).
- WHOOP scores are never stored. `fitbit_metrics` rows older than 35 days are deleted.
- Fitbit is behind `FITBIT_ENABLED` (default `false` until Task 0 passes).
- Copy tone: quirky, Gen Z, workplace-appropriate, kind. Nothing medical, about bodies, alcohol, swearing or innuendo.

## Review Focus

1. **Half-hour and DST timezones.** A user in `Asia/Kolkata` (+05:30), or in `America/New_York` on the day the clocks change, should get polling at 06:00 local and an expiration at 23:59 local, not shifted by the offset. Tests in Task 6.
2. **Concurrent WHOOP token refresh.** If two ticks or a command refresh at once, the rotated refresh token must not be lost. Refresh runs single-flight per user inside a `SELECT … FOR UPDATE` transaction. Test in Task 9.
3. **Slack echoing our status back slightly differently.** Slack can return `:sparkles:` where we sent `sparkles`, or trim whitespace. That must still count as "ours"; otherwise the app would skip everyone forever. Test in Task 7.
4. **Band boundaries and fractional scores.** WHOOP can return `66.5`. A score is rounded half-up before band lookup: 33 → low, 34 → mid, 66 → mid, 67 → high, 66.5 → high. Test in Task 2.
5. **Library edits under existing bags.** A line removed from the library while it sits in a user's bag is skipped. A fully stale bag refills from the current pool without crashing or repeating the last line. Test in Task 5.

**Builder's call, not in the spec, flagged for the user:** user bands are configurable (2–5), but library lines are tagged `high | mid | low | fallback`. Each user band therefore has a `tone: 'high' | 'mid' | 'low'` that picks which library pool it draws from. The defaults map one-to-one, and a band added in settings chooses its tone.

---

### Task 0: Pre-flight — confirm Google Health API access (manual)

**Files:**
- Create: `docs/preflight.md`

- [ ] **Step 1:** In Google Cloud Console, create the project, enable the **Google Health API**, configure the OAuth consent screen as **External / Testing**, add the team's personal Google accounts as test users, and add both scopes from Global Constraints.
- [ ] **Step 2:** Use the OAuth Playground with your own client to authorize both scopes, then call `GET https://health.googleapis.com/v4/users/me/dataTypes/daily-resting-heart-rate/dataPoints?pageSize=5`.
  Pass: HTTP 200 with `dataPoints`. Fail: scope refused, or 403.
- [ ] **Step 3:** Record the result, the date and the exact error (if any) in `docs/preflight.md`. On a pass, the deployment sets `FITBIT_ENABLED=true`. On a fail, keep it `false` and continue; WHOOP ships alone.
- [ ] **Step 4:** In the WHOOP Developer Dashboard, create the app with the redirect `${PUBLIC_BASE_URL}/oauth/whoop/callback` and record the client ID in your secrets store (not in git).
- [ ] **Step 5:** Commit `docs/preflight.md`.

---

### Task 1: Project scaffold, config and token crypto

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.env.example`, `docker-compose.yml` (Postgres 16 for dev and test), `src/config.ts`, `src/crypto.ts`
- Test: `tests/config.test.ts`, `tests/crypto.test.ts`

**Interfaces:**
- Produces:
  - `loadConfig(env?: NodeJS.ProcessEnv): Config`
  - `Config = { port: number; publicBaseUrl: string; databaseUrl: string; tokenKey: Buffer; slack: { signingSecret; clientId; clientSecret; stateSecret }; whoop: { clientId; clientSecret }; google: { clientId; clientSecret }; fitbitEnabled: boolean }`
  - `encrypt(plain: string, key: Buffer): string` → `base64(iv|tag|ciphertext)`
  - `decrypt(blob: string, key: Buffer): string`

- [ ] **Step 1: Write failing tests**
  - `loadConfig` throws, naming the variable, when `TOKEN_ENCRYPTION_KEY` is missing.
  - It throws when the key doesn't decode to 32 bytes.
  - `fitbitEnabled` defaults to `false`.
  - `decrypt(encrypt('tok', k), k) === 'tok'`.
  - Encrypting twice gives two different blobs (random IV).
  - `decrypt` throws on a tampered blob and on the wrong key.
- [ ] **Step 2:** Run `npx vitest run tests/config.test.ts tests/crypto.test.ts`. Expected: FAIL (modules missing).
- [ ] **Step 3:** Implement `src/config.ts` with a zod schema over env. Implement `src/crypto.ts` with `node:crypto` `aes-256-gcm`, a 12-byte IV and a 16-byte tag. `.env.example` lists every variable from the spec's Configuration section plus `SLACK_STATE_SECRET` and `FITBIT_ENABLED`.
- [ ] **Step 4:** Run the tests again. Expected: PASS. Also run `npx tsc --noEmit`. Expected: no errors.
- [ ] **Step 5:** Commit: `chore: scaffold project, config, token crypto`.

---

### Task 2: Bands

**Files:**
- Create: `src/bands.ts`
- Test: `tests/bands.test.ts`

**Interfaces:**
- Produces:
  - `type Tone = 'high' | 'mid' | 'low'`
  - `type Band = { key: string; label: string; min: number; max: number; tone: Tone; emoji: string }`
  - `DEFAULT_BANDS: Band[]`: `high` 67–100 `sparkles`, `mid` 34–66 `melting_face`, `low` 0–33 `battery`
  - `FALLBACK = { key: 'fallback', emoji: 'shrug' } as const`
  - `findBand(bands: Band[], score: number): Band`
  - `validateBands(bands: Band[]): string[]` (an empty array means valid)

- [ ] **Step 1: Write failing tests**
  - `findBand` with `DEFAULT_BANDS`: 0→low, 33→low, 34→mid, 66→mid, 66.5→high (rounds half-up), 67→high, 100→high.
  - `validateBands` returns errors for: one band, six bands, a gap (0–33 then 35–100), an overlap, coverage that doesn't start at 0 or end at 100, duplicate keys, and an emoji name with spaces.
  - It returns `[]` for `DEFAULT_BANDS`.
- [ ] **Step 2:** Run `npx vitest run tests/bands.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Bands are integer, inclusive ranges, sorted by `min`. Emoji names are stored without colons (normalize them with `normalizeEmoji(name: string): string`, which strips `:` and lowercases; export it).
- [ ] **Step 4:** Run the tests again. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: band lookup and validation`.

---

### Task 3: Computed Fitbit score

**Files:**
- Create: `src/score/fitbit.ts`
- Test: `tests/score/fitbit.test.ts`

**Interfaces:**
- Produces:
  - `type DailyMetrics = { date: string /* YYYY-MM-DD */; hrvMs: number | null; rhrBpm: number | null; minutesAsleep: number | null }`
  - `computeFitbitScore(today: DailyMetrics, history: DailyMetrics[]): number | null`

- [ ] **Step 1: Write failing tests**
  - **Spec target:** history is 30 days with HRV alternating 50/60 and resting heart rate alternating 55/65. Today has HRV 55 (the mean), resting heart rate 60 (the mean) and 360 minutes asleep. Expect `46`.
  - The same day with 450 or more minutes asleep gives `50`.
  - With only 6 history days, expect `null`.
  - If today's HRV and resting heart rate are both null, expect `null`.
  - Today with HRV +1 SD, resting heart rate −1 SD and 480 min asleep gives `round(50 + 20·(0.5·1 + 0.3·1 + 0))` = `66`.
  - If today's sleep is missing, HRV +1 SD and resting heart rate at the mean gives re-weighted `round(50 + 20·(0.5/0.8))` = `63`.
  - Extreme inputs are clamped to 0 and to 100.
  - A history day with the same date as `today` is ignored.
- [ ] **Step 2:** Run `npx vitest run tests/score/fitbit.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement as described in the spec.
  - The baseline is the history from the 30 days before `today.date`.
  - A component is available only if today's value is present and the baseline has ≥7 non-null values. With fewer than 7 baseline days for both HRV and resting heart rate, return `null`.
  - Use population SD; if SD is 0, that z is 0.
  - Resting heart rate z is inverted.
  - `z_sleep = (min(min/450, 1) − 1) × 5`.
  - Re-weight across the available components.
  - `clamp(round(50 + 20·z), 0, 100)`.
- [ ] **Step 4:** Run the tests again. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: computed Fitbit readiness score`.

---

### Task 4: Status line library format, loader and content rules

**Files:**
- Create: `content/status-lines.json` (a starter of 3 lines per tone per pack, so the tests are meaningful; Task 16 fills it out), `content/blocklist.txt`, `src/lines/library.ts`
- Test: `tests/content/library.test.ts`, `tests/lines/library.test.ts`

**Interfaces:**
- Produces:
  - `type LineBand = Tone | 'fallback'`
  - `type StatusLine = { id: string; pack: string; band: LineBand; text: string; emoji?: string }`
  - `type Library = { version: number; packs: { id: string; name: string; emoji: string }[]; emojiPools: Record<LineBand, string[]>; lines: StatusLine[] }`
  - `loadLibrary(path?: string): Library` (validated with zod and cached)
  - `linesFor(lib: Library, band: LineBand, packIds: string[]): StatusLine[]`
  - `pickEmoji(line: StatusLine, lib: Library, rng: () => number): string`
- Packs (ids): `main-character`, `gaming`, `weather`, `snacks`, `tech`, `chaotic-good`, `soft`

- [ ] **Step 1: Write failing content tests** in `tests/content/library.test.ts`. These run against the real `content/status-lines.json`:
  - every `text` is ≤100 characters and matches neither `/[0-9%]/` nor any word in `blocklist.txt` (whole-word, case-insensitive)
  - ids are unique
  - no two lines are near-duplicates (normalized text identical, or token Jaccard ≥ 0.8; normalize by lowercasing, stripping non-letters and collapsing spaces)
  - every pack has ≥1 line for each of `high`, `mid`, `low` and `fallback`
  - every `emoji` and every pool entry is in `emoji-datasource` `short_names`
  - each pool has 8–12 entries
  - an env-gated test, `LIBRARY_FULL=1`: total ≥1000, each tone ≥300, fallback ≥100
- [ ] **Step 2: Write failing unit tests** in `tests/lines/library.test.ts`:
  - `linesFor` filters by band and packs
  - `pickEmoji` returns the line's fixed emoji when it has one, otherwise `pool[floor(rng()·len)]`
- [ ] **Step 3:** Run `npx vitest run tests/content tests/lines/library.test.ts`. Expected: FAIL.
- [ ] **Step 4:** Implement the loader and write the starter content and blocklist.
  - The blocklist covers swearing, innuendo, illness and medical terms (sick, ill, flu, covid, meds, pill, hangover, tired-of-life terms), body terms, alcohol (beer, wine, drunk, shots, hungover) and anything else unsafe for work.
  - Starter line ids look like `<pack>-<band>-<nnn>`.
- [ ] **Step 5:** Run the tests again. Expected: PASS (except the gated full-size test).
- [ ] **Step 6:** Commit: `feat: status line library format and content rules`.

---

### Task 5: Shuffle bag

**Files:**
- Create: `src/lines/shuffle.ts`
- Test: `tests/lines/shuffle.test.ts`

**Interfaces:**
- Produces:
  - `type Bag = { order: string[]; position: number; lastDrawn: string | null }`
  - `drawFromBag(bag: Bag | null, pool: string[], rng: () => number): { lineId: string; bag: Bag }`
  - It throws when `pool` is empty.

- [ ] **Step 1: Write failing tests** (with a seeded rng)
  - Drawing `pool.length` times from a `null` bag yields every id exactly once.
  - Across 50 refills of a 5-item pool, the first draw after a refill never equals the previous draw.
  - An id in `bag.order` that's no longer in `pool` is skipped.
  - A bag whose remaining ids are all gone from the pool refills from the current pool.
  - An id added to `pool` mid-cycle appears only after the next refill.
  - A pool of size 1 always returns that id without throwing.
- [ ] **Step 2:** Run `npx vitest run tests/lines/shuffle.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement with a Fisher–Yates shuffle. On refill, if `order[0] === lastDrawn` and the pool has more than one item, swap index 0 with a random other index.
- [ ] **Step 4:** Run the tests again. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: no-repeat shuffle bag`.

---

### Task 6: Schedule window and expiration

**Files:**
- Create: `src/schedule.ts`
- Test: `tests/schedule.test.ts`

**Interfaces:**
- Produces:
  - `type Phase = 'before' | 'polling' | 'fallback'`
  - `schedulePhase(now: Date, tz: string): { phase: Phase; localDate: string }`. Before 06:00 is `before`, 06:00 up to (but not including) 11:00 is `polling`, and 11:00 onward is `fallback`.
  - `endOfLocalDay(now: Date, tz: string): number`, the Unix seconds of 23:59:00 local.
  - `isPollDue(now: Date, lastAttempt: Date | null): boolean`, true when there's no last attempt or ≥30 min have passed.

- [ ] **Step 1: Write failing tests**
  - `Asia/Kolkata`: `2026-11-02T00:29Z` (05:59 local) is `before`; `00:30Z` is `polling` with `localDate` `2026-11-02`; `05:30Z` (11:00 local) is `fallback`.
  - `endOfLocalDay` for Kolkata on that date is `2026-11-02T18:29:00Z`.
  - `America/New_York` on 2026-11-01 (the clocks change): 06:00 local is `11:00Z` and is `polling`. `endOfLocalDay` is `2026-11-02T04:59:00Z`.
  - `Pacific/Auckland` returns a `localDate` one day ahead of UTC.
  - `isPollDue` is false at 29 minutes and true at 30 minutes.
- [ ] **Step 2:** Run `npx vitest run tests/schedule.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement with luxon `DateTime.fromJSDate(now, { zone: tz })`.
- [ ] **Step 4:** Run the tests again. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: per-timezone schedule window`.

---

### Task 7: Manual-status decision

**Files:**
- Create: `src/status/decision.ts`
- Test: `tests/status/decision.test.ts`

**Interfaces:**
- Consumes: `normalizeEmoji` (Task 2)
- Produces:
  - `type SlackStatus = { emoji: string; text: string }`
  - `canWriteStatus(current: SlackStatus, lastSet: SlackStatus | null): boolean`

- [ ] **Step 1: Write failing tests**
  - An empty status (`''`/`''`) gives `true`.
  - A status equal to `lastSet` gives `true`.
  - `:sparkles:` with text `' main character energy — ping me '` against `lastSet` `sparkles` with the trimmed text gives `true`.
  - `palm_tree` / `on vacation` with `lastSet` `null` gives `false`.
  - The same emoji as `lastSet` but different text gives `false`.
  - An emoji only, with empty text, that differs from `lastSet` gives `false`.
- [ ] **Step 2:** Run `npx vitest run tests/status/decision.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Compare normalized emoji and trimmed text. Treat a status as empty only when both are empty.
- [ ] **Step 4:** Run the tests again. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: never overwrite manual statuses`.

---

### Task 8: Database schema and repositories

**Files:**
- Create: `migrations/001_init.sql`, `src/db/pool.ts`, `src/db/users.ts`, `src/db/connections.ts`, `src/db/prefs.ts`, `src/db/bags.ts`, `src/db/runs.ts`, `src/db/metrics.ts`, `tests/helpers/db.ts` (creates a fresh schema per test file using `TEST_DATABASE_URL`)
- Test: `tests/db/*.test.ts`

**Interfaces:**
- Consumes: `encrypt` and `decrypt` (Task 1), `Band` (Task 2), `Bag` (Task 5), `DailyMetrics` (Task 3), `SlackStatus` (Task 7)
- Produces (every function takes `db: Queryable` first; `Queryable` is a `pg.Pool` or a `PoolClient`):
  - `users`:
    - `upsertUser(db, { slackUserId, teamId, tz }): Promise<void>`
    - `getUser(db, slackUserId): Promise<User | null>`
    - `setPaused(db, id, paused: boolean)`
    - `setInactive(db, id)`
    - `listSchedulable(db): Promise<User[]>` (active, not paused, has a Slack token and a provider connection)
    - `deleteUserCascade(db, id)`
  - `User = { slackUserId; teamId; tz; paused; active; slackUserToken: string /* decrypted */; lastSetStatus: SlackStatus | null; reconnectNotifiedAt: Date | null }`
  - `setSlackToken(db, id, token)` and `setLastSetStatus(db, id, s: SlackStatus | null)`
  - `connections`:
    - `getConnection(db, id): Promise<Connection | null>`
    - `saveConnection(db, id, c)` (replaces any existing provider)
    - `lockConnection(client, id): Promise<Connection | null>` (`SELECT … FOR UPDATE`)
    - `markReauthRequired(db, id)`
  - `Connection = { provider: 'whoop' | 'fitbit'; accessToken; refreshToken; expiresAt: Date; issuedAt: Date; reauthRequired: boolean }` (tokens are encrypted in the columns, decrypted in the objects)
  - `prefs`:
    - `getPrefs(db, id): Promise<{ bands: Band[]; packIds: string[]; customLines: { id: string; bandKey: string; text: string }[] }>` (defaults: `DEFAULT_BANDS` and all pack ids)
    - `savePrefs(db, id, prefs)` (also deletes the user's bags)
  - `bags`:
    - `getBag(db, id, bandKey): Promise<Bag | null>`
    - `saveBag(db, id, bandKey, bag)`
  - `runs`:
    - `getRun(db, id, localDate): Promise<Run | null>`
    - `recordAttempt(db, id, localDate, at: Date)`
    - `finishRun(db, id, localDate, outcome: 'set' | 'skipped_manual' | 'fallback' | 'error', bandKey: string | null)`
  - `Run = { lastAttemptAt: Date | null; outcome: string | null }`
  - `metrics`:
    - `upsertMetrics(db, id, rows: DailyMetrics[])`
    - `getMetrics(db, id, fromDate, toDate): Promise<DailyMetrics[]>`
    - `pruneMetrics(db, before: string)`

- [ ] **Step 1: Write failing tests.** Run them with `docker compose up -d db`.
  - Round trips for each repository.
  - The token columns in the raw table contain no plaintext token.
  - `saveConnection` replaces WHOOP with Fitbit.
  - `savePrefs` deletes bags.
  - `deleteUserCascade` leaves zero rows in every table.
  - `pruneMetrics` drops rows older than the cutoff.
  - `listSchedulable` excludes paused, inactive and unconnected users.
  - There is no `score` column anywhere (query `information_schema.columns`).
- [ ] **Step 2:** Run `npx vitest run tests/db`. Expected: FAIL.
- [ ] **Step 3:** Write `001_init.sql` with the tables from the spec's Data section.
  - Every table has an FK to `users` with `ON DELETE CASCADE`.
  - `daily_runs` has the primary key `(slack_user_id, local_date)`.
  - Then implement the repositories.
- [ ] **Step 4:** Run the tests again. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: schema and repositories`.

---

### Task 9: Provider interface, token freshness and WHOOP

**Files:**
- Create: `src/providers/types.ts`, `src/providers/tokens.ts`, `src/providers/whoop.ts`, `tests/fixtures/whoop/*.json` (token response, recovery pages)
- Test: `tests/providers/whoop.test.ts`, `tests/providers/tokens.test.ts`

**Interfaces:**
- Consumes: the `connections` repo (Task 8)
- Produces:
  - `type ScoreReason = 'ok' | 'pending' | 'unscorable' | 'no_data' | 'insufficient_history' | 'reauth_required' | 'temporary_error'`
  - `type ScoreResult = { score: number | null; reason: ScoreReason }`
  - `interface Provider { id: 'whoop' | 'fitbit'; authUrl(state: string): string; exchangeCode(code: string): Promise<TokenSet>; refresh(refreshToken: string): Promise<TokenSet>; getTodayScore(accessToken: string, localDate: string, tz: string): Promise<ScoreResult> }`
  - `TokenSet = { accessToken; refreshToken; expiresAt: Date }`
  - `withFreshToken<T>(pool, userId, provider: Provider, fn: (accessToken: string) => Promise<T>): Promise<T | { reauth: true }>`
  - `class ReauthRequired extends Error`
  - `whoopProvider(cfg: Config): Provider`
  - `newOAuthState(): string` (8 characters, from `[A-Za-z0-9]`)

- [ ] **Step 1: Write failing tests.** Use `undici` `MockAgent` with `setGlobalDispatcher`.
  - `authUrl` contains the spec's auth URL, `scope=read:recovery read:cycles offline` (URL-encoded) and an 8-character state.
  - `getTodayScore` with a page containing a SCORED record whose `created_at` falls on `localDate` in `tz` returns `{ score: 72, reason: 'ok' }`.
  - It follows `next_token` across 2 pages.
  - `PENDING_SCORE` gives `pending`. `UNSCORABLE` gives `unscorable`. No record for today gives `no_data`.
  - HTTP 401 throws `ReauthRequired`. HTTP 429 and 5xx give `temporary_error`.
  - A record from yesterday in `Asia/Kolkata` that is today in UTC is not used.
- [ ] **Step 2: Write failing token tests** (DB plus mocks).
  - An expired token triggers exactly one refresh, and both new tokens are saved.
  - **Two concurrent `withFreshToken` calls on an expired token result in one refresh call**, and the second call uses the new token (Review Focus 2).
  - A refresh failing with `invalid_grant` marks `reauthRequired` and returns `{ reauth: true }`.
- [ ] **Step 3:** Run `npx vitest run tests/providers`. Expected: FAIL.
- [ ] **Step 4:** Implement.
  - `withFreshToken` refreshes inside a transaction holding `lockConnection`, and re-reads after taking the lock. It refreshes when `expiresAt < now + 60s`.
  - WHOOP requests send `limit=25` with `start` = local midnight minus 1 day.
- [ ] **Step 5:** Run the tests again. Expected: PASS.
- [ ] **Step 6:** Commit: `feat: WHOOP provider with single-flight token refresh`.

---

### Task 10: Fitbit (Google Health) provider

**Files:**
- Create: `src/providers/fitbit.ts`, `tests/fixtures/google/*.json` (token response, `daily-heart-rate-variability`, `daily-resting-heart-rate`, `sleep` pages including a nap)
- Test: `tests/providers/fitbit.test.ts`

**Interfaces:**
- Consumes: `Provider` and `ScoreResult` (Task 9), `computeFitbitScore` (Task 3), the `metrics` repo (Task 8)
- Produces:
  - `fitbitProvider(cfg: Config, deps: { pool }): Provider & { backfill(accessToken: string, userId: string, tz: string, days?: number): Promise<void> }`
  - `fetchDailyMetrics(accessToken: string, fromDate: string, toDate: string, tz: string): Promise<DailyMetrics[]>`
  - `needsReconnectReminder(issuedAt: Date, now: Date): boolean` (true when ≥6 days have passed)

- [ ] **Step 1: Write failing tests**
  - `authUrl` includes both scopes, `access_type=offline` and `prompt=consent`.
  - `fetchDailyMetrics`:
    - maps `averageHeartRateVariabilityMilliseconds` to `hrvMs`
    - maps `beatsPerMinute` (int64 string) to the number `rhrBpm`
    - takes `minutesAsleep` from `summary.minutesAsleep` of the `metadata.mainSleep === true` session only (the nap is ignored), with the sleep date taken from `interval.civilEndTime`
    - sends the filter on `daily_heart_rate_variability.date` and `sleep.interval.start_time`
    - follows `nextPageToken`
  - `getTodayScore` with 30 stored history days and today's fixture returns `ok` and a score in the range 0–100.
  - With fewer than 7 history days it returns `insufficient_history`.
  - `backfill` upserts 30 days.
  - `needsReconnectReminder` is false at 5 days 23 hours and true at 6 days.
- [ ] **Step 2:** Run `npx vitest run tests/providers/fitbit.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. `getTodayScore` fetches today's metrics, upserts them, reads the trailing 30 days from the DB, and calls `computeFitbitScore`.
- [ ] **Step 4:** Run the tests again. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: Google Health (Fitbit) provider`.

---

### Task 11: Slack status client

**Files:**
- Create: `src/slack/status.ts`
- Test: `tests/slack/status.test.ts`

**Interfaces:**
- Produces:
  - `interface SlackStatusClient { get(userToken: string): Promise<SlackStatus>; set(userToken: string, s: SlackStatus, expiration: number): Promise<void>; clear(userToken: string): Promise<void>; dm(slackUserId: string, text: string, blocks?: unknown[]): Promise<void> }`
  - `slackStatusClient(botClient: WebClient): SlackStatusClient`
  - `class SlackTokenRevoked extends Error`

- [ ] **Step 1: Write failing tests** with a mocked `WebClient`.
  - `set` calls `users.profile.set` with `{ status_emoji: ':sparkles:', status_text, status_expiration }`, using the user token.
  - `get` maps `users.profile.get` back to `SlackStatus`.
  - The errors `token_revoked`, `invalid_auth` and `account_inactive` throw `SlackTokenRevoked`.
  - `dm` uses `chat.postMessage` with `channel = slackUserId`.
- [ ] **Step 2:** Run `npx vitest run tests/slack/status.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests again. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: Slack status client`.

---

### Task 12: Per-user daily runner

**Files:**
- Create: `src/runner/runUser.ts`, `src/runner/copy.ts` (reconnect DM text and buttons), `src/log.ts`
- Test: `tests/runner/runUser.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 4–11
- Produces:
  - `type RunDeps = { pool; providers: Record<'whoop' | 'fitbit', Provider>; slack: SlackStatusClient; library: Library; rng: () => number; log: Logger; cfg: Config }`
  - `runUser(user: User, now: Date, deps: RunDeps): Promise<'set' | 'skipped_manual' | 'fallback' | 'error' | 'waiting' | 'not_due'>`
  - `log.info(event: string, fields: { slackUserId: string; provider?: string; bandKey?: string; outcome?: string; reason?: string })` (the logger type only allows these keys)

**Behavior** (one call is one tick for one user):
1. `schedulePhase`: `before` gives `not_due`. If the run for `localDate` already has an outcome, return `not_due`. If `polling` and `!isPollDue`, return `not_due`.
2. `recordAttempt`.
3. For Fitbit with `needsReconnectReminder` and `reconnectNotifiedAt` not set in the last 6 days, send the friendly DM from `copy.ts`: "weekly vibe check-in: reconnect your Fitbit to keep the vibes flowing ✨" plus a reconnect button.
4. Use `withFreshToken` to call `getTodayScore`.
   - `reauth` sends the reconnect DM (WHOOP: "reconnect your WHOOP to keep the vibes flowing ✨") once, then treats the score as null.
5. Score present gives `findBand`. Null and `polling` gives `waiting`, unless the reason is `unscorable`, `reauth_required` or `insufficient_history`. Those go straight to the fallback. Null and `fallback` phase gives the fallback.
6. Pick the line:
   - pool = `linesFor(lib, band.tone, packIds)` ids, plus that band's custom line ids (prefixed `custom:`)
   - `drawFromBag` and `saveBag` (use the bag key `fallback` for the fallback)
   - emoji: the line's fixed emoji, otherwise `pickEmoji` for library lines; for custom lines, the band's emoji
   - text: the line's text
7. `slack.get`, then `canWriteStatus(current, user.lastSetStatus)`. If false, `finishRun('skipped_manual')`.
8. `slack.set(status, endOfLocalDay)`, `setLastSetStatus`, then `finishRun('set' | 'fallback', bandKey)`.
9. `SlackTokenRevoked` gives `setInactive` and `finishRun('error')`. Any other exception gives `log.info('run_error', { reason: err.name })` and `error`, with no outcome recorded during `polling` so the next tick retries.

- [ ] **Step 1: Write failing tests** with fake providers and a fake Slack client, against the real test DB.
  - **Happy path:** WHOOP score 72 at 07:00 local sets a status whose text is in the library and whose expiration equals `endOfLocalDay`. The outcome is `set`, with `bandKey` `high`.
  - **Manual status:** a current status of `palm_tree`/`on vacation` gives `skipped_manual`, `set` isn't called, and a second tick the same day gives `not_due`.
  - A `pending` reason at 07:00 gives `waiting`. At 11:05 it gives `fallback`, with text from the `fallback` lines.
  - An expired Fitbit token gives the fallback, and the friendly DM is sent exactly once across 2 days of ticks.
  - **No-repeat:** 10 consecutive days of the same band produce 10 distinct texts.
  - **Privacy:** across every test, the captured log output and every `dm` text contain neither the score value (`72`, `46`) nor `/\d+%/`. Assert this on the captured logs.
  - `SlackTokenRevoked` marks the user inactive.
- [ ] **Step 2:** Run `npx vitest run tests/runner`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests again. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: per-user daily runner`.

---

### Task 13: App server, OAuth flows, scheduler and Docker

**Files:**
- Create: `src/app.ts`, `src/oauth/routes.ts`, `src/runner/tick.ts`, `src/index.ts`, `src/slack/installStore.ts`, `slack-manifest.yml`, `Dockerfile`
- Test: `tests/oauth/routes.test.ts`, `tests/runner/tick.test.ts`

**Interfaces:**
- Consumes: everything above
- Produces:
  - `tick(now: Date, deps: RunDeps): Promise<void>` (runs `runUser` for each `listSchedulable` user, one after another, catching errors per user)
  - `buildApp(cfg, deps): { app: App; receiver: ExpressReceiver }`
  - Routes:
    - `GET /oauth/whoop/start?u=<signed>` and `/oauth/fitbit/start?u=<signed>`: set an 8-character state cookie and redirect to `authUrl`
    - `GET /oauth/whoop/callback` and `/oauth/fitbit/callback`: check the state, `exchangeCode`, `saveConnection`; for Fitbit, then `backfill`; then render a "you're connected ✨ head back to Slack" page
    - Slack install via Bolt `installerOptions` with `userScopes` and a custom `installationStore` writing `setSlackToken` and `upsertUser` (timezone from `users.info`)
  - `signUserLink(slackUserId, secret): string` and `verifyUserLink(token, secret): string | null`, using HMAC with a 15-minute expiry

- [ ] **Step 1: Write failing tests**
  - A WHOOP callback with a mismatched state returns 400 and saves nothing.
  - A valid callback saves the connection (mock the token endpoint).
  - `/oauth/fitbit/start` returns 404 when `FITBIT_ENABLED=false`.
  - `verifyUserLink` rejects tampered and expired tokens.
  - `tick` runs every schedulable user, and one user throwing doesn't stop the others.
- [ ] **Step 2:** Run `npx vitest run tests/oauth tests/runner/tick.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
  - `index.ts` runs the migrations, starts the receiver, then `setInterval(tick, 5 * 60_000)` with a re-entrancy guard (skip if the previous tick is still running), plus a daily `pruneMetrics(today − 35d)`.
  - `slack-manifest.yml` declares the slash command `/approachability`, the scopes from Global Constraints and the redirect URLs.
  - The Dockerfile is a multi-stage Node 20 alpine image.
- [ ] **Step 4:** Run the tests, then `docker build .`. Expected: PASS, and the image builds.
- [ ] **Step 5:** Commit: `feat: server, OAuth flows, scheduler, Docker`.

---

### Task 14: Slash commands

**Files:**
- Create: `src/slack/commands.ts`
- Test: `tests/slack/commands.test.ts`

**Interfaces:**
- Consumes: the repos, `signUserLink`, `SlackStatusClient`, `canWriteStatus`, `getTodayScore` through `withFreshToken`
- Produces: `registerCommands(app: App, deps: RunDeps): void`

**Behavior** (every reply is ephemeral):
- `connect`: blocks with **Connect WHOOP** and, when `fitbitEnabled`, **Connect Fitbit** link buttons (`/oauth/<p>/start?u=…`). If there's no Slack user token yet, show only an **Authorize Slack** button (`/slack/install`) first.
- `status` or empty: the band label and emoji, the provider, paused or not, and the user's own score ("only you can see this 👀"). This is the only place a score is ever shown.
- `pause` and `resume`: `setPaused`. `pause` also clears the status if `canWriteStatus(current, lastSetStatus)`.
- `disconnect`: clear the status (same rule), revoke the Slack token (`auth.revoke`), and revoke the Google token for Fitbit users (`POST https://oauth2.googleapis.com/revoke?token=…`; WHOOP has no documented revoke endpoint, so delete only). Then `deleteUserCascade` and confirm.
- `help` or anything unknown: list the subcommands.

- [ ] **Step 1: Write failing tests** with a fake `respond` and fake clients.
  - `connect` with no Slack token shows only the authorize button.
  - `connect` with `fitbitEnabled=false` has no Fitbit button.
  - `status` shows the score and is ephemeral (`response_type: 'ephemeral'`).
  - `pause` clears our status but not a manual one.
  - `disconnect` leaves zero rows and calls `auth.revoke`.
  - An unknown subcommand shows help.
- [ ] **Step 2:** Run `npx vitest run tests/slack/commands.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement, keeping the copy in the spec's tone.
- [ ] **Step 4:** Run the tests again. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: /approachability commands`.

---

### Task 15: Settings modal (bands, packs, custom lines)

**Files:**
- Create: `src/slack/settings.ts`
- Test: `tests/slack/settings.test.ts`

**Interfaces:**
- Consumes: `getPrefs` and `savePrefs`, `validateBands`, the library packs
- Produces:
  - `buildSettingsView(prefs, lib): View`
  - `parseSettingsSubmission(state: ViewState, lib): { ok: true; prefs } | { ok: false; errors: Record<string, string> }`
  - `registerSettings(app, deps)`, which handles `/approachability settings` and the `view_submission` for `callback_id: 'settings'`

**Modal contents:**
- One row per band: label, min, max, tone (select), emoji. There are **Add band** and **Remove band** buttons, which update the view through `views.update`, within the 2–5 limit.
- Pack checkboxes, all checked by default.
- Custom lines: a multiline input per band, one line per row.

- [ ] **Step 1: Write failing tests**
  - `buildSettingsView` for the default prefs has 3 band rows and 7 checked packs.
  - Parsing a submission with a gap returns `errors` keyed to the right block id.
  - Zero packs checked gives an error.
  - A custom line over 100 characters gives an error.
  - An emoji that's neither in `emoji-datasource` nor in the workspace `emoji.list` (passed in) gives an error.
  - A valid submission returns `ok`, and saving it deletes the bags.
- [ ] **Step 2:** Run `npx vitest run tests/slack/settings.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Return errors as `response_action: 'errors'`.
- [ ] **Step 4:** Run the tests again. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: settings modal for bands, packs, custom lines`.

---

### Task 16: Write the full status line library (content)

**Files:**
- Modify: `content/status-lines.json`
- Create: `docs/library-review.md` (the review checklist and sign-off)

- [ ] **Step 1:** Write ≥1000 lines across the 7 packs: ≥300 each for `high`, `mid` and `low`, and ≥100 for `fallback`, spread roughly evenly across packs. Each line follows the spec's tone and is about vibe and availability. Write them in batches of one pack × one band, at about 45 lines per batch, so no batch repeats a pattern. Vary the structure: statements, fake system messages, weather reports, game states, food metaphors. Avoid the same opener more than 3 times per pack-band (for example "currently…", "in my … era").
- [ ] **Step 2:** Set fixed emojis only where the joke needs them. Fill each `emojiPools` entry with 8–12 emojis that fit the band (high: energetic; mid: neutral or wobbly; low: calm or soft; fallback: shrug or loading).
- [ ] **Step 3:** Run `LIBRARY_FULL=1 npx vitest run tests/content`. Expected: PASS. Fix every failure by rewriting the line; don't edit the rules.
- [ ] **Step 4:** Write `docs/library-review.md`:
  - a checklist (tone, workplace safety, nothing medical, no score-like phrasing, Low lines read as "be gentle" not "I'm unwell")
  - 20 random samples per band, produced with `npx tsx scripts/sample-lines.ts`
  - a sign-off line for the human reviewer

  Create `scripts/sample-lines.ts` as part of this step.
- [ ] **Step 5:** Commit: `content: full status line library (1000+ lines)`.
- [ ] **Step 6:** **Gate:** a person on the team reviews and signs off `docs/library-review.md` before launch.

---

### Task 17: End-to-end check in our workspace (manual)

- [ ] **Step 1:** Deploy the container with Postgres. Set all environment variables, and set `FITBIT_ENABLED` according to Task 0. Install the app from `slack-manifest.yml`.
- [ ] **Step 2:** As one WHOOP user, run `/approachability connect`, authorize Slack and WHOOP, then `/approachability status`. Expected: you see your band and score, ephemerally.
- [ ] **Step 3:** Temporarily set the scheduler to run immediately (call `tick(new Date())` via `npx tsx scripts/tick-now.ts`; create it in this step). Expected: the status is set, it expires at 23:59 local, and the text contains no numbers.
- [ ] **Step 4:** Set a manual status (🌴 "on vacation"), clear today's `daily_runs` row, and tick again. Expected: unchanged, with outcome `skipped_manual`.
- [ ] **Step 5:** Repeat steps 2–3 with one Fitbit user, if enabled.
- [ ] **Step 6:** Run `/approachability settings`: add a 4th band, turn off 2 packs, add a custom line, and save. Expected: saved. Then check the validation errors for a gap and for zero packs.
- [ ] **Step 7:** Run `/approachability disconnect`. Expected: the status is cleared and the DB has no rows for that user.
- [ ] **Step 8:** Record the results in `docs/preflight.md` under "E2E", then commit.
