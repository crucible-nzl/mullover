-- 0021 · retire Consumer Annual SKU (2026-05-25)
--
-- The Consumer Annual ($99 USD/year) all-access subscription has been
-- killed in Stripe and pulled from every public surface. We now sell
-- only per-decision SKUs to consumers: solo_paid, couple, family.
--
-- This migration:
--   · Archives the consumer_annual row in `products` (so admin-
--     products and stripe-sync stop trying to reconcile it)
--   · Drops any user.current_plan='consumer_annual' back to 'free'
--     (defensive · should be zero rows pre-launch)
--
-- The users.current_plan CHECK constraint still accepts 'consumer_annual'
-- as a value · we leave the enum alone so a future re-introduction
-- doesn't need a constraint migration.

BEGIN;

UPDATE products SET is_active = false, updated_at = NOW() WHERE sku = 'consumer_annual';

UPDATE users SET current_plan = 'free', updated_at = NOW() WHERE current_plan = 'consumer_annual';

COMMIT;
