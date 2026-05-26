-- 0026 · The Daily Counsel · evening reflection journal
--
-- New product line inside Counsel.day · the freemium daily-journal
-- companion to the flagship sealed-decision instrument. Every evening
-- the user records 30-180 seconds of voice OR types a short reflection.
-- The entry is SEALED FOR 7 DAYS (same DNA as decisions) · the user
-- cannot re-read it for a week. Sunday-evening cron reads the past
-- 7 days of UNSEALED entries and ships a Monday-morning verdict in the
-- Counsel.day editorial voice: 3-5 recurring positives, 1-2 strains,
-- one paragraph throughline, one concrete question for the week ahead.
--
-- Pricing model (revised from 2026-05-23 spec):
--   · FREE tier · text entries, weekly verdict, 7-day seal
--   · PRO tier ($4.99 USD / month) · voice input + Whisper transcript,
--     monthly themed deep-dive verdict, attach-to-decision (link a
--     specific entry to an active sealed decision so the verdict on
--     close-day pulls supporting evidence from the daily entries)
--
-- Privacy posture:
--   · Audio uploaded to Hetzner Object Storage with server-side
--     encryption; URL is presigned-fetch only.
--   · Whisper API is the no-training tier (mandatory per privacy.html).
--   · The 7-day seal is enforced at the QUERY layer, not just the UI ·
--     a row with unseals_at > NOW() is invisible to every endpoint that
--     reads entries for the user (the cron is the only exception, and
--     it reads only entries that have already passed unseals_at).
--   · Hard-delete via /api/me/export-and-delete cascades to journal
--     entries and tombstones the audio object.
--
-- Tables:
--   journal_entries     · one row per evening submission
--   journal_verdicts    · one row per weekly digest run (Sunday)
--   daily_subscriptions · user's tier flag + monthly billing state

CREATE TABLE IF NOT EXISTS journal_entries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_date        DATE NOT NULL,                       -- the calendar date this entry covers (user's local; client supplies)
  text_content      TEXT,                                -- typed entry (free + pro)
  audio_url         TEXT,                                -- Hetzner Object Storage URL (pro only)
  transcript        TEXT,                                -- Whisper output (pro only)
  duration_seconds  NUMERIC,                             -- length of the audio clip (pro only)
  word_count        INTEGER,                             -- denormalised for fast verdict prompt sizing
  language          TEXT DEFAULT 'en',                   -- Whisper-detected, or 'en' for typed entries
  sentiment         NUMERIC,                             -- VADER compound (-1..1); filled async, nullable
  attached_decision_id UUID REFERENCES decisions(id) ON DELETE SET NULL, -- pro-tier · link to active flagship decision
  sealed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- when the seal began
  unseals_at        TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS journal_entries_user_date_idx ON journal_entries (user_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS journal_entries_unseals_idx ON journal_entries (unseals_at) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_user_date_unique ON journal_entries (user_id, entry_date) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS journal_verdicts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_starts_on    DATE NOT NULL,                       -- Monday of the week being summarised
  week_ends_on      DATE NOT NULL,                       -- the Sunday at end of that week
  kind              TEXT NOT NULL DEFAULT 'weekly',      -- 'weekly' or 'monthly' (pro tier deep-dive)
  entries_count     INTEGER NOT NULL DEFAULT 0,
  positives         JSONB NOT NULL DEFAULT '[]'::jsonb,  -- ["the morning runs felt sustainable", ...]
  strains           JSONB NOT NULL DEFAULT '[]'::jsonb,
  throughline       TEXT,                                -- one paragraph
  question_for_next TEXT,                                -- single concrete prompt
  model             TEXT,                                -- e.g. 'claude-opus-4-7'
  tokens_in         INTEGER,
  tokens_out        INTEGER,
  cost_cents        INTEGER,
  delivered_email_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS journal_verdicts_user_week_idx ON journal_verdicts (user_id, week_starts_on DESC);
CREATE UNIQUE INDEX IF NOT EXISTS journal_verdicts_user_week_unique ON journal_verdicts (user_id, week_starts_on, kind);

-- Subscription state per user. Free tier needs no row; Pro tier
-- creates a row when the user upgrades and updates it on Stripe events.
-- A user is on Pro iff a row exists with status='active' and
-- current_period_end > NOW().
CREATE TABLE IF NOT EXISTS daily_subscriptions (
  user_id              UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  stripe_customer_id   TEXT,
  stripe_subscription_id TEXT,
  stripe_price_id      TEXT,
  status               TEXT NOT NULL DEFAULT 'inactive',  -- 'active' | 'past_due' | 'canceled' | 'inactive'
  current_period_start TIMESTAMPTZ,
  current_period_end   TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  started_at           TIMESTAMPTZ,
  canceled_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS daily_subscriptions_status_idx ON daily_subscriptions (status);
CREATE UNIQUE INDEX IF NOT EXISTS daily_subscriptions_stripe_sub_unique ON daily_subscriptions (stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;
