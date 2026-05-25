-- 0025 · bind the live Stripe Price IDs to the products table
--
-- The /admin-products Stripe-sync check has been flagging every paid
-- tier as "No Stripe Price ID set" because the DB column was NULL.
-- The actual Price objects exist on Stripe (counsel-day-prod account)
-- and have been live since the 2026-05-25 pricing review:
--
--   solo_paid · $9.99 USD  · price_1Talpy1dpiTLSONVSXrcwUlF
--   couple    · $15.99 USD · price_1Taloz1dpiTLSONVb7qWrHZd
--   family    · $29.99 USD · price_1Talo81dpiTLSONVQ1sIu4f1
--
-- solo_free stays NULL · free tiers don't need a Stripe Price.
-- consumer_annual stays NULL · retired in 0021 (is_active = false).
--
-- These IDs were captured in chat with James and are Stripe Price
-- object identifiers · they are NOT secrets (the secret_key is what
-- gates use of them).

BEGIN;

UPDATE products
   SET stripe_price_id = 'price_1Talpy1dpiTLSONVSXrcwUlF',
       updated_at      = NOW()
 WHERE key = 'solo_paid';

UPDATE products
   SET stripe_price_id = 'price_1Taloz1dpiTLSONVb7qWrHZd',
       updated_at      = NOW()
 WHERE key = 'couple';

UPDATE products
   SET stripe_price_id = 'price_1Talo81dpiTLSONVQ1sIu4f1',
       updated_at      = NOW()
 WHERE key = 'family';

COMMIT;
