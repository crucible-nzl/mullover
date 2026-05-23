-- find-unpaid-decisions.sql
--
-- Recovery helper: after migration 0018 lands, any couple/family decision
-- created under the old code is in 'pending_invites' but has NOT been paid
-- for (no stripe_payment_intent_id). Under the new payment-first gate, the
-- correct state for those rows is 'pending_payment'.
--
-- Run on the server (as the deploy user) with:
--   psql "$DATABASE_URL" -f scripts/find-unpaid-decisions.sql
--
-- The first query is read-only: it surfaces what's affected.
-- The second query is the migration (commented out · uncomment to run).

-- ============================================================
-- 1. INSPECT · who's affected?
-- ============================================================
SELECT
  d.id,
  d.tier,
  d.status,
  d.question,
  d.amount_paid_cents,
  d.stripe_payment_intent_id IS NOT NULL AS has_payment,
  d.created_at,
  u.email AS owner_email,
  (SELECT count(*) FROM participants p WHERE p.decision_id = d.id) AS participant_count,
  (SELECT count(*) FROM participants p WHERE p.decision_id = d.id AND p.invite_accepted_at IS NOT NULL) AS accepted_count
FROM decisions d
JOIN users u ON u.id = d.owner_user_id
WHERE d.tier IN ('couple', 'family', 'solo_paid')
  AND d.status IN ('pending_invites', 'active')
  AND d.stripe_payment_intent_id IS NULL
ORDER BY d.created_at DESC;

-- ============================================================
-- 2. RECOVER · uncomment and run after reviewing #1 above
-- ============================================================
-- Move unpaid couple/family/solo_paid decisions to 'pending_payment'.
-- This forces the owner to complete payment via the "Complete payment"
-- button on /decisions.html before any invites can be accepted.
--
-- Excludes rows where the partner has already accepted AND voted, because
-- those rows have user-generated data we'd disrupt by sending the owner
-- back to checkout. Inspect those manually.

-- BEGIN;
--
-- UPDATE decisions d
-- SET status = 'pending_payment',
--     updated_at = NOW()
-- WHERE d.tier IN ('couple', 'family', 'solo_paid')
--   AND d.status = 'pending_invites'
--   AND d.stripe_payment_intent_id IS NULL
--   AND NOT EXISTS (
--     SELECT 1 FROM votes v WHERE v.decision_id = d.id
--   );
--
-- -- Log the recovery for the audit trail
-- INSERT INTO audit_log (action, target_type, target_id, metadata)
-- SELECT
--   'decision.recovered_to_pending_payment',
--   'decision',
--   d.id,
--   jsonb_build_object('tier', d.tier, 'previous_status', 'pending_invites', 'reason', 'pre-0018 unpaid')
-- FROM decisions d
-- WHERE d.tier IN ('couple', 'family', 'solo_paid')
--   AND d.status = 'pending_payment'
--   AND d.updated_at > NOW() - INTERVAL '5 minutes';
--
-- COMMIT;

-- ============================================================
-- 3. NUKE · if you'd rather wipe the test data and start fresh
-- ============================================================
-- Use this for decisions that were tests you don't care about. Cascades
-- to participants, votes, verdict-related rows via FK ON DELETE CASCADE.

-- DELETE FROM decisions d
-- WHERE d.id = 'PASTE-DECISION-UUID-HERE'
--   AND d.owner_user_id IN (
--     SELECT id FROM users WHERE email IN ('admin@counsel.day', 'james@counsel.day')
--   );
