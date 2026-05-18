/**
 * POST /api/billing/portal
 *
 * Creates a Stripe Customer Portal session for the signed-in user and returns
 * the portal URL. The portal is Stripe-hosted and lets the customer:
 *   · view + download invoices and receipts
 *   · update their saved payment method
 *   · cancel an active subscription (Consumer Annual)
 *
 * The user must have a stripe_customer_id on file. They will have one as
 * soon as their first Checkout completed; this endpoint refuses (404) if
 * they have none yet · the UI should hide the "Manage billing" button
 * until /api/me reports `has_stripe_customer: true`.
 *
 * Portal configuration is controlled in the Stripe Dashboard:
 *   Settings → Billing → Customer portal
 * Activate "Invoice history", "Subscription cancellation", and
 * "Payment method update" there. Branding (logo, colours) is also there.
 *
 * Returns 503 if STRIPE_SECRET_KEY is unset · symmetrical with checkout/create.
 */

import { NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { readSession, readSessionCookie } from '@/lib/sessions';
import { getStripe } from '@/lib/stripe';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BASE = process.env.APP_BASE_URL ?? 'https://counsel.day';

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
      { ok: false, message: 'Billing is not yet enabled.' },
      { status: 503 }
    );
  }

  // ---- look up stripe customer id ----
  const userRows = await db
    .select({
      id: schema.users.id,
      stripeCustomerId: schema.users.stripeCustomerId,
    })
    .from(schema.users)
    .where(eq(schema.users.id, session.userId))
    .limit(1);
  if (userRows.length === 0) {
    return NextResponse.json({ ok: false, message: 'Account not found.' }, { status: 404 });
  }
  const customerId = userRows[0].stripeCustomerId;
  if (!customerId) {
    return NextResponse.json(
      { ok: false, message: 'No billing history yet. Once you complete your first checkout the portal becomes available.' },
      { status: 404 }
    );
  }

  // ---- create portal session ----
  // Surface configuration errors as a clean 503 with the underlying reason
  // logged server-side, so the UI can render a useful message rather than
  // a generic failure.
  try {
    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${BASE}/billing`,
    });
    return NextResponse.json({ ok: true, url: portal.url }, { status: 200 });
  } catch (err) {
    const message = (err as Error).message ?? 'Unknown error';
    console.warn('[billing/portal · stripe error]', { user_id: session.userId, message });
    // The most common cause here is "No configuration provided and your test
    // mode default configuration has not been created" · the user needs to
    // activate the portal in Stripe Dashboard → Settings → Billing → Customer portal.
    return NextResponse.json(
      { ok: false, message: 'Billing portal is not configured yet. Please contact support.' },
      { status: 503 }
    );
  }
}
