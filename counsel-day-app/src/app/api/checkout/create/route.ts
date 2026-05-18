/**
 * POST /api/checkout/create
 *   sku           ('solo_paid' | 'couple' | 'family' | 'consumer_annual')
 *   decision_id   (optional · attached for the per-decision SKUs so the webhook can mark the right row paid)
 *
 * Requires an active session. Creates a Stripe Checkout Session and returns
 * the redirect URL. The user is redirected to Stripe's hosted checkout;
 * after payment, Stripe redirects back to /billing?checkout=success and
 * the webhook (/api/stripe/webhook) is what actually updates DB state.
 *
 * Returns 503 if STRIPE_SECRET_KEY is unset. This is expected during the
 * scaffold period; activating Stripe is a single env-var rotation.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@/lib/db';
import { readSession, readSessionCookie } from '@/lib/sessions';
import { getStripe, priceIdForSku, modeForSku, type Sku } from '@/lib/stripe';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BASE = process.env.APP_BASE_URL ?? 'https://counsel.day';

const bodySchema = z.object({
  sku: z.enum(['solo_paid', 'couple', 'family', 'consumer_annual']),
  decision_id: z.string().uuid().optional(),
});

export async function POST(req: Request) {
  // ---- auth ----
  const session = await readSession(readSessionCookie(req.headers));
  if (!session) {
    return NextResponse.json({ ok: false, message: 'You must be signed in.' }, { status: 401 });
  }

  // ---- stripe key present? ----
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json(
      { ok: false, message: 'Checkout is not yet enabled. Coming soon.' },
      { status: 503 }
    );
  }

  // ---- parse ----
  let raw: Record<string, unknown>;
  try {
    const ct = req.headers.get('content-type') ?? '';
    raw = ct.includes('application/json')
      ? ((await req.json()) as Record<string, unknown>)
      : Object.fromEntries((await req.formData()).entries());
  } catch {
    return NextResponse.json({ ok: false, message: 'Could not read request body.' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: 'Invalid checkout request.' }, { status: 422 });
  }
  const { sku, decision_id } = parsed.data;

  // ---- price id ----
  const priceId = priceIdForSku(sku as Sku);
  if (!priceId) {
    return NextResponse.json(
      { ok: false, message: `Stripe price not configured for ${sku}.` },
      { status: 503 }
    );
  }

  // ---- ensure stripe customer ----
  const userRows = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      stripeCustomerId: schema.users.stripeCustomerId,
      firstName: schema.users.firstName,
    })
    .from(schema.users)
    .where(eq(schema.users.id, session.userId))
    .limit(1);
  if (userRows.length === 0) {
    return NextResponse.json({ ok: false, message: 'Account not found.' }, { status: 404 });
  }
  const user = userRows[0];

  let customerId = user.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name: user.firstName ?? undefined,
      metadata: { user_id: user.id },
    });
    customerId = customer.id;
    await db
      .update(schema.users)
      .set({ stripeCustomerId: customerId, updatedAt: new Date() })
      .where(eq(schema.users.id, user.id));
  }

  // ---- create session ----
  const checkout = await stripe.checkout.sessions.create({
    mode: modeForSku(sku as Sku),
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${BASE}/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${BASE}/pricing?checkout=cancelled`,
    /* Tax collection is OFF until counsel.day is GST-registered. Re-enable
       once a tax registration is added in the Stripe dashboard. */
    automatic_tax: { enabled: false },
    metadata: {
      user_id: user.id,
      sku,
      decision_id: decision_id ?? '',
    },
    client_reference_id: user.id,
    allow_promotion_codes: true,
  });

  return NextResponse.json({ ok: true, url: checkout.url }, { status: 200 });
}
