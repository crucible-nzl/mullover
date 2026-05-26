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
import { sendInvitesForDecision } from '@/lib/invites';
import { eq, and, isNull, sql } from 'drizzle-orm';
import type Stripe from 'stripe';

const BASE = process.env.APP_BASE_URL ?? 'https://counsel.day';

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

  // Audit every accepted (first-time) event for later reconciliation.
  // For checkout.session.completed we also capture pricing breakdown
  // (subtotal, discount, total, payment status, coupon/promotion id)
  // so that 100%-off promo-code use is fully traceable · the bare
  // amount_total=0 case otherwise looks identical to a free Solo.
  await db.insert(schema.auditLog).values({
    action: `stripe.${event.type}`,
    targetType: 'stripe_event',
    metadata: {
      id: event.id,
      livemode: event.livemode,
      ...(event.type === 'checkout.session.completed' ? extractCheckoutBreakdown(event.data.object as Stripe.Checkout.Session) : {}),
    },
  }).catch(() => { /* don't fail webhook on audit error */ });

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object as Stripe.Checkout.Session;
        const userId = s.client_reference_id ?? s.metadata?.user_id;
        const sku = s.metadata?.sku;
        const decisionId = s.metadata?.decision_id;
        const paymentIntentId = typeof s.payment_intent === 'string' ? s.payment_intent : null;
        // 100%-off coupons: payment_status === 'no_payment_required',
        // amount_total === 0, payment_intent === null. The status flow
        // still needs to advance · the user "paid" zero dollars but
        // the decision should activate exactly as a normal paid one.
        const isFreeViaCoupon = (s.payment_status === 'no_payment_required') || ((s.amount_total ?? 0) === 0 && !paymentIntentId);
        if (userId && decisionId) {
          // Look up current state so we know what the post-payment status
          // should be. Paid Solo → 'active'. Paid couple/family with
          // outstanding invites → 'pending_invites'. If somehow it's
          // already past 'pending_payment' (re-delivered webhook for an
          // already-resolved decision) we leave it alone.
          const dRows = await db
            .select({
              id: schema.decisions.id,
              tier: schema.decisions.tier,
              status: schema.decisions.status,
              durationDays: schema.decisions.durationDays,
              ownerUserId: schema.decisions.ownerUserId,
              question: schema.decisions.question,
            })
            .from(schema.decisions)
            .where(eq(schema.decisions.id, decisionId))
            .limit(1);

          if (dRows.length > 0) {
            const d = dRows[0];
            const isSolo = d.tier === 'solo_paid';
            const now = new Date();

            // Count outstanding invites (participants without inviteAcceptedAt).
            const pendingRows = await db
              .select({ count: sql<number>`count(*)::int` })
              .from(schema.participants)
              .where(and(
                eq(schema.participants.decisionId, decisionId),
                isNull(schema.participants.inviteAcceptedAt)
              ));
            const pending = pendingRows[0]?.count ?? 0;

            // Target status. If a webhook re-delivers for an already-active
            // or further-along decision, do not regress.
            const advanceableFrom = ['pending_payment', 'pending_invites'];
            const shouldUpdate = advanceableFrom.includes(d.status);
            let nextStatus = d.status;
            let startsAt: Date | null = null;
            let unsealsAt: Date | null = null;

            if (shouldUpdate) {
              if (isSolo) {
                // Solo paid: starts running immediately
                nextStatus = 'active';
                startsAt = now;
                unsealsAt = new Date(now.getTime() + d.durationDays * 24 * 60 * 60 * 1000);
              } else if (pending === 0) {
                // Couple/family but somehow no pending invites · all already
                // attached. Start running.
                nextStatus = 'active';
                startsAt = now;
                unsealsAt = new Date(now.getTime() + d.durationDays * 24 * 60 * 60 * 1000);
              } else {
                nextStatus = 'pending_invites';
              }
            }

            await db
              .update(schema.decisions)
              .set({
                status: nextStatus,
                stripePaymentIntentId: paymentIntentId,
                amountPaidCents: s.amount_total ?? 0,
                paidAt: now,
                ...(startsAt ? { startsAt } : {}),
                ...(unsealsAt ? { unsealsAt } : {}),
                updatedAt: now,
              })
              .where(eq(schema.decisions.id, decisionId));

            // Dedicated audit row for 100%-off coupon use so the
            // admin can distinguish promo-comped decisions from
            // genuine Solo Free in any cohort report later.
            if (isFreeViaCoupon) {
              await db.insert(schema.auditLog).values({
                action: 'decision.paid_via_coupon',
                actorUserId: userId,
                targetType: 'decision',
                targetId: decisionId,
                metadata: {
                  sku,
                  ...extractCheckoutBreakdown(s),
                },
              }).catch(() => { /* never fail webhook on audit error */ });
            }

            // Send the deferred invite emails ONLY if we just transitioned
            // out of pending_payment into pending_invites. Don't fire if
            // we landed at 'active' (no partners to invite) or if the
            // status was already past pending_payment (re-delivery).
            if (d.status === 'pending_payment' && nextStatus === 'pending_invites') {
              await sendInvitesForDecision(decisionId, d.question, d.ownerUserId, 'after_payment');
            }
          }
        }
        break;
      }
      // customer.subscription.* events · The Daily Counsel Pro tier
      // ($4.99 USD/mo) lives in a separate daily_subscriptions table.
      // Any subscription with product='daily_pro' in metadata gets
      // mirrored there. Legacy users.current_plan flip for the long-
      // retired Consumer Annual is retained defensively.
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
        const product = (sub.metadata as Record<string, string> | undefined)?.product;
        const userIdFromMeta = (sub.metadata as Record<string, string> | undefined)?.user_id;

        // Daily Pro subscription fulfillment
        if (product === 'daily_pro' && userIdFromMeta) {
          const priceId = sub.items.data[0]?.price.id ?? null;
          const status = event.type === 'customer.subscription.deleted'
            ? 'canceled'
            : (sub.status === 'active' || sub.status === 'trialing' ? 'active'
              : sub.status === 'past_due' ? 'past_due'
              : sub.status === 'canceled' || sub.status === 'unpaid' ? 'canceled'
              : 'inactive');
          const periodStart = (sub as unknown as { current_period_start?: number }).current_period_start
            ? new Date(((sub as unknown as { current_period_start: number }).current_period_start) * 1000)
            : null;
          const periodEnd = (sub as unknown as { current_period_end?: number }).current_period_end
            ? new Date(((sub as unknown as { current_period_end: number }).current_period_end) * 1000)
            : null;

          await db.execute(sql`
            INSERT INTO daily_subscriptions (
              user_id, stripe_customer_id, stripe_subscription_id, stripe_price_id,
              status, current_period_start, current_period_end, cancel_at_period_end,
              started_at, canceled_at, updated_at
            ) VALUES (
              ${userIdFromMeta}::uuid, ${customer}, ${sub.id}, ${priceId},
              ${status}, ${periodStart}, ${periodEnd}, ${sub.cancel_at_period_end ?? false},
              ${status === 'active' ? new Date() : null},
              ${status === 'canceled' ? new Date() : null},
              NOW()
            )
            ON CONFLICT (user_id) DO UPDATE SET
              stripe_customer_id = EXCLUDED.stripe_customer_id,
              stripe_subscription_id = EXCLUDED.stripe_subscription_id,
              stripe_price_id = EXCLUDED.stripe_price_id,
              status = EXCLUDED.status,
              current_period_start = EXCLUDED.current_period_start,
              current_period_end = EXCLUDED.current_period_end,
              cancel_at_period_end = EXCLUDED.cancel_at_period_end,
              canceled_at = EXCLUDED.canceled_at,
              updated_at = NOW()
          `);
          break;
        }

        // Legacy users.current_plan flip for any historical sub.
        if (sub.status === 'canceled' || sub.status === 'unpaid' || event.type === 'customer.subscription.deleted') {
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

/**
 * Pull pricing breakdown + coupon details out of a checkout session.
 * Used by the audit_log entry so 100%-off promo redemptions are
 * traceable later. Stripe attaches discounts to either
 * `total_details.breakdown.discounts` (line-level) or to
 * `s.discounts` (session-level) depending on how the discount was
 * created · we surface both.
 *
 * Returns metadata-only · safe to JSON-serialise into audit_log.
 */
function extractCheckoutBreakdown(s: Stripe.Checkout.Session) {
  // Session.discounts is on the API but the stripe-node 17.x types
  // don't expose it directly; cast through unknown.
  type SessionDiscount = { coupon?: string | { id: string } | null; promotion_code?: string | { id: string } | null };
  const rawSessionDiscounts = ((s as unknown as { discounts?: SessionDiscount[] }).discounts) ?? [];
  const sessionDiscounts = rawSessionDiscounts.map((d) => ({
    coupon: typeof d.coupon === 'string' ? d.coupon : d.coupon?.id ?? null,
    promotion_code: typeof d.promotion_code === 'string' ? d.promotion_code : d.promotion_code?.id ?? null,
  }));
  const lineDiscounts = (s.total_details?.breakdown?.discounts ?? []).map((d) => ({
    amount: d.amount,
    discount_coupon: typeof d.discount?.coupon === 'string' ? d.discount.coupon : d.discount?.coupon?.id ?? null,
    discount_promotion_code: typeof d.discount?.promotion_code === 'string' ? d.discount.promotion_code : d.discount?.promotion_code?.id ?? null,
  }));
  return {
    payment_status: s.payment_status,
    amount_subtotal: s.amount_subtotal ?? null,
    amount_total: s.amount_total ?? null,
    amount_discount: s.total_details?.amount_discount ?? 0,
    currency: s.currency ?? null,
    session_discounts: sessionDiscounts.length > 0 ? sessionDiscounts : null,
    line_discounts: lineDiscounts.length > 0 ? lineDiscounts : null,
    free_via_coupon: (s.payment_status === 'no_payment_required') || ((s.amount_total ?? 0) === 0 && !s.payment_intent),
  };
}

// sendDeferredInvites moved to src/lib/invites.ts as sendInvitesForDecision
// so /api/compose can also invoke it for comped decisions that skip the
// payment gate entirely.

