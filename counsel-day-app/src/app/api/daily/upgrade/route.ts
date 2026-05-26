/**
 * POST /api/daily/upgrade
 *
 * Begin a Counsel · Daily Pro subscription via Stripe Checkout in
 * subscription mode. Returns the Checkout URL; client redirects.
 *
 * The actual fulfillment (flipping daily_subscriptions to 'active')
 * happens in the Stripe webhook on customer.subscription.created /
 * updated. This route does NOT touch daily_subscriptions itself.
 *
 * Pre-launch operator step:
 *   1. Create a Product "Counsel · Daily Pro" in Stripe Dashboard
 *   2. Create a recurring Price · $4.99 USD / month
 *   3. Set STRIPE_DAILY_PRO_PRICE_ID in env.local to the price_xxx id
 *   4. Re-deploy
 */

import { NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { readSession, readSessionCookie } from '@/lib/sessions';
import { getStripe } from '@/lib/stripe';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const session = await readSession(readSessionCookie(req.headers));
  if (!session) {
    return NextResponse.json({ ok: false, message: 'You must be signed in.' }, { status: 401 });
  }

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ ok: false, message: 'Billing is not configured.' }, { status: 503 });
  }
  const priceId = process.env.STRIPE_DAILY_PRO_PRICE_ID;
  if (!priceId) {
    return NextResponse.json(
      { ok: false, message: 'Daily Pro is not yet available · STRIPE_DAILY_PRO_PRICE_ID unset.' },
      { status: 503 }
    );
  }

  // If the user is already an active Pro subscriber, send them to the
  // billing portal instead of starting a duplicate subscription.
  const existing = await db
    .select({
      status: schema.dailySubscriptions.status,
      customerId: schema.dailySubscriptions.stripeCustomerId,
      periodEnd: schema.dailySubscriptions.currentPeriodEnd,
    })
    .from(schema.dailySubscriptions)
    .where(eq(schema.dailySubscriptions.userId, session.userId))
    .limit(1);
  if (existing.length > 0 && existing[0].status === 'active' && existing[0].periodEnd && existing[0].periodEnd > new Date()) {
    return NextResponse.json({ ok: false, message: 'You are already a Daily Pro subscriber.' }, { status: 409 });
  }

  // Look up email for prefill (Stripe needs a customer or customer_email).
  const userRow = await db
    .select({ email: schema.users.email, customerId: schema.users.stripeCustomerId })
    .from(schema.users)
    .where(eq(schema.users.id, session.userId))
    .limit(1);
  const user = userRow[0];
  if (!user) {
    return NextResponse.json({ ok: false, message: 'User not found.' }, { status: 404 });
  }

  const baseUrl = process.env.APP_BASE_URL ?? 'https://counsel.day';
  const checkoutSession = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${baseUrl}/daily?upgraded=1`,
    cancel_url: `${baseUrl}/daily?upgrade=cancelled`,
    customer: user.customerId ?? undefined,
    customer_email: user.customerId ? undefined : user.email,
    client_reference_id: session.userId,
    metadata: { user_id: session.userId, product: 'daily_pro' },
    subscription_data: {
      metadata: { user_id: session.userId, product: 'daily_pro' },
    },
    allow_promotion_codes: true,
    // When a 100%-off promo code reduces the FIRST invoice to $0,
    // Stripe still wants a card on file by default (for the next
    // billing cycle). 'if_required' tells Stripe to only collect a
    // payment method when an amount is actually due NOW · 100%-off
    // subscriptions skip the card form entirely. Future renewals
    // still need a card, but Stripe handles that via a hosted
    // re-authorization email when the trial / coupon expires.
    payment_method_collection: 'if_required',
  });

  return NextResponse.json({ ok: true, url: checkoutSession.url }, { status: 200 });
}
