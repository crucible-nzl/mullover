-- 0018 · payment-first gate for paid decisions
--
-- BUG: prior flow created paid couple/family decisions in 'pending_invites'
-- and sent invite emails immediately, before any payment was made. Invite
-- acceptance then flipped the decision to 'active' without checking whether
-- payment had cleared. Net effect: a partner could accept and the decision
-- could run to verdict-generation without the owner ever paying.
--
-- FIX: add a new 'pending_payment' status that paid decisions sit in
-- between compose-time and webhook-confirmed payment. The
-- checkout.session.completed webhook is what moves them out of it.
--
-- Also add a paid_at timestamp so we can audit-trail when payment cleared
-- without inferring it from stripe_payment_intent_id presence.
--
-- This migration is forward-only and additive · existing decision rows are
-- not touched. Any decision in 'pending_invites' at deploy-time stays there
-- and behaves as before (the application code only puts NEW paid decisions
-- into 'pending_payment').

BEGIN;

-- Add the new status to the CHECK constraint by recreating it. Postgres
-- does not support ALTER CHECK CONSTRAINT; the only way is drop + add.
ALTER TABLE decisions DROP CONSTRAINT IF EXISTS decisions_status_check;
ALTER TABLE decisions ADD CONSTRAINT decisions_status_check
  CHECK (status IN (
    'pending_payment',     -- NEW · paid tier, awaiting Stripe webhook
    'pending_invites',     -- free OR paid-and-confirmed, awaiting partner accept
    'active',              -- running, accepting daily votes
    'sealed',              -- duration elapsed, awaiting verdict generation
    'verdict_generating',  -- Claude is composing the verdict
    'completed',           -- verdict revealed
    'cancelled',           -- owner pulled the plug before verdict
    'refunded'             -- charge.refunded fired
  ));

-- Audit trail of when payment cleared. NULL for free tiers; NOT NULL after
-- the first payment-success webhook lands. We don't backfill old rows
-- because there is no reliable signal (could be retroactive guess from
-- stripe_payment_intent_id presence, but that's already implied).
ALTER TABLE decisions
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

-- Index so the cron job that emails "still pending payment after 24h"
-- doesn't have to seq-scan.
CREATE INDEX IF NOT EXISTS decisions_paid_at_idx ON decisions (paid_at)
  WHERE paid_at IS NULL AND status = 'pending_payment';

COMMIT;
