-- ============================================================
-- COUNSEL.DAY · MIGRATION 0004 · ADD saved_contacts
-- ============================================================
-- People the user has invited to a decision (partner, family
-- members) get saved here automatically on /api/compose, so
-- the next time they compose a Couple or Family decision they
-- can pick from saved contacts instead of retyping every email.
--
-- Privacy posture:
--   · scoped per user (ON DELETE CASCADE)
--   · email is stored case-insensitive via the LOWER() unique
--     index, but kept in original case for display
--   · no PII beyond display_name + email (relationship is an
--     enum-ish hint, never required)

CREATE TABLE IF NOT EXISTS saved_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  email TEXT NOT NULL,
  relationship TEXT,
  last_invited_at TIMESTAMPTZ,
  invite_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT saved_contacts_relationship_check
    CHECK (relationship IS NULL OR relationship IN ('partner', 'family', 'friend', 'other'))
);

-- Emails are normalised to lowercase before insert (zod .toLowerCase()),
-- so a plain unique index is sufficient AND lets Drizzle's typed
-- onConflictDoUpdate target both columns directly. A functional index
-- on LOWER(email) would not be addressable from Drizzle's typed API.
CREATE UNIQUE INDEX IF NOT EXISTS saved_contacts_user_email_unique
  ON saved_contacts (user_id, email);
CREATE INDEX IF NOT EXISTS saved_contacts_user_idx
  ON saved_contacts (user_id, last_invited_at DESC);
