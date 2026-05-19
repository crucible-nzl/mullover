-- 0006 · push subscriptions for Web Push notifications.
--
-- One row per (user, endpoint). An endpoint is the unique URL the
-- browser hands us when the user grants Notification permission;
-- different browsers and different devices each produce their own.
--
-- We keep the auth keys verbatim because the push library encrypts
-- payloads with them. last_seen_at lets a future cron drop endpoints
-- that have errored for >30 days (FCM returns 410 GONE in that case).

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint      TEXT NOT NULL,
  p256dh        TEXT NOT NULL,
  auth          TEXT NOT NULL,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error_at TIMESTAMPTZ,
  last_error    TEXT,
  UNIQUE (user_id, endpoint)
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON push_subscriptions (user_id);
