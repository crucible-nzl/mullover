-- 0008 · rate_limits · simple fixed-window counter for abuse-prone endpoints.
--
-- One row per logical bucket. The key column is structured as
-- "<scope>:<value>" e.g. "signin-ip:46.225.133.203" or
-- "signin-email:admin@counsel.day". The application code does the
-- key construction; this table is dumb storage.
--
-- Fixed-window approach: when a request comes in, we upsert with
-- the rule "if reset_at has passed, reset count to 1 and slide
-- reset_at forward by `window_seconds`; otherwise increment".
-- The check then compares count to the per-scope limit. Postgres
-- handles concurrency via the ON CONFLICT atomic.
--
-- Cleanup: a row whose reset_at is in the past is harmless · we
-- reset it lazily on the next hit. A periodic prune (in
-- session-purge cron) trims rows whose reset_at is > 24h old.

CREATE TABLE IF NOT EXISTS rate_limits (
  key         TEXT PRIMARY KEY,
  count       INTEGER NOT NULL DEFAULT 0,
  reset_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_hit_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rate_limits_reset_idx ON rate_limits (reset_at);
