# Approachability Index — Slack Status from Recovery

**Date:** 2026-10-31
**Status:** Approved 2026-10-31

## Intent

Teammates should be able to tell at a glance how approachable someone is today. The app reads each person's recovery from their wearable (WHOOP, or Fitbit through the Google Health API), turns it into an "approachability" band, and sets their Slack status to a quirky, Gen Z, workplace-appropriate emoji and line of text for that band.

The status shows the vibe, not the data. Nobody else ever sees the score.

## Goals

- Set each opted-in user's Slack status (emoji and text) once a day from their recovery band.
- Support WHOOP (its native recovery score) and Fitbit (a score this app computes, because Fitbit's Daily Readiness score is not available through any API).
- Let each user configure their own bands: the score cutoffs, the emoji and the text for each.
- Ship fun defaults that are fine to have on at work.
- Show a neutral fallback vibe when there's no score for the day.

## Non-goals (v1)

- Other wearables (Oura, Garmin, Apple Health, Polar). Keep the provider layer pluggable, but build only WHOOP and Fitbit.
- Dashboards, charts, team views, history UIs.
- Organizations beyond our own Slack workspace (internal use; no public Slack App Directory listing).
- A native mobile app.

## Anti-goals (a failure even if it technically works)

- **The score leaks.** No number, percentage or raw metric (HRV, resting heart rate, sleep) ever appears in a status, a channel message, or anything visible to someone other than the user. This includes logs that others might read; log user IDs and bands, never scores.
- **It overwrites a status the user set themselves.** If someone sets 🌴 "on vacation" or 📅 "in a meeting", the app leaves it alone.
- **Copy that isn't safe for work or that sounds medical.** No swearing, no innuendo, nothing about bodies or illness, nothing that reads as "I'm sick". The tone is playful and kind.
- **Stale statuses.** Yesterday's vibe must not linger into tomorrow.

## Decisions (made by the user)

| Topic | Decision |
|---|---|
| Visibility | Only the vibe. Never the score, anywhere. |
| Manual statuses | Never overwrite a status the user set themselves. |
| No score today | Show a neutral fallback vibe. |
| Customisation | Users can configure their own bands. |
| Tone | Quirky, Gen Z, workplace-appropriate. |
| Providers | WHOOP and Fitbit (Google Health API) for now. |
| Users | Internal: us and our team. |
| Stack | TypeScript / Node backend service. |
| Hosting | We host it ourselves. |
| Fitbit score | Computed by this app from raw metrics. |

## Builder's calls (decided during design; can be changed)

### Stack
- Node 20+, TypeScript, Slack **Bolt for JS** in HTTP mode (OAuth callbacks need public HTTP anyway).
- **Postgres** for storage. Containerised with a Dockerfile so it runs on Railway, Render, Fly or our own box.
- One process holds the web server (Slack events, commands, OAuth callbacks) and an in-process scheduler (cron-style ticks).

### Slack app
- Distributed only inside our workspace.
- **User token** scopes, granted by each user individually: `users.profile:read`, `users.profile:write`. Slack does not let a bot or an admin set someone else's status.
- **Bot** scopes: `commands`, `chat:write`, `users:read` (for timezone).
- Slash command `/approachability`, with subcommands:
  - `connect`: private (ephemeral) message with **Connect WHOOP** / **Connect Fitbit** buttons, plus Slack authorisation if it isn't granted yet.
  - `settings`: opens a modal to edit bands.
  - `pause` / `resume`: stop or restart automatic updates without disconnecting.
  - `disconnect`: revoke and delete tokens and data for that user.
  - `status` (or no argument): show the user their current band privately. The user may see their own score here; nobody else can.
- An App Home tab with the same controls is optional and comes after v1.

### Providers

**WHOOP**
- OAuth: `https://api.prod.whoop.com/oauth/oauth2/auth` and `/oauth/oauth2/token`. Scopes `read:recovery read:cycles offline`. The `state` value is 8 characters.
- Each refresh replaces the refresh token, so persist the new one atomically or the user's access is lost.
- Data: `GET https://api.prod.whoop.com/developer/v2/recovery` (paginated with `next_token`). Use the latest record whose `score_state = SCORED` and whose cycle belongs to today in the user's timezone. Use `score.recovery_score` (0–100).
- `PENDING_SCORE` means try again later. `UNSCORABLE` means fallback for the day.
- The Sandbox tier allows 10 members, which is enough for our team. Rate limits are 100 requests/min and 10k/day.

**Fitbit (Google Health API)**
- Google OAuth with scopes `https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly` and `https://www.googleapis.com/auth/googlehealth.sleep.readonly`. Request offline access so you get a refresh token.
- Data: `GET https://health.googleapis.com/v4/users/me/dataTypes/{type}/dataPoints` for `daily-heart-rate-variability`, `daily-resting-heart-rate` and `sleep` (main sleep only, `metadata.mainSleep = true`, ignore naps).
- **The legacy Fitbit Web API is turned off on 2026-11-02. Do not use it.**
- **Risk:** Google Health API access may be gated, and its scopes are reportedly "Restricted". The first build task is to confirm that our Cloud project can be granted these scopes, using testing mode with listed test users. If it can't, ship WHOOP first and keep Fitbit behind a feature flag.
- **Weekly reconnect (user decision, accepted for now):** users have personal Google accounts, and in testing mode Google expires refresh tokens after 7 days. Fitbit users reconnect about once a week. Treat this as routine, not an error:
  - Track when each Google token was issued.
  - On day 6, send a friendly DM ("weekly vibe check-in: reconnect your Fitbit to keep the vibes flowing ✨") with a one-tap reconnect button.
  - If the token has already expired, set the fallback vibe that day and send the same DM. Don't send an error-style message.
  - Google verification, to remove the weekly reconnect, is a later step outside v1.

**Provider interface.** Each provider implements roughly `getTodayScore(user) → { score: number | null, reason }`. Adding Oura or Garmin later means adding a provider, not reworking the core.

### Computed Fitbit score (first version, tunable)
- Baseline: the user's trailing 30 days, excluding today. **At least 7 days of data** are needed before a score is produced; before that, show the fallback.
- Components (z-scores against the baseline):
  - HRV (`averageHeartRateVariabilityMilliseconds`): higher is better. Weight 0.5.
  - Resting heart rate (`beatsPerMinute`): lower is better (invert the z-score). Weight 0.3.
  - Sleep: `ratio = min(minutesAsleep / 450, 1.0)`, then `z_sleep = (ratio − 1) × 5`. It can only lower the score: 0 at 7.5h or more, about −1 at 6h. Weight 0.2. *(Builder's call.)* Test target: a day with HRV and resting heart rate at baseline and 6h of sleep scores about 46, which lands in the **Mid** band.
- Composite `z = Σ weight·z_i`, so `score = clamp(round(50 + 20·z), 0, 100)`.
- If a component is missing, re-weight across the components present. If HRV and resting heart rate are both missing, there is no score (fallback).
- Put this in one pure function with unit tests so the formula can be tuned later.

### Bands and default copy

Default bands are three, matching WHOOP's colours. Users can change cutoffs, emojis and text, and add or remove bands (minimum 2, maximum 5). Bands must cover 0–100 with no gaps or overlaps; the settings modal checks this.

| Band | Score | Emoji (Slack name) | Default text |
|---|---|---|---|
| High | 67–100 | ✨ `:sparkles:` | main character energy — ping me |
| Mid | 34–66 | 🫠 `:melting_face:` | running on vibes, async preferred |
| Low | 0–33 | 🔋 `:battery:` | low battery mode — be gentle pls |
| Fallback (no score) | n/a | 🤷 `:shrug:` | vibe pending |

The table above shows *examples*. Statuses come from a large rotating library (next section), so no single line is repeated day after day.

### Status line library (user decision: themed packs, shuffle, no repeats)

Approach based on Claude Code's spinner words (a curated list with random picks and user-extendable themed categories) and the "shuffle bag" technique games use.

- **Size:** at least **1,000 reviewed lines** across all bands plus fallback. Roughly 300+ each for High, Mid and Low, and 100+ for fallback. At one status per day, that's about 3 years before any repeat.
- **Themed packs:** each line belongs to one pack and one band. Starting packs *(builder's call on the final list)*:
  - 💅 *Main character*: "main character arc unlocked"
  - 🎮 *Gaming*: "respawning, back soon"
  - 🌦️ *Weather*: "partly cloudy, chance of replies"
  - 🍜 *Snacks*: "currently a soft-boiled egg"
  - 💻 *Tech*: "brain at 5G speeds", "lowkey buffering"
  - 🛸 *Chaotic good*: "loading personality…"
  - 🌙 *Soft*: "in my quiet era"
  
  Every pack covers every band and the fallback. All packs are on by default. Users switch packs on or off in `/approachability settings`, and at least one must stay on.
- **Emoji pools:** each band has a pool of about 8–12 emojis. A line either names a fixed emoji, when the joke depends on it (🥚 for "soft-boiled egg"), or takes a random emoji from its band's pool. That multiplies the variety on top of the line count.
- **Custom lines:** users can add their own lines to any band. They go into the same rotation as the packs. Users can also, as before, change band cutoffs and the per-band default emoji.
- **No-repeat selection (shuffle bag):** each user has one bag per band, holding every line from their enabled packs plus their custom lines, in shuffled order. Each day takes the next line from that band's bag. When a bag is empty, it refills and reshuffles, and the line drawn last can't come first. Changing packs or custom lines rebuilds that user's bags. Store the bag as an ordered list of line IDs plus a position.
- **Storage:** the library is a versioned file in the repo (for example `content/status-lines.json`: `{ id, pack, band, text, emoji? }`). Line IDs are stable, so shuffle bags survive library updates. New lines are added to bags at the next refill; removed lines are skipped.
- **Writing the library:** Claude writes the lines as a build task, not at runtime. A person on the team reviews them once before launch.
- **Content rules (enforced by tests on the library file):**
  - ≤100 characters.
  - No digits or percent signs, so nothing reads as a score.
  - No swearing, innuendo, illness, bodies, medication, alcohol or anything else unsafe for work.
  - No duplicate or near-duplicate lines (normalize the text and compare).
  - Each pack covers every band.
  - Valid Slack emoji names.
- **No live AI writing:** lines are never generated per user per day. That avoids unreviewed copy, API cost and outages.

Text is limited to 100 characters (Slack's status text limit). Emojis must be valid Slack emoji names; custom workspace emojis are allowed (add the `emoji:read` bot scope to check them).

*(Builder's call.)* The rule against showing the score and unsafe copy is enforced by the app and the default copy. Text a user writes for their own bands is their choice; it's checked only for length and that the emoji exists. The app never inserts a number into status text.

### Daily schedule (per user, in their Slack timezone)
- From **06:00 to 11:00 local**, check every **30 minutes** until a score exists for today. Once a status is set for today, stop checking.
- At **11:00 local**, if there's still no score, set the **fallback** vibe.
- Every status is set with `status_expiration` at **23:59 local**, so it clears itself and never lasts into the next day.
- Weekends behave the same as weekdays (a simple default; a per-user "weekdays only" toggle is a possible later addition).
- The scheduler ticks every few minutes and selects users whose local time falls in the window. The work is small at team scale; no queue needed.

### Respecting manual statuses
- Store `last_set_status` (emoji, text, expiration) for each user.
- Before setting, read the user's current profile status:
  - **Empty** → set ours.
  - **Matches what we set last time** → set ours (replace or refresh).
  - **Anything else** → the user set it; **skip for today** and record the skip. Don't retry until tomorrow.
- If the user clears their status later in the day, we don't step back in until the next day. This is simple and predictable.

### Other builder's calls
- One provider per user. Connecting a second one replaces the first.
- `pause` and `disconnect` clear the current status, but only if it's still the one the app set.
- On Fitbit connect, load the last 30 days of history so a score is available right away when there's enough data.

### Data and privacy
- Tables (roughly): `users` (Slack user ID, team ID, timezone, paused flag), `slack_tokens`, `provider_connections` (provider, encrypted access/refresh tokens, expiry), `bands` (per-user config, JSON is fine), `user_packs` (enabled packs), `custom_lines`, `shuffle_bags` (user, band, ordered line IDs, position, last line drawn), `daily_runs` (date, band key, outcome: set / skipped_manual / fallback / error), `fitbit_metrics` (date, HRV, resting heart rate, minutes asleep; kept for 35 days, then deleted).
- Encrypt tokens at rest with application-level encryption (AES-256-GCM with a key from an environment variable).
- **Don't store the score after the band is decided.** WHOOP scores are never stored. Fitbit raw metrics are stored only for the rolling baseline window.
- `disconnect` deletes every row for that user and revokes provider and Slack tokens where the provider supports it.
- Logs contain the Slack user ID, provider, band key and outcome. Never scores or metrics.

### Configuration
Environment variables: Slack signing secret, client ID and secret; WHOOP client ID and secret; Google client ID and secret; `DATABASE_URL`; `TOKEN_ENCRYPTION_KEY`; `PUBLIC_BASE_URL` (for OAuth redirect URIs).

## Error handling
- Provider token expired or revoked: send the user a private DM once ("reconnect your WHOOP to keep the vibes flowing ✨") with a reconnect button, and stop trying for that user until they reconnect.
- Slack token revoked: mark the user inactive.
- Temporary provider errors (5xx, rate limits): retry on the next 30-minute tick; at 11:00 use the fallback.

## Testing
- Unit tests: band lookup and validation, shuffle bag (no repeats within a cycle, no repeat across a refill, rebuilt when packs change), library content rules, the Fitbit score formula, the manual-status decision, and the schedule window across timezones.
- Integration tests with provider and Slack HTTP calls mocked (recorded fixtures for the WHOOP recovery and Google Health dataPoints shapes).
- A manual end-to-end check in our workspace with one WHOOP user and one Fitbit user before inviting the team.

## Left to the builder
- Project layout, ORM or query library, migration tool.
- Exact copy of the bot's DM and modal text (keep the same tone).
- Final pack names and emoji pools (keep the content rules).
- Whether to use WHOOP webhooks instead of polling later (polling is fine for v1).
- Deployment target and CI.
