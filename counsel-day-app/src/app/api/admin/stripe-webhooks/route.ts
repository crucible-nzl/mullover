/**
 * GET /api/admin/stripe-webhooks
 *
 * Returns a combined view of:
 *   · our `stripe_webhook_events` idempotency table (events we've
 *     successfully processed)
 *   · Stripe's recent event log via stripe.events.list (last 100)
 *
 * Each Stripe event is annotated `processed: true|false` based on
 * whether its id is in our table. Used by /admin-webhooks.html to
 * surface delivery gaps · events Stripe knows about but we never
 * recorded mean our handler 4xx'd or 5xx'd, and the operator can
 * use the linked Stripe dashboard URL to re-send manually.
 *
 * Returns 503 if STRIPE_SECRET_KEY is unset.
 */

import { NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { desc } from 'drizzle-orm';
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

  // Our local view · last 200 events we've idempotently recorded.
  const localRows = await db
    .select({
      event_id: schema.stripeWebhookEvents.eventId,
      event_type: schema.stripeWebhookEvents.eventType,
      processed_at: schema.stripeWebhookEvents.processedAt,
    })
    .from(schema.stripeWebhookEvents)
    .orderBy(desc(schema.stripeWebhookEvents.processedAt))
    .limit(200);

  const processedIds = new Set(localRows.map((r) => r.event_id));

  // Stripe's view · last 100 events from their side. Bounded to keep
  // the request under Stripe's per-page limit (max 100). Operators
  // who need history beyond that go to the Stripe Dashboard directly.
  let stripeEvents: Array<{
    id: string;
    type: string;
    created: number;
    pending_webhooks: number;
    processed: boolean;
    dashboard_url: string;
  }> = [];
  let stripeError: string | null = null;
  try {
    const events = await stripe.events.list({ limit: 100 });
    stripeEvents = events.data.map((e) => ({
      id: e.id,
      type: e.type,
      created: e.created,
      pending_webhooks: e.pending_webhooks,
      processed: processedIds.has(e.id),
      dashboard_url: `https://dashboard.stripe.com/events/${e.id}`,
    }));
  } catch (err) {
    stripeError = (err as Error).message || 'Stripe API call failed';
  }

  // Anything we have locally that Stripe doesn't show (because Stripe
  // only paginates the last 100) is still useful · keep them in a
  // separate list so the page can render a "processed (older than
  // Stripe's window)" section if needed.
  const stripeIds = new Set(stripeEvents.map((e) => e.id));
  const localOnly = localRows.filter((r) => !stripeIds.has(r.event_id));

  return NextResponse.json(
    {
      ok: true,
      checked_at: new Date().toISOString(),
      stripe_events: stripeEvents,
      stripe_error: stripeError,
      local_only: localOnly,
      counts: {
        local_total: localRows.length,
        stripe_listed: stripeEvents.length,
        stripe_unprocessed: stripeEvents.filter((e) => !e.processed).length,
        stripe_pending: stripeEvents.filter((e) => e.pending_webhooks > 0).length,
      },
    },
    { headers: { 'cache-control': 'private, no-store' } }
  );
}
