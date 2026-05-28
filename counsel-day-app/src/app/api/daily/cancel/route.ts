/**
 * POST /api/daily/cancel
 *
 * Cancel the signed-in user's Counsel Journal Pro subscription at the
 * end of the current period. Uses Stripe's cancel_at_period_end flag
 * so the user keeps Pro access until the next renewal date and then
 * drops to the free tier. The user can un-cancel from the Stripe
 * portal until that date.
 *
 * The webhook handler picks up `customer.subscription.updated` and
 * mirrors `cancel_at_period_end` into daily_subscriptions; this route
 * does NOT touch the row directly.
 *
 * Returns:
 *   200 { ok: true,  ends_at: ISO timestamp }
 *   401 { ok: false, message: 'You must be signed in.' }
 *   404 { ok: false, message: 'No active Journal Pro subscription.' }
 *   503 { ok: false, message: 'Billing is not configured.' }
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

  const rows = await db
    .select({
      subId: schema.dailySubscriptions.stripeSubscriptionId,
      status: schema.dailySubscriptions.status,
      cancelAtPeriodEnd: schema.dailySubscriptions.cancelAtPeriodEnd,
    })
    .from(schema.dailySubscriptions)
    .where(eq(schema.dailySubscriptions.userId, session.userId))
    .limit(1);

  if (rows.length === 0 || !rows[0].subId || rows[0].status !== 'active') {
    return NextResponse.json(
      { ok: false, message: 'No active Journal Pro subscription on this account.' },
      { status: 404 },
    );
  }

  if (rows[0].cancelAtPeriodEnd) {
    return NextResponse.json(
      { ok: true, already_scheduled: true, message: 'Cancellation already scheduled.' },
      { status: 200 },
    );
  }

  // Flip the Stripe sub to cancel_at_period_end. The webhook will
  // mirror this into daily_subscriptions; we don't write to the row
  // directly so the state remains single-sourced.
  try {
    const sub = await stripe.subscriptions.update(rows[0].subId, {
      cancel_at_period_end: true,
    });
    const periodEnd = (sub as unknown as { current_period_end?: number }).current_period_end;
    return NextResponse.json(
      {
        ok: true,
        ends_at: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
        message: 'Journal Pro will end at the close of the current billing period.',
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('[daily/cancel] Stripe update failed', err);
    return NextResponse.json(
      {
        ok: false,
        message: 'Could not cancel right now. Open the Stripe portal from the account page and cancel there.',
      },
      { status: 500 },
    );
  }
}
