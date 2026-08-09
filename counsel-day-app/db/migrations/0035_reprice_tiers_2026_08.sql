-- 0035 · re-price the tiers (2026-08) · display prices only
--
-- New customer-facing prices set 2026-08-10. The `products` table drives the
-- DISPLAY price on /pricing (and the admin products editor); the amount
-- actually CHARGED is the linked Stripe Price object (checkout uses
-- stripe_price_id via line_items), NOT price_cents. So this migration changes
-- what customers SEE. The matching Stripe Price objects + their price_id
-- bindings are rotated separately by the operator in the Stripe dashboard +
-- /admin-products.
--
-- Price changes (price_cents · USD):
--   solo_paid        999  -> 499   ($9.99  -> $4.99)
--   couple          1599  -> 999   ($15.99 -> $9.99)   [live value was 1599]
--   family          2999  -> 1999  ($29.99 -> $19.99)  [live value was 2999]
--   consumer_annual 9900  -> 4999  ($99.00 -> $49.99)  [legacy · still inactive]
--   solo_free          0  ->    0  (unchanged · free)
--
-- Also refreshes the two Solo descriptions to state the duration rules:
-- the free first decision runs for 7 days only; paid Solo runs 7 to 90 days
-- (see the free-tier 7-day cap enforced in src/app/api/compose[/guest]/route.ts).
--
-- Idempotent · re-running sets the same values. Runs on first deploy.

UPDATE products SET price_cents = 499,  description = 'Per paid decision · one participant · 7 to 90 days', updated_at = NOW() WHERE key = 'solo_paid';
UPDATE products SET price_cents = 999,  updated_at = NOW() WHERE key = 'couple';
UPDATE products SET price_cents = 1999, updated_at = NOW() WHERE key = 'family';
UPDATE products SET price_cents = 4999, updated_at = NOW() WHERE key = 'consumer_annual';
UPDATE products SET description = 'Free · your first lifetime Solo decision · 7 days only', updated_at = NOW() WHERE key = 'solo_free';
