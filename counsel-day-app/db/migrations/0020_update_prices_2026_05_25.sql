-- 0020 · price update 2026-05-25
--
-- Pricing review · drops Couple from $25 → $15.99 USD and Family from
-- $49 (or $40 in some places) → $29.99 USD. Solo Paid stays at $9.99
-- USD; Solo Free stays free; Consumer Annual stays $99 USD/year.
--
-- The products table is consumed by /admin-products.html for display +
-- by the Stripe sync check. Stripe Prices themselves are immutable ·
-- the operator updates them in the Stripe Dashboard and points the
-- env vars (STRIPE_PRICE_ID_*) at the new Price ids.

BEGIN;

UPDATE products SET price_cents = 999,  updated_at = NOW() WHERE key = 'solo_paid';
UPDATE products SET price_cents = 1599, updated_at = NOW() WHERE key = 'couple';
UPDATE products SET price_cents = 2999, updated_at = NOW() WHERE key = 'family';
-- consumer_annual archived separately in 0021

COMMIT;
