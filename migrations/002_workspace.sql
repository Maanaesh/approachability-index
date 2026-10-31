CREATE TABLE workspace (
  team_id text PRIMARY KEY,
  bot_token_enc text NOT NULL,
  bot_user_id text,
  bot_id text
);
