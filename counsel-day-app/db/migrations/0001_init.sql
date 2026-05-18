-- ============================================================
-- COUNSEL.DAY · MIGRATION 0001 · INITIAL SCHEMA
-- ============================================================
-- Tables: users, sessions, email_verification_tokens, password_reset_tokens,
-- decisions, participants, votes, verdicts, consent_log, audit_log.
--
-- Mirrors src/lib/schema.ts. This is the authoritative file run on the
-- production database; the Drizzle schema is the type-safe view used by
-- the app code.
-- ============================================================

-- gen_random_uuid() ships with Postgres 13+ via pgcrypto.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- USERS ----------
CREATE TABLE IF NOT EXISTS users (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 TEXT NOT NULL,
  first_name            TEXT,
  password_hash         TEXT,
  email_verified_at     TIMESTAMPTZ,
  marketing_consent     BOOLEAN NOT NULL DEFAULT FALSE,
  decision_kind_intent  TEXT,
  current_plan          TEXT NOT NULL DEFAULT 'free',
  stripe_customer_id    TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ,
  CONSTRAINT users_plan_check CHECK (current_plan IN ('free', 'solo', 'couple', 'family', 'consumer_annual', 'practitioner_annual'))
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (LOWER(email));
CREATE UNIQUE INDEX IF NOT EXISTS users_stripe_unique ON users (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

-- ---------- SESSIONS ----------
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_agent  TEXT,
  ip_address  INET
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires_at);

-- ---------- EMAIL VERIFICATION TOKENS ----------
CREATE TABLE IF NOT EXISTS email_verification_tokens (
  token       TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS evt_user_idx ON email_verification_tokens (user_id);

-- ---------- PASSWORD RESET TOKENS ----------
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token       TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS prt_user_idx ON password_reset_tokens (user_id);

-- ---------- DECISIONS ----------
CREATE TABLE IF NOT EXISTS decisions (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question                   TEXT NOT NULL,
  format                     TEXT NOT NULL,
  duration_days              INTEGER NOT NULL,
  tier                       TEXT NOT NULL,
  status                     TEXT NOT NULL DEFAULT 'pending_invites',
  starts_at                  TIMESTAMPTZ,
  unseals_at                 TIMESTAMPTZ,
  stripe_payment_intent_id   TEXT,
  amount_paid_cents          INTEGER NOT NULL DEFAULT 0,
  refunded_at                TIMESTAMPTZ,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT decisions_format_check   CHECK (format IN ('yes_no', 'strong_lean', 'a_b')),
  CONSTRAINT decisions_tier_check     CHECK (tier IN ('solo_free', 'solo_paid', 'couple', 'family')),
  CONSTRAINT decisions_status_check   CHECK (status IN ('pending_invites', 'active', 'sealed', 'verdict_generating', 'completed', 'cancelled', 'refunded')),
  CONSTRAINT decisions_duration_check CHECK (duration_days BETWEEN 7 AND 365)
);
CREATE INDEX IF NOT EXISTS decisions_owner_idx  ON decisions (owner_user_id);
CREATE INDEX IF NOT EXISTS decisions_status_idx ON decisions (status);
CREATE INDEX IF NOT EXISTS decisions_unseals_idx ON decisions (unseals_at) WHERE status = 'active';

-- ---------- PARTICIPANTS ----------
CREATE TABLE IF NOT EXISTS participants (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id          UUID NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  user_id              UUID REFERENCES users(id) ON DELETE SET NULL,
  invite_email         TEXT,
  invite_token         TEXT,
  invite_accepted_at   TIMESTAMPTZ,
  display_name         TEXT NOT NULL,
  position             INTEGER NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS participants_decision_idx ON participants (decision_id);
CREATE INDEX IF NOT EXISTS participants_user_idx     ON participants (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS participants_invite_token_unique     ON participants (invite_token) WHERE invite_token IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS participants_decision_position_unique ON participants (decision_id, position);

-- ---------- VOTES ----------
CREATE TABLE IF NOT EXISTS votes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id     UUID NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  participant_id  UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  vote_date       DATE NOT NULL,
  direction       TEXT NOT NULL,
  conviction      NUMERIC(3,2),
  note            TEXT,
  sealed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT votes_direction_check CHECK (direction IN ('yes', 'no', 'strong_yes', 'lean_yes', 'lean_no', 'strong_no', 'a', 'b'))
);
CREATE INDEX IF NOT EXISTS votes_decision_date_idx ON votes (decision_id, vote_date);
CREATE INDEX IF NOT EXISTS votes_participant_idx   ON votes (participant_id);
CREATE UNIQUE INDEX IF NOT EXISTS votes_participant_date_unique ON votes (participant_id, vote_date);

-- ---------- VERDICTS ----------
CREATE TABLE IF NOT EXISTS verdicts (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id                 UUID NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  generated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ai_model                    TEXT,
  synthesis_text              TEXT,
  per_participant_summary     JSONB,
  themes                      JSONB,
  next_conversation_prompt    TEXT,
  prompt_used                 TEXT,
  tokens_input                INTEGER,
  tokens_output               INTEGER,
  cost_cents                  INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS verdicts_decision_unique ON verdicts (decision_id);

-- ---------- CONSENT LOG ----------
CREATE TABLE IF NOT EXISTS consent_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  anon_id       TEXT,
  consent_type  TEXT NOT NULL,
  granted       BOOLEAN NOT NULL,
  source        TEXT,
  ip_address    INET,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS consent_log_user_idx ON consent_log (user_id);

-- ---------- AUDIT LOG ----------
CREATE TABLE IF NOT EXISTS audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  action          TEXT NOT NULL,
  target_type     TEXT,
  target_id       UUID,
  metadata        JSONB,
  ip_address      INET,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx  ON audit_log (actor_user_id);
CREATE INDEX IF NOT EXISTS audit_log_action_idx ON audit_log (action);

-- ---------- MIGRATION TRACKING ----------
CREATE TABLE IF NOT EXISTS _migrations (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  applied_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO _migrations (id, name) VALUES (1, '0001_init')
  ON CONFLICT (id) DO NOTHING;
