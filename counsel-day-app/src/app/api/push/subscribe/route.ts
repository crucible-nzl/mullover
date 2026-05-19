/**
 * POST   /api/push/subscribe   · Save the user's push subscription
 * DELETE /api/push/subscribe   · Remove a subscription by endpoint
 *
 * Body (POST) is the JSON-serialised PushSubscription from the
 * browser: { endpoint, keys: { p256dh, auth } }. We upsert by
 * (user_id, endpoint) so re-subscribing on the same device is a
 * no-op rather than a duplicate row.
 *
 * Body (DELETE) is { endpoint }. If the user is signed into a
 * different device than the one being unsubscribed, we still let
 * them remove it (it's their account).
 *
 * Auth: must be signed in. Audit-logs both actions so we can see
 * how many users actually opt in.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@/lib/db';
import { readSession, readSessionCookie } from '@/lib/sessions';
import { and, eq, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const postSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(200),
  }),
});

const deleteSchema = z.object({
  endpoint: z.string().url().max(2000),
});

export async function POST(req: Request) {
  const session = await readSession(readSessionCookie(req.headers));
  if (!session) {
    return NextResponse.json({ ok: false, message: 'You must be signed in.' }, { status: 401 });
  }

  let raw: unknown;
  try { raw = await req.json(); } catch {
    return NextResponse.json({ ok: false, message: 'Body must be JSON.' }, { status: 400 });
  }
  const parsed = postSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: 'Subscription payload is malformed.' }, { status: 422 });
  }
  const { endpoint, keys } = parsed.data;
  const ua = req.headers.get('user-agent')?.slice(0, 300) ?? null;

  // Upsert by (user_id, endpoint) · same device re-enabling is a no-op.
  await db.execute(sql`
    INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
    VALUES (${session.userId}, ${endpoint}, ${keys.p256dh}, ${keys.auth}, ${ua})
    ON CONFLICT (user_id, endpoint) DO UPDATE
       SET p256dh = EXCLUDED.p256dh,
           auth = EXCLUDED.auth,
           user_agent = EXCLUDED.user_agent,
           last_seen_at = NOW(),
           last_error_at = NULL,
           last_error = NULL
  `);

  await db.insert(schema.auditLog).values({
    actorUserId: session.userId,
    action: 'push.subscribed',
    targetType: 'push_subscription',
    metadata: { user_agent: ua },
  }).catch(() => {});

  return NextResponse.json({ ok: true }, { status: 200 });
}

export async function DELETE(req: Request) {
  const session = await readSession(readSessionCookie(req.headers));
  if (!session) {
    return NextResponse.json({ ok: false, message: 'You must be signed in.' }, { status: 401 });
  }

  let raw: unknown;
  try { raw = await req.json(); } catch {
    return NextResponse.json({ ok: false, message: 'Body must be JSON.' }, { status: 400 });
  }
  const parsed = deleteSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: 'endpoint is required.' }, { status: 422 });
  }

  await db
    .delete(schema.pushSubscriptions)
    .where(and(
      eq(schema.pushSubscriptions.userId, session.userId),
      eq(schema.pushSubscriptions.endpoint, parsed.data.endpoint),
    ));

  await db.insert(schema.auditLog).values({
    actorUserId: session.userId,
    action: 'push.unsubscribed',
    targetType: 'push_subscription',
  }).catch(() => {});

  return NextResponse.json({ ok: true }, { status: 200 });
}
