/**
 * GET /api/admin/products/stripe-sync
 *
 * For each product row that has a stripe_price_id, looks up the Price
 * object on Stripe and returns its live state (active, unit_amount,
 * currency, product name). The admin UI calls this to validate that
 * the configured Price IDs actually exist and match what's displayed
 * on /pricing.
 *
 * Returns 503 if STRIPE_SECRET_KEY is unset.
 *
 * Response shape:
 *   {
 *     ok: true,
 *     checked_at: ISO timestamp,
 *     prices: [
 *       { product_id, key, stripe_price_id,
 *         stripe_active, stripe_unit_amount, stripe_currency,
 *         stripe_product_name, db_price_cents, db_currency,
 *         match: { active: boolean, amount: boolean, currency: boolean },
 *         error: string | null
 *       },
 *       …
 *     ]
 *   }
 */

import { NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { asc } from 'drizzle-orm';
import { requireAdmin } from '@/lib/admin-auth';
import { getStripe } from '@/lib/stripe';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json(
      { ok: false, message: 'Stripe is not configured on this environment.' },
      { status: 503 }
    );
  }

  const rows = await db
    .select({
      id: schema.products.id,
      key: schema.products.key,
      stripe_price_id: schema.products.stripePriceId,
      price_cents: schema.products.priceCents,
      currency: schema.products.currency,
      is_active: schema.products.isActive,
    })
    .from(schema.products)
    .orderBy(asc(schema.products.sortOrder));

  type Result = {
    product_id: string;
    key: string;
    stripe_price_id: string | null;
    stripe_active: boolean | null;
    stripe_unit_amount: number | null;
    stripe_currency: string | null;
    stripe_product_name: string | null;
    db_price_cents: number;
    db_currency: string;
    db_is_active: boolean;
    match: { active: boolean; amount: boolean; currency: boolean } | null;
    error: string | null;
  };

  const results: Result[] = await Promise.all(rows.map(async (r) => {
    const base: Result = {
      product_id: r.id,
      key: r.key,
      stripe_price_id: r.stripe_price_id,
      stripe_active: null,
      stripe_unit_amount: null,
      stripe_currency: null,
      stripe_product_name: null,
      db_price_cents: r.price_cents,
      db_currency: r.currency,
      db_is_active: r.is_active,
      match: null,
      error: null,
    };
    if (!r.stripe_price_id) {
      base.error = 'No Stripe Price ID set';
      return base;
    }
    try {
      const price = await stripe.prices.retrieve(r.stripe_price_id, { expand: ['product'] });
      base.stripe_active = price.active;
      base.stripe_unit_amount = price.unit_amount;
      base.stripe_currency = price.currency;
      const product = price.product;
      if (product && typeof product !== 'string' && !('deleted' in product && product.deleted)) {
        base.stripe_product_name = product.name ?? null;
      }
      base.match = {
        active: price.active === r.is_active,
        amount: price.unit_amount === r.price_cents,
        currency: (price.currency || '').toLowerCase() === (r.currency || '').toLowerCase(),
      };
    } catch (err) {
      base.error = (err as Error).message || 'Stripe lookup failed';
    }
    return base;
  }));

  return NextResponse.json(
    { ok: true, checked_at: new Date().toISOString(), prices: results },
    { headers: { 'cache-control': 'private, no-store' } }
  );
}
