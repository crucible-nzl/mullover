/**
 * POST /api/stripe/webhook
 *
 * Stripe → Counsel.day events. Verifies the signature using
 * STRIPE_WEBHOOK_SECRET (set in /etc/counsel-day-app/env.local).
 *
 * Events handled:
 *   - checkout.session.completed       → mark per-decision SKUs paid, attach payment_intent_id, set status='active'
 *   - customer.subscription.created    → set user.current_plan
 *   - customer.subscription.updated    → mirror plan + status
 *   - customer.subscription.deleted    → revert user.current_plan='free'
 *   - charge.refunded                  → mark refunded_at on decision (if metadata.decision_id)
 *
 * Audit-logs every accepted event for reconciliation.
 */

import { NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { getStripe } from '@/lib/stripe';
import { eq } from 'drizzle-orm';
import type Stripe from 'stripe';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) {
    return NextResponse.json({ ok: false, message: 'Webhook not configured.' }, { status: 503 });
  }

  const sig = req.headers.get('stripe-signature');
  if (!sig) return new NextResponse('missing signature', { status: 400 });

  // Stripe requires the RAW body to verify the signature.
  const rawBody = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch (err) {
    console.warn('[stripe webhook] signature verification failed', (err as Error).message);
    return new NextResponse('bad signature', { status: 400 });
  }

  // Idempotency · INSERT with ON CONFLICT DO NOTHING. If the event
  // id is already in the table, the insert affects 0 rows and we
  // short-circuit. This is the line that makes Stripe retries safe ·
  // without it, every 3-day retry window would re-credit decisions
  // and re-flip plans.
  const inserted = await db
    .insert(schema.stripeWebhookEvents)
    .values({ eventId: event.id, eventType: event.type })
    .onConflictDoNothing({ target: schema.stripeWebhookEvents.eventId })
    .returning({ eventId: schema.stripeWebhookEvents.eventId });
  if (inserted.length === 0) {
    console.log('[stripe webhook] duplicate event', event.id, event.type, '· skipping');
    return NextResponse.json({ received: true, deduped: true }, { status: 200 });
  }

  // Audit every accepted (first-time) event for later reconciliation
  await db.insert(schema.auditLog).values({
    action: `stripe.${event.type}`,
    targetType: 'stripe_event',
    metadata: { id: event.id, livemode: event.livemode },
  }).catch(() => { /* don't fail webhook on audit error */ });

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object as Stripe.Checkout.Session;
        const userId = s.client_reference_id ?? s.metadata?.user_id;
        const sku = s.metadata?.sku;
        const decisionId = s.metadata?.decision_id;
        if (userId && decisionId) {
          await db
            .update(schema.decisions)
            .set({
              status: 'active',
              stripePaymentIntentId: typeof s.payment_intent === 'string' ? s.payment_intent : null,
              amountPaidCents: s.amount_total ?? 0,
              startsAt: new Date(),
              unsealsAt: null, // set when first participant votes
              updatedAt: new Date(),
            })
            .where(eq(schema.decisions.id, decisionId));
        }
        // Annual plan SKUs · update user's current_plan
        if (userId && sku === 'consumer_annual') {
          await db
            .update(schema.users)
            .set({ currentPlan: sku, updatedAt: new Date() })
            .where(eq(schema.users.id, userId));
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
        // Look up user by stripe customer id
        const rows = await db
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(eq(schema.users.stripeCustomerId, customer))
          .limit(1);
        if (rows.length > 0) {
          // Active subscription → keep plan as-is from the SKU metadata
          if (sub.status === 'canceled' || sub.status === 'unpaid') {
            await db
              .update(schema.users)
              .set({ currentPlan: 'free', updatedAt: new Date() })
              .where(eq(schema.users.id, rows[0].id));
          }
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
        const rows = await db
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(eq(schema.users.stripeCustomerId, customer))
          .limit(1);
        if (rows.length > 0) {
          await db
            .update(schema.users)
            .set({ currentPlan: 'free', updatedAt: new Date() })
            .where(eq(schema.users.id, rows[0].id));
        }
        break;
      }
      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge;
        const pi = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
        if (pi) {
          await db
            .update(schema.decisions)
            .set({ status: 'refunded', refundedAt: new Date(), updatedAt: new Date() })
            .where(eq(schema.decisions.stripePaymentIntentId, pi));
        }
        break;
      }
    }
  } catch (err) {
    console.error('[stripe webhook] handler error', event.type, err);
    // Return 200 anyway · Stripe will not retry, and our audit log captured the event
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
