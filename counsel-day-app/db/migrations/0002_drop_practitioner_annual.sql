-- ============================================================
-- COUNSEL.DAY · MIGRATION 0002 · DROP practitioner_annual FROM users.current_plan
-- ============================================================
-- We removed the Practitioner Annual SKU. Update the CHECK constraint
-- on users.current_plan to drop that value. Defensive: if any row was
-- already on 'practitioner_annual', downgrade to 'free' before the
-- constraint is re-applied.
-- ============================================================

UPDATE users
SET current_plan = 'free'
WHERE current_plan = 'practitioner_annual';

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_plan_check;
ALTER TABLE users ADD CONSTRAINT users_plan_check
  CHECK (current_plan IN ('free', 'solo', 'couple', 'family', 'consumer_annual'));

INSERT INTO _migrations (id, name) VALUES (2, '0002_drop_practitioner_annual')
  ON CONFLICT (id) DO NOTHING;
