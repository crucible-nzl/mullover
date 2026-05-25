-- 0024 · Pause + Delete for decisions
--
-- TWO USER ACTIONS:
--   · PAUSE for N days · the user is going on holiday, away from the
--     question, etc. We extend unseals_at by N days and stamp
--     paused_until = NOW() + N days. While paused_until > NOW(),
--     voting is blocked and the UI shows "Paused · resumes DATE".
--     When the timestamp passes, voting resumes automatically.
--   · DELETE · the user removes the decision entirely. For unpaid
--     decisions (solo_free, or status='pending_payment') we do a HARD
--     delete and cascade kills participants/votes. For paid decisions
--     we soft-delete via status='cancelled' + cancelled_at so the
--     payment audit trail is preserved (refund is a separate admin
--     flow). The decision disappears from the default Your Decisions
--     list either way.
--
-- Idempotent · safe to re-run.

ALTER TABLE decisions
  ADD COLUMN IF NOT EXISTS paused_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paused_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

-- Backfill cancelled_at for any rows that were already status='cancelled'
-- so the audit history is consistent.
UPDATE decisions
   SET cancelled_at = updated_at
 WHERE status = 'cancelled' AND cancelled_at IS NULL;
