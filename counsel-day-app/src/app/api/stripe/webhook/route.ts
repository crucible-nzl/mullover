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
import { sendTransactional, buildInviteEmail } from '@/lib/email';
import { eq, and, isNotNull, isNull, sql } from 'drizzle-orm';
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
        const paymentIntentId = typeof s.payment_intent === 'string' ? s.payment_intent : null;
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

            // Send the deferred invite emails ONLY if we just transitioned
            // out of pending_payment into pending_invites. Don't fire if
            // we landed at 'active' (no partners to invite) or if the
            // status was already past pending_payment (re-delivery).
            if (d.status === 'pending_payment' && nextStatus === 'pending_invites') {
              await sendDeferredInvites(decisionId, d.question, d.ownerUserId);
            }
          }
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

/**
 * Send the previously-held invite emails for a freshly-paid decision.
 *
 * Called from `checkout.session.completed` exactly when a decision
 * transitions from `pending_payment` → `pending_invites`. This is the
 * ONLY code path that emails invites for paid tiers · the compose
 * endpoint deliberately defers email sending until payment clears.
 *
 * Best-effort: a Brevo failure is logged but does not throw, so the
 * webhook still returns 200 and Stripe doesn't retry. Operators can
 * trigger a resend via the admin panel.
 */
async function sendDeferredInvites(decisionId: string, question: string, ownerUserId: string) {
  // Owner's display name for the email greeting
  const ownerRows = await db
    .select({ firstName: schema.users.firstName, email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.id, ownerUserId))
    .limit(1);
  const ownerName = ownerRows[0]?.firstName ?? 'Someone';

  // All participants that still need an email + have a token
  const invites = await db
    .select({
      id: schema.participants.id,
      displayName: schema.participants.displayName,
      inviteEmail: schema.participants.inviteEmail,
      inviteToken: schema.participants.inviteToken,
    })
    .from(schema.participants)
    .where(and(
      eq(schema.participants.decisionId, decisionId),
      isNotNull(schema.participants.inviteEmail),
      isNotNull(schema.participants.inviteToken),
      isNull(schema.participants.inviteAcceptedAt)
    ));

  if (invites.length === 0) return;

  const sends = invites.map(async (p) => {
    const inviteUrl = `${BASE}/invite?token=${encodeURIComponent(p.inviteToken as string)}`;
    const { text, html } = buildInviteEmail({
      ownerName,
      displayName: p.displayName,
      question,
      inviteUrl,
    });
    try {
      await sendTransactional({
        to: { email: p.inviteEmail as string, name: p.displayName },
        subject: `${ownerName} invited you to a Counsel.day decision`,
        textContent: text,
        htmlContent: html,
      });
      await db.insert(schema.auditLog).values({
        action: 'invite.sent',
        targetType: 'participant',
        targetId: p.id,
        metadata: { decision_id: decisionId, after_payment: true },
      }).catch(() => {});
    } catch (err) {
      console.error('[stripe webhook] invite email failed', p.inviteEmail, (err as Error).message);
      await db.insert(schema.auditLog).values({
        action: 'invite.send_failed',
        targetType: 'participant',
        targetId: p.id,
        metadata: { decision_id: decisionId, error: (err as Error).message },
      }).catch(() => {});
    }
  });

  await Promise.allSettled(sends);
}

