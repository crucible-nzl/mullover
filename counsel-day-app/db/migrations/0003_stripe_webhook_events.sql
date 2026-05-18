-- ============================================================
-- COUNSEL.DAY · MIGRATION 0003 · ADD stripe_webhook_events
-- ============================================================
-- Idempotency table for the Stripe webhook handler. Every accepted
-- event id is recorded here BEFORE any state mutation. Re-deliveries
-- (Stripe retries failed webhooks for up to 3 days) hit the PK
-- conflict and short-circuit without re-running the handler, so a
-- single Stripe event never double-credits a decision or double-flips
-- a subscription plan.
--
-- The audit_log table records what happened at higher fidelity;
-- this table is purely a "have I seen this event id before?" cache.
-- Old rows can be pruned after Stripe's retry window (~3 days) but
-- it costs nothing to keep them and they're useful for reconciliation.

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stripe_webhook_events_type_idx
  ON stripe_webhook_events (event_type, processed_at DESC);
