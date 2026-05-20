/**
 * GET /api/products
 *
 * Public endpoint · returns the active product list with display
 * prices. Used by /pricing.html, /signup.html, and any page that
 * shows tier prices.
 *
 * Cached for 5 minutes at the edge · prices change rarely (manually,
 * via /admin-products) and live behind Caddy's no-cache HTML header
 * is wasteful. Behaviour:
 *   · short Cache-Control · 300s, public, stale-while-revalidate 60
 *   · response payload is small (5 rows × ~120 bytes)
 *
 * Returns the active rows only. The admin endpoint returns all rows
 * (active and inactive) with management metadata.
 */

import { NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { asc, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const rows = await db
    .select({
      key: schema.products.key,
      name: schema.products.name,
      description: schema.products.description,
      price_cents: schema.products.priceCents,
      currency: schema.products.currency,
      sort_order: schema.products.sortOrder,
    })
    .from(schema.products)
    .where(eq(schema.products.isActive, true))
    .orderBy(asc(schema.products.sortOrder));

  return NextResponse.json(
    { ok: true, products: rows },
    {
      status: 200,
      headers: { 'cache-control': 'public, max-age=300, stale-while-revalidate=60' },
    }
  );
}
