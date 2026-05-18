/**
 * GET    /api/me  · profile + decisions list
 * DELETE /api/me  · GDPR Article 17 (right to erasure) · soft-delete now,
 *                   hard-delete after a 14-day grace window
 *
 * Used by /account.html and /decisions.html for GET. DELETE is wired to
 * the "Delete account" control on /account.html.
 *
 * Returns 401 if no session. Never includes other users' data.
 */

import { NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { readSession, readSessionCookie, buildClearedSessionCookie } from '@/lib/sessions';
import { eq, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const session = await readSession(readSessionCookie(req.headers));
  if (!session) {
    return NextResponse.json({ ok: false, message: 'You must be signed in.' }, { status: 401 });
  }

  const userRows = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      firstName: schema.users.firstName,
      currentPlan: schema.users.currentPlan,
      emailVerifiedAt: schema.users.emailVerifiedAt,
      marketingConsent: schema.users.marketingConsent,
      createdAt: schema.users.createdAt,
      hasPassword: sql<boolean>`${schema.users.passwordHash} IS NOT NULL`,
    })
    .from(schema.users)
    .where(eq(schema.users.id, session.userId))
    .limit(1);

  if (userRows.length === 0) {
    return NextResponse.json({ ok: false, message: 'Account not found.' }, { status: 404 });
  }
  const user = userRows[0];

  // Decisions list · only decisions where this user is a participant (owner or invitee)
  const decisions = await db.execute(sql`
    SELECT
      d.id,
      d.question,
      d.status,
      d.tier,
      d.format,
      d.duration_days,
      d.starts_at,
      d.unseals_at,
      d.created_at,
      CASE
        WHEN d.unseals_at IS NULL THEN NULL
        WHEN d.unseals_at < NOW() THEN 0
        ELSE EXTRACT(DAY FROM (d.unseals_at - NOW()))::integer
      END AS days_remaining,
      EXISTS (SELECT 1 FROM verdicts v WHERE v.decision_id = d.id) AS has_verdict,
      (SELECT count(*)::integer FROM votes vt
        JOIN participants p2 ON p2.id = vt.participant_id
        WHERE vt.decision_id = d.id AND p2.user_id = ${session.userId}) AS my_vote_count
    FROM decisions d
    WHERE d.id IN (
      SELECT decision_id FROM participants WHERE user_id = ${session.userId}
    )
    ORDER BY d.created_at DESC
    LIMIT 100
  `);

  return NextResponse.json(
    {
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        first_name: user.firstName,
        current_plan: user.currentPlan,
        email_verified: !!user.emailVerifiedAt,
        marketing_consent: user.marketingConsent,
        has_password: user.hasPassword,
        created_at: user.createdAt,
      },
      decisions,
    },
    { status: 200, headers: { 'cache-control': 'private, no-store' } }
  );
}

/**
 * DELETE /api/me · soft-delete the account.
 *
 * Sets users.deleted_at = NOW(), invalidates every session, clears the
 * cookie, and audit-logs the deletion. The actual row + dependent data
 * stays in Postgres for 14 days · a future hard-delete cron purges
 * users where deleted_at < NOW() - INTERVAL '14 days'. Until then, the
 * user can email admin@counsel.day to undo the deletion.
 *
 * Sign-in is blocked by /api/signin checking deleted_at IS NULL; without
 * that check, the soft-delete is purely cosmetic.
 *
 * Active Stripe subscriptions are NOT cancelled here · that's deliberate.
 * The user must cancel via the Customer Portal first. If we cancel here,
 * a fat-finger deletion silently terminates billing.
 */
export async function DELETE(req: Request) {
  const session = await readSession(readSessionCookie(req.headers));
  if (!session) {
    return NextResponse.json({ ok: false, message: 'You must be signed in.' }, { status: 401 });
  }

  // 1. Soft-delete the user
  await db
    .update(schema.users)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.users.id, session.userId));

  // 2. Invalidate every session for this user (cascade-deletes by user_id)
  await db.delete(schema.sessions).where(eq(schema.sessions.userId, session.userId));

  // 3. Audit-log the deletion request
  await db
    .insert(schema.auditLog)
    .values({
      actorUserId: session.userId,
      action: 'user.soft_delete',
      targetType: 'user',
      targetId: session.userId,
      metadata: { reason: 'self-service via DELETE /api/me' },
    })
    .catch(() => { /* don't block delete on audit failure */ });

  // 4. Clear the cookie
  return new NextResponse(
    JSON.stringify({
      ok: true,
      message:
        'Your account is scheduled for deletion. You have 14 days to change your mind · email admin@counsel.day to restore. After that, all data is permanently removed.',
    }),
    {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'set-cookie': buildClearedSessionCookie(),
        'cache-control': 'private, no-store',
      },
    }
  );
}
