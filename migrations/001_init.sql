CREATE TABLE users (
  slack_user_id text PRIMARY KEY,
  team_id text NOT NULL,
  tz text NOT NULL DEFAULT 'UTC',
  paused boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  last_set_emoji text,
  last_set_text text,
  reconnect_notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE slack_tokens (
  slack_user_id text PRIMARY KEY REFERENCES users ON DELETE CASCADE,
  token_enc text NOT NULL
);

CREATE TABLE provider_connections (
  slack_user_id text PRIMARY KEY REFERENCES users ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('whoop', 'fitbit')),
  access_token_enc text NOT NULL,
  refresh_token_enc text NOT NULL,
  expires_at timestamptz NOT NULL,
  issued_at timestamptz NOT NULL,
  reauth_required boolean NOT NULL DEFAULT false
);

CREATE TABLE bands (
  slack_user_id text PRIMARY KEY REFERENCES users ON DELETE CASCADE,
  config jsonb NOT NULL
);

CREATE TABLE user_packs (
  slack_user_id text NOT NULL REFERENCES users ON DELETE CASCADE,
  pack_id text NOT NULL,
  PRIMARY KEY (slack_user_id, pack_id)
);

CREATE TABLE custom_lines (
  id text PRIMARY KEY,
  slack_user_id text NOT NULL REFERENCES users ON DELETE CASCADE,
  band_key text NOT NULL,
  text text NOT NULL CHECK (char_length(text) <= 100)
);

CREATE TABLE shuffle_bags (
  slack_user_id text NOT NULL REFERENCES users ON DELETE CASCADE,
  band_key text NOT NULL,
  line_order jsonb NOT NULL,
  position integer NOT NULL,
  last_drawn text,
  PRIMARY KEY (slack_user_id, band_key)
);

CREATE TABLE daily_runs (
  slack_user_id text NOT NULL REFERENCES users ON DELETE CASCADE,
  local_date date NOT NULL,
  last_attempt_at timestamptz,
  outcome text CHECK (outcome IN ('set', 'skipped_manual', 'fallback', 'error')),
  band_key text,
  PRIMARY KEY (slack_user_id, local_date)
);

CREATE TABLE fitbit_metrics (
  slack_user_id text NOT NULL REFERENCES users ON DELETE CASCADE,
  date date NOT NULL,
  hrv_ms real,
  rhr_bpm real,
  minutes_asleep integer,
  PRIMARY KEY (slack_user_id, date)
);
