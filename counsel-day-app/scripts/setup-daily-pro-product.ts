/**
 * scripts/setup-daily-pro-product.ts
 *
 * Idempotent · creates the "Counsel · Daily Pro" Stripe Product and a
 * recurring monthly Price at $4.99 USD if they don't already exist.
 * Prints the Price id to stdout so you can paste it into env.local.
 *
 * Usage (on the server, or anywhere with STRIPE_SECRET_KEY in the env):
 *   cd /opt/counsel-day-app
 *   set -a; source /etc/counsel-day-app/env.local; set +a
 *   npx tsx scripts/setup-daily-pro-product.ts
 *
 * Output:
 *   Counsel · Daily Pro · prod_xxxxxxxxxxxxxx
 *   Recurring price · price_xxxxxxxxxxxxxx
 *
 *   Add this line to /etc/counsel-day-app/env.local:
 *     STRIPE_DAILY_PRO_PRICE_ID=price_xxxxxxxxxxxxxx
 *
 * Re-runs are safe · existing product / price are matched by name and
 * (unit_amount, currency, interval) respectively and reused. No
 * duplicates are ever created.
 */

import 'dotenv/config';
import Stripe from 'stripe';

const PRODUCT_NAME = 'Counsel · Daily Pro';
const UNIT_AMOUNT_CENTS = 499;
const CURRENCY = 'usd';
const INTERVAL = 'month';
const DESCRIPTION = 'Voice journal entries, monthly themed deep-dive verdict, and attach-to-decision linking on Counsel.day.';

async function main() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error('STRIPE_SECRET_KEY not set. Source /etc/counsel-day-app/env.local first.');
    process.exit(1);
  }
  const stripe = new Stripe(key);

  // 1. Find or create the Product.
  let product: Stripe.Product | null = null;
  // List up to 100 active products and match on exact name. Cheap;
  // we have well under 100 products on the account.
  const products = await stripe.products.list({ limit: 100, active: true });
  product = products.data.find((p) => p.name === PRODUCT_NAME) ?? null;

  if (!product) {
    product = await stripe.products.create({
      name: PRODUCT_NAME,
      description: DESCRIPTION,
      metadata: { app: 'counsel.day', sku: 'daily_pro' },
    });
    console.log(`Created product · ${product.id}`);
  } else {
    console.log(`Found existing product · ${product.id}`);
  }

  // 2. Find or create the recurring Price.
  let price: Stripe.Price | null = null;
  const prices = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
  price = prices.data.find((p) =>
    p.unit_amount === UNIT_AMOUNT_CENTS &&
    p.currency === CURRENCY &&
    p.recurring?.interval === INTERVAL
  ) ?? null;

  if (!price) {
    price = await stripe.prices.create({
      product: product.id,
      unit_amount: UNIT_AMOUNT_CENTS,
      currency: CURRENCY,
      recurring: { interval: INTERVAL },
      nickname: `${PRODUCT_NAME} · $${(UNIT_AMOUNT_CENTS / 100).toFixed(2)} USD / ${INTERVAL}`,
      metadata: { app: 'counsel.day', sku: 'daily_pro' },
    });
    console.log(`Created price · ${price.id}`);
  } else {
    console.log(`Found existing price · ${price.id}`);
  }

  console.log('');
  console.log(`${PRODUCT_NAME} · ${product.id}`);
  console.log(`Recurring price · ${price.id} · $${(UNIT_AMOUNT_CENTS / 100).toFixed(2)} ${CURRENCY.toUpperCase()} / ${INTERVAL}`);
  console.log('');
  console.log('Add this line to /etc/counsel-day-app/env.local:');
  console.log(`  STRIPE_DAILY_PRO_PRICE_ID=${price.id}`);
  console.log('');
  console.log('Then: sudo systemctl restart counsel-day-app');
}

main().catch((err) => {
  console.error('setup-daily-pro-product failed:', err.message ?? err);
  process.exit(1);
});
