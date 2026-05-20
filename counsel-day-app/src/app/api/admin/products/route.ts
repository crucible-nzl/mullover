/**
 * GET   /api/admin/products  · admin · returns every product row,
 *                              including inactive
 * PATCH /api/admin/products  · admin · updates a row by id with any
 *                              of: name, description, price_cents,
 *                              currency, stripe_price_id, is_active,
 *                              sort_order
 *
 * Stripe Prices remain immutable on Stripe's side · this admin
 * surface lets the operator (a) edit the price/name/description
 * displayed on /pricing and (b) record which Stripe Price object
 * each tier is bound to. When the operator changes a price on
 * Stripe, they create a NEW Price object and paste its ID here.
 * Display + ID are kept consistent by the admin's discipline,
 * not by an automated sync.
 *
 * Audit-logged with the prior price_cents so price history is
 * inspectable in /admin-verdict-logs / audit_log.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@/lib/db';
import { asc, eq } from 'drizzle-orm';
import { requireAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const rows = await db
    .select({
      id: schema.products.id,
      key: schema.products.key,
      name: schema.products.name,
      description: schema.products.description,
      price_cents: schema.products.priceCents,
      currency: schema.products.currency,
      stripe_price_id: schema.products.stripePriceId,
      is_active: schema.products.isActive,
      sort_order: schema.products.sortOrder,
      updated_at: schema.products.updatedAt,
    })
    .from(schema.products)
    .orderBy(asc(schema.products.sortOrder));

  return NextResponse.json({ ok: true, products: rows }, { headers: { 'cache-control': 'private, no-store' } });
}

const patchSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).optional(),
  price_cents: z.number().int().min(0).max(100_000_00).optional(),
  currency: z.string().trim().length(3).optional(),
  stripe_price_id: z.string().trim().max(120).nullable().optional(),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().min(0).max(10000).optional(),
});

export async function PATCH(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  let raw: unknown;
  try { raw = await req.json(); } catch {
    return NextResponse.json({ ok: false, message: 'Body must be JSON.' }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: 'Some fields are invalid.', errors: parsed.error.flatten() }, { status: 422 });
  }
  const { id, ...patch } = parsed.data;

  const existing = await db
    .select({ id: schema.products.id, key: schema.products.key, priceCents: schema.products.priceCents, name: schema.products.name })
    .from(schema.products)
    .where(eq(schema.products.id, id))
    .limit(1);
  if (existing.length === 0) {
    return NextResponse.json({ ok: false, message: 'Product not found.' }, { status: 404 });
  }
  const prior = existing[0];

  const update: Record<string, unknown> = { updatedAt: new Date(), updatedBy: gate.userId };
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.price_cents !== undefined) update.priceCents = patch.price_cents;
  if (patch.currency !== undefined) update.currency = patch.currency;
  if (patch.stripe_price_id !== undefined) update.stripePriceId = patch.stripe_price_id;
  if (patch.is_active !== undefined) update.isActive = patch.is_active;
  if (patch.sort_order !== undefined) update.sortOrder = patch.sort_order;

  await db.update(schema.products).set(update).where(eq(schema.products.id, id));

  await db.insert(schema.auditLog).values({
    actorUserId: gate.userId,
    action: 'admin.product.updated',
    targetType: 'product',
    targetId: id,
    metadata: {
      key: prior.key,
      prior_name: prior.name,
      prior_price_cents: prior.priceCents,
      changed_fields: Object.keys(patch),
    },
  }).catch(() => {});

  return NextResponse.json({ ok: true, message: 'Product updated.' });
}
