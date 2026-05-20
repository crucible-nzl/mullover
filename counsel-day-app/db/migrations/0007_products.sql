-- 0007 · products · single source of truth for price/copy that the
-- admin portal can edit and the front-end can read.
--
-- One row per tier the public sees on /pricing. The 'key' column is
-- the stable identifier referenced by the front-end + Stripe.
-- price_cents is the displayed and charged amount (USD). The
-- stripe_price_id column maps to the Stripe Price object · ALL
-- transactions still use Stripe Prices as the source of truth for
-- billing; this table is presentational + the admin's window into
-- which Price object is currently mapped to each tier.

CREATE TABLE IF NOT EXISTS products (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key               TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  description       TEXT,
  price_cents       INTEGER NOT NULL,
  currency          TEXT NOT NULL DEFAULT 'USD',
  stripe_price_id   TEXT,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  sort_order        INTEGER NOT NULL DEFAULT 100,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by        UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS products_active_idx ON products (is_active, sort_order);

-- Seed the five live tiers · this is the canonical price list as of
-- 2026-05-20. Editable thereafter via /admin-products.
INSERT INTO products (key, name, description, price_cents, currency, sort_order) VALUES
  ('solo_free',       'Solo · first decision',     'Free · your first lifetime Solo decision',                                                                         0,    'USD', 10),
  ('solo_paid',       'Solo · additional decision','Per paid decision · one participant',                                                                              999,  'USD', 20),
  ('couple',          'Couple',                    'Per paid decision · two participants',                                                                             2500, 'USD', 30),
  ('family',          'Family',                    'Per paid decision · three to six participants',                                                                    4000, 'USD', 40),
  ('consumer_annual', 'Consumer Annual',           'Annual all-access · unlimited Solo, Couple, and Family decisions on one account for twelve months',                9900, 'USD', 50)
ON CONFLICT (key) DO NOTHING;
