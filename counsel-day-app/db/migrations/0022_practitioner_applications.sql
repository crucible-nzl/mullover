-- 0022 · practitioner_applications · referral-program intake
--
-- Replaces the prior `mailto:counsellors@counsel.day` flow on
-- /counsellors and /therapists with a structured form (POST to
-- /api/practitioner/apply, payload validated and stored here).
--
-- Each row is one application. Admin reviews via a future
-- /admin-practitioners page; approval is manual · the operator
-- creates a Stripe coupon + a referral-code mapping, then emails
-- the practitioner.
--
-- No PII is exposed beyond what the practitioner submitted, and
-- the applicant can request deletion at any time.

CREATE TABLE IF NOT EXISTS practitioner_applications (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                          TEXT NOT NULL CHECK (kind IN ('counsellor', 'therapist')),
  first_name                    TEXT NOT NULL,
  last_name                     TEXT NOT NULL,
  email                         TEXT NOT NULL,
  phone                         TEXT,
  practice_name                 TEXT NOT NULL,
  role                          TEXT NOT NULL,
  professional_body             TEXT,
  country                       TEXT NOT NULL,
  city                          TEXT,
  years_in_practice             TEXT,
  active_clients                TEXT,
  expected_referrals_per_month  TEXT NOT NULL,
  payout_method                 TEXT NOT NULL,
  client_focus                  TEXT,
  website                       TEXT,
  notes                         TEXT,
  status                        TEXT NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  referral_code                 TEXT,
  stripe_coupon_id              TEXT,
  reviewed_by                   UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at                   TIMESTAMPTZ,
  ip                            TEXT,
  user_agent                    TEXT,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS practitioner_applications_status_idx
  ON practitioner_applications (status, created_at);

CREATE INDEX IF NOT EXISTS practitioner_applications_email_idx
  ON practitioner_applications (LOWER(email));

-- Optional uniqueness on referral_code so two approved practitioners
-- can't collide on a code. NULL referral_codes ignored.
CREATE UNIQUE INDEX IF NOT EXISTS practitioner_applications_referral_code_idx
  ON practitioner_applications (referral_code)
  WHERE referral_code IS NOT NULL;
