/**
 * GET /api/me/export
 *
 * GDPR Article 15 (right of access) + Article 20 (data portability)
 * implementation. Returns every row in the database tied to the
 * requesting user_id, in a single JSON document.
 *
 * Includes:
 *   · users row (minus password_hash)
 *   · sessions (id + metadata only; never the cookie value)
 *   · decisions (every decision they own)
 *   · participants (decisions they were invited to or accepted)
 *   · votes (their own votes, including direction + notes · their data)
 *   · verdicts (the verdict rows attached to their decisions)
 *   · consent_log (their consent history)
 *
 * Excludes:
 *   · password_hash (a hash is not their personal data per se, and
 *     exporting it would defeat the purpose of hashing)
 *   · audit_log (admin-action log, not user-owned data)
 *   · stripe_webhook_events (operational dedupe cache, not personal)
 *
 * Returns 200 with the JSON body and Content-Disposition: attachment
 * so the browser saves it as a file rather than rendering it.
 */

import { NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { readSession, readSessionCookie } from '@/lib/sessions';
import { eq, or, inArray } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const session = await readSession(readSessionCookie(req.headers));
  if (!session) {
    return NextResponse.json({ ok: false, message: 'You must be signed in.' }, { status: 401 });
  }

  const userId = session.userId;

  // ---- user ----
  const users = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      firstName: schema.users.firstName,
      emailVerifiedAt: schema.users.emailVerifiedAt,
      marketingConsent: schema.users.marketingConsent,
      decisionKindIntent: schema.users.decisionKindIntent,
      currentPlan: schema.users.currentPlan,
      stripeCustomerId: schema.users.stripeCustomerId,
      createdAt: schema.users.createdAt,
      updatedAt: schema.users.updatedAt,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (users.length === 0) {
    return NextResponse.json({ ok: false, message: 'Account not found.' }, { status: 404 });
  }

  // ---- sessions (id + metadata only, no cookie value) ----
  const sessions = await db
    .select({
      id: schema.sessions.id,
      expiresAt: schema.sessions.expiresAt,
      createdAt: schema.sessions.createdAt,
      userAgent: schema.sessions.userAgent,
      ipAddress: schema.sessions.ipAddress,
    })
    .from(schema.sessions)
    .where(eq(schema.sessions.userId, userId));

  // ---- decisions they own ----
  const ownedDecisions = await db
    .select()
    .from(schema.decisions)
    .where(eq(schema.decisions.ownerUserId, userId));
  const ownedDecisionIds = ownedDecisions.map((d) => d.id);

  // ---- participants rows (both owned decisions + ones they joined) ----
  const participantRows = await db
    .select()
    .from(schema.participants)
    .where(
      ownedDecisionIds.length > 0
        ? or(eq(schema.participants.userId, userId), inArray(schema.participants.decisionId, ownedDecisionIds))
        : eq(schema.participants.userId, userId)
    );
  const myParticipantIds = participantRows
    .filter((p) => p.userId === userId)
    .map((p) => p.id);

  // ---- their own votes (only · never another participant's) ----
  const votes = myParticipantIds.length > 0
    ? await db.select().from(schema.votes).where(inArray(schema.votes.participantId, myParticipantIds))
    : [];

  // ---- verdicts attached to owned decisions ----
  const verdicts = ownedDecisionIds.length > 0
    ? await db.select().from(schema.verdicts).where(inArray(schema.verdicts.decisionId, ownedDecisionIds))
    : [];

  // ---- consent log entries ----
  const consent = await db
    .select()
    .from(schema.consentLog)
    .where(eq(schema.consentLog.userId, userId));

  const payload = {
    export_generated_at: new Date().toISOString(),
    export_format_version: 1,
    notice:
      'This file contains every row of personal data Counsel.day holds about your account, per GDPR Article 15 (right of access) and Article 20 (data portability). Stripe payment records are NOT included · request them directly from your Stripe Customer Portal (Settings · Billing on /billing). To delete your account, POST DELETE /api/me · 14-day soft-delete window applies.',
    user: users[0],
    sessions,
    owned_decisions: ownedDecisions,
    participants: participantRows,
    votes_cast_by_you: votes,
    verdicts_for_your_decisions: verdicts,
    consent_log: consent,
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="counsel-day-export-${userId}-${new Date().toISOString().slice(0, 10)}.json"`,
      'cache-control': 'private, no-store',
    },
  });
}
