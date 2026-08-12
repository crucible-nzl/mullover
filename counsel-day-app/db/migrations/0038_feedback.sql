-- 0038 · in-product feedback capture
--
-- A lightweight store for the one-tap "was this useful?" widget placed at key
-- moments (verdict reveal, decisions list). Pre-launch this is how we learn
-- what the first testers actually think, in their own words.
--
-- Design notes:
--   · user_id is nullable and ON DELETE SET NULL · feedback can come from a
--     logged-out visitor, and deleting an account must not delete the signal
--     (GDPR: the row carries no PII once the user link is severed).
--   · context is a short slug for WHERE the feedback was given (e.g. 'verdict',
--     'decisions'). rating is optional (a thumbs value, 1 or 5); comment is the
--     optional free-text note. The widget posts the rating and the comment as
--     two complementary rows, so either may be null.
--   · No decision content, vote value, or note text is ever stored here · only
--     what the user chose to type into the feedback box.

BEGIN;

CREATE TABLE IF NOT EXISTS feedback (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  context    TEXT NOT NULL,
  rating     INTEGER,
  comment    TEXT,
  page       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS feedback_created_idx ON feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS feedback_context_idx ON feedback (context);

COMMIT;
