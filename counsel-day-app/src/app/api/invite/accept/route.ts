/**
 * POST /api/invite/accept   body: { token: string }
 *
 * Requires an active session. Attaches the signed-in user to the participant
 * row identified by the token, marks the invite accepted, and returns the
 * decision id so the front-end can redirect to /vote-today or /decisions.
 *
 * Email-match check: if the invite was sent to a specific email, the
 * accepting user's email must match. Prevents a link from being forwarded
 * and accepted by a different account.
 *
 * Side-effect: if all participants on a `pending_invites` decision have now
 * accepted, the decision flips to `active` with starts_at = NOW() and
 * unseals_at = NOW() + duration_days.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@/lib/db';
import { readSession, readSessionCookie } from '@/lib/sessions';
import { eq, and, isNull, isNotNull, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const bodySchema = z.object({
  token: z.string().min(16).max(64),
});

export async function POST(req: Request) {
  const session = await readSession(readSessionCookie(req.headers));
  if (!session) {
    return NextResponse.json({ ok: false, message: 'You must be signed in to accept an invite.' }, { status: 401 });
  }

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
    return NextResponse.json({ ok: false, message: 'Invalid invite token.' }, { status: 422 });
  }
  const { token } = parsed.data;

  // Get the participant + the user's email for the match check
  const partRows = await db
    .select({
      participantId: schema.participants.id,
      decisionId: schema.participants.decisionId,
      inviteEmail: schema.participants.inviteEmail,
    })
    .from(schema.participants)
    .where(and(eq(schema.participants.inviteToken, token), isNull(schema.participants.inviteAcceptedAt)))
    .limit(1);
  if (partRows.length === 0) {
    return NextResponse.json({ ok: false, message: 'This invite is no longer valid.' }, { status: 404 });
  }
  const part = partRows[0];

  // Payment-first gate (defense in depth · should be unreachable because
  // compose deliberately holds invite emails until the webhook fires, but
  // a leaked / brute-forced token must still be refused for an unpaid
  // decision).
  const decisionPaymentRows = await db
    .select({ status: schema.decisions.status })
    .from(schema.decisions)
    .where(eq(schema.decisions.id, part.decisionId))
    .limit(1);
  if (decisionPaymentRows.length === 0) {
    return NextResponse.json({ ok: false, message: 'Decision not found.' }, { status: 404 });
  }
  if (decisionPaymentRows[0].status === 'pending_payment') {
    // Audit so the admin can see invites being attempted on unpaid
    // decisions (signal of either UX confusion or an attempted
    // bypass)
    await db.insert(schema.auditLog).values({
      action: 'invite.refused_pending_payment',
      actorUserId: session.userId,
      targetType: 'participant',
      targetId: part.participantId,
      metadata: { decision_id: part.decisionId },
    }).catch(() => {});
    return NextResponse.json(
      { ok: false, message: 'This decision has not been paid for yet. The owner needs to complete payment before invites can be accepted.' },
      { status: 402 }
    );
  }

  const userRows = await db
    .select({ email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.id, session.userId))
    .limit(1);
  if (userRows.length === 0) {
    return NextResponse.json({ ok: false, message: 'Account not found.' }, { status: 404 });
  }
  const userEmail = userRows[0].email.toLowerCase();

  // If the invite was bound to a specific email, the accepting user must match
  if (part.inviteEmail && part.inviteEmail.toLowerCase() !== userEmail) {
    return NextResponse.json(
      { ok: false, message: 'This invite was sent to a different email address. Sign in with that address to accept.' },
      { status: 403 }
    );
  }

  // Accept the invite · attach user_id + timestamp
  await db
    .update(schema.participants)
    .set({ userId: session.userId, inviteAcceptedAt: new Date() })
    .where(eq(schema.participants.id, part.participantId));

  // Audit-log the acceptance · pairs with invite.sent + invite.clicked
  // to form the funnel an operator can reconstruct from audit_log alone.
  await db.insert(schema.auditLog).values({
    action: 'invite.accepted',
    actorUserId: session.userId,
    targetType: 'participant',
    targetId: part.participantId,
    metadata: { decision_id: part.decisionId },
  }).catch(() => { /* audit must never break the accept flow */ });

  // If this was the last outstanding invite, flip the decision to active
  const pendingRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.participants)
    .where(and(eq(schema.participants.decisionId, part.decisionId), isNull(schema.participants.inviteAcceptedAt)));

  if (pendingRows[0]?.count === 0) {
    const decisionRows = await db
      .select({ status: schema.decisions.status, durationDays: schema.decisions.durationDays })
      .from(schema.decisions)
      .where(eq(schema.decisions.id, part.decisionId))
      .limit(1);
    const d = decisionRows[0];
    if (d && d.status === 'pending_invites') {
      const startsAt = new Date();
      const unsealsAt = new Date(startsAt.getTime() + d.durationDays * 24 * 60 * 60 * 1000);
      await db
        .update(schema.decisions)
        .set({ status: 'active', startsAt, unsealsAt, updatedAt: new Date() })
        .where(eq(schema.decisions.id, part.decisionId));
    }
  }

  return NextResponse.json(
    { ok: true, decision_id: part.decisionId, message: 'Invite accepted.' },
    { status: 200 }
  );
}
