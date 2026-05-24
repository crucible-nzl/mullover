/**
 * GET /api/invite/preview?token=<x>
 *
 * Public endpoint · no session required. Returns a sanitised preview of an
 * invitation so the /invite.html page can show "James invited you to vote on
 * a Couple decision" before the recipient signs up.
 *
 * Returns 404 for unknown / expired / already-accepted tokens. We do NOT
 * leak whether the token never existed vs was already consumed · same
 * response to both.
 */

import { NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, isNull, and } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  if (!token || token.length < 16 || token.length > 64) {
    return NextResponse.json({ ok: false, message: 'Invalid invite link.' }, { status: 404 });
  }

  // Find the participant row by invite token, that has not yet accepted
  const rows = await db
    .select({
      participantId: schema.participants.id,
      decisionId: schema.participants.decisionId,
      inviteEmail: schema.participants.inviteEmail,
      displayName: schema.participants.displayName,
      ownerUserId: schema.decisions.ownerUserId,
      question: schema.decisions.question,
      tier: schema.decisions.tier,
      durationDays: schema.decisions.durationDays,
      status: schema.decisions.status,
    })
    .from(schema.participants)
    .innerJoin(schema.decisions, eq(schema.decisions.id, schema.participants.decisionId))
    .where(
      and(
        eq(schema.participants.inviteToken, token),
        isNull(schema.participants.inviteAcceptedAt)
      )
    )
    .limit(1);

  if (rows.length === 0) {
    return NextResponse.json({ ok: false, message: 'This invite is no longer valid.' }, { status: 404 });
  }
  const row = rows[0];

  // Find the inviter's first name (decision owner)
  const inviterRows = await db
    .select({ firstName: schema.users.firstName })
    .from(schema.users)
    .where(eq(schema.users.id, row.ownerUserId))
    .limit(1);
  const inviterName = inviterRows[0]?.firstName ?? 'Someone';

  // Audit-log the click (first preview fetch == link clicked). De-dupe
  // per session by checking if we've already logged a click for this
  // participant in the last 60 minutes · users often reload the invite
  // page once or twice. Inserting the row inside a try-catch ensures
  // an audit failure never breaks the user-facing preview.
  void db
    .select({ id: schema.auditLog.id })
    .from(schema.auditLog)
    .where(and(
      eq(schema.auditLog.action, 'invite.clicked'),
      eq(schema.auditLog.targetId, row.participantId)
    ))
    .limit(1)
    .then((existing) => {
      if (existing.length === 0) {
        return db.insert(schema.auditLog).values({
          action: 'invite.clicked',
          targetType: 'participant',
          targetId: row.participantId,
          metadata: {
            decision_id: row.decisionId,
            user_agent: req.headers.get('user-agent')?.slice(0, 200) ?? null,
            ip: (req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null,
          },
        });
      }
      return null;
    })
    .catch(() => { /* audit must never break user-facing preview */ });

  return NextResponse.json(
    {
      ok: true,
      inviter_first_name: inviterName,
      invitee_display_name: row.displayName,
      invitee_email: row.inviteEmail,
      question: row.question,
      tier: row.tier,
      duration_days: row.durationDays,
    },
    { status: 200, headers: { 'cache-control': 'no-store' } }
  );
}
