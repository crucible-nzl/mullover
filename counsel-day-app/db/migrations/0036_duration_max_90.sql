-- 0036 · cap decision duration at 90 days (was 365)
--
-- Product decision 2026-08-10: the maximum decision length is 90 days. The
-- free first Solo decision is fixed at 7 days (enforced in the compose
-- routes); all paid tiers run 7 to 90. The 365-day "Annual" duration option
-- has been removed from the composer, and the API validation (src/app/api/
-- compose/route.ts) now caps duration_days at 90. This migration tightens the
-- DB CHECK constraint to match, so the backend enforces 90 at every layer.
--
-- Pulse decisions (mode='pulse') have no fixed duration and stay exempt, per
-- migration 0029.
--
-- Safety: pre-launch there are no real decisions, but a test row could carry
-- a >90 duration (e.g. a 365-day fixture). We cap any such standard row to 90
-- first so the ADD CONSTRAINT cannot fail on deploy. This touches only the
-- display duration; a row's already-set unseals_at is unchanged.

UPDATE decisions
  SET duration_days = 90, updated_at = NOW()
  WHERE mode <> 'pulse' AND duration_days > 90;

ALTER TABLE decisions
  DROP CONSTRAINT IF EXISTS decisions_duration_check;

ALTER TABLE decisions
  ADD CONSTRAINT decisions_duration_check CHECK (
    (mode = 'pulse')
    OR (duration_days BETWEEN 7 AND 90)
  );
