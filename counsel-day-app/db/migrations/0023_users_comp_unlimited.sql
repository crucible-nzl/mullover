-- 0023 · admin "comp" mechanic
--
-- Operator can grant a user the "unlimited free decisions" flag · used
-- for: testing real flows without Stripe, comping early supporters,
-- comping practitioners who themselves use the product, etc.
--
-- A comped user's POST to /api/compose skips the pending_payment state
-- and lands directly in `active` (Solo) or `pending_invites` (Couple/
-- Family). No Stripe checkout is opened. The decision is audit-logged
-- as `decision.comped` rather than `decision.created` so cohort reports
-- can exclude comped decisions cleanly.
--
-- Three fields capture the metadata: reason (free-text), granted_at,
-- granted_by (the admin who flipped the flag). Revoking is a hard set
-- back to false + clearing the three fields.
--
-- Forward-only, additive · no existing rows are modified.

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS comp_unlimited   BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS comp_reason      TEXT,
  ADD COLUMN IF NOT EXISTS comp_granted_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS comp_granted_by  UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS users_comp_unlimited_idx
  ON users (comp_unlimited)
  WHERE comp_unlimited = true;

COMMIT;
