-- 0009 · mfa_secrets · TOTP enrolment + recovery codes per user.
--
-- One row per user. A user enrols by calling /api/me/mfa/setup
-- (writes secret + recovery_codes_hashes, sets is_enabled = false)
-- and then confirming a TOTP code to /api/me/mfa/verify-setup
-- (flips is_enabled = true). Disabling deletes the row.
--
-- Storage:
--   · secret             · plain TEXT (Postgres-level encryption at rest)
--   · recovery_codes     · jsonb array of argon2id hashes; one per
--                          recovery code. Plaintext codes are shown
--                          to the user once at enrolment and never
--                          retrievable.
--   · enabled_at         · NULL until /verify-setup succeeds
--   · last_used_at       · last successful TOTP or recovery code use
--
-- Security: the auth flow at /api/signin reads mfa_secrets to know
-- whether to challenge for TOTP after password / magic-link verify.

CREATE TABLE IF NOT EXISTS mfa_secrets (
  user_id              UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret               TEXT NOT NULL,
  recovery_codes       JSONB NOT NULL DEFAULT '[]'::jsonb,
  enabled_at           TIMESTAMPTZ,
  last_used_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- For sign-in, we query by user_id (primary key, no extra index needed).

-- mfa_challenges · short-lived tokens issued after password/magic-link
-- verify when MFA is enabled. The client posts back a code with the
-- challenge id; we verify TOTP, then create the real session.
--
-- Five-minute TTL. Single-use (deleted on success or failure-burst).
CREATE TABLE IF NOT EXISTS mfa_challenges (
  id          TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS mfa_challenges_expires_idx ON mfa_challenges (expires_at);
