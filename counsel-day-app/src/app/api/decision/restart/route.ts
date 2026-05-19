/**
 * POST /api/decision/restart
 * Body: { decision_id }
 *
 * Cancel the current decision and clone it into a new one with the
 * same question, tier, duration, and participants · zero charge,
 * fresh dates starting tonight at the user's evening time, votes
 * reset to zero.
 *
 * Owner-only. Allowed at any pre-reveal stage. Once a verdict is
 * generated, the decision is sealed history · use the normal compose
 * path to start a fresh one.
 *
 * Side effects (all in one transaction · sort of, drizzle uses a
 * single connection but no explicit transaction here · acceptable
 * because the worst case is "old decision cancelled, new one not
 * created" which is a user-visible retry):
 *   1. UPDATE decisions SET status='cancelled' on the old one
 *   2. INSERT new row mirroring old (question, tier, duration,
 *      amount_paid_cents=0, status='active', starts_at=NOW())
 *   3. Copy participants
 *   4. Audit-log decision.restarted with both ids
 *
 * Refund of the original is NOT processed here · admin handles that
 * separately via the existing refund flow if appropriate.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@/lib/db';
import { readSession, readSessionCookie } from '@/lib/sessions';
import { sql, and, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const bodySchema = z.object({ decision_id: z.string().uuid() });

export async function POST(req: Request) {
  const session = await readSession(readSessionCookie(req.headers));
  if (!session) {
    return NextResponse.json({ ok: false, message: 'You must be signed in.' }, { status: 401 });
  }
  let raw: unknown;
  try { raw = await req.json(); } catch {
    return NextResponse.json({ ok: false, message: 'Body must be JSON.' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: 'decision_id is required.' }, { status: 422 });
  }
  const { decision_id } = parsed.data;

  const rows = await db
    .select({
      id: schema.decisions.id,
      question: schema.decisions.question,
      tier: schema.decisions.tier,
      format: schema.decisions.format,
      durationDays: schema.decisions.durationDays,
      status: schema.decisions.status,
    })
    .from(schema.decisions)
    .where(and(eq(schema.decisions.id, decision_id), eq(schema.decisions.ownerUserId, session.userId)))
    .limit(1);
  if (rows.length === 0) {
    return NextResponse.json({ ok: false, message: 'That decision was not found on your account.' }, { status: 404 });
  }
  const old = rows[0];
  if (old.status === 'completed' || old.status === 'verdict_generating') {
    return NextResponse.json({ ok: false, message: 'A decision that has reached its verdict cannot be restarted. Compose a new one.' }, { status: 409 });
  }

  // 1. Cancel old
  await db.update(schema.decisions).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(schema.decisions.id, decision_id));

  // 2. Clone · new id, fresh dates
  const inserted = await db.execute<{ id: string }>(sql`
    INSERT INTO decisions (owner_user_id, question, tier, format, duration_days, status, amount_paid_cents, starts_at, unseals_at)
    VALUES (
      ${session.userId},
      ${old.question},
      ${old.tier},
      ${old.format},
      ${old.durationDays},
      'active',
      0,
      NOW(),
      NOW() + (${old.durationDays} * INTERVAL '1 day')
    )
    RETURNING id::text AS id
  `);
  const newId = (inserted[0] as { id: string }).id;

  // 3. Copy participants over with fresh invite_tokens (the unique index
  //    forbids reusing the old one). Acceptance is preserved when a
  //    participant already has user_id set (they are a real account);
  //    invite-only participants will need a fresh invite email.
  await db.execute(sql`
    INSERT INTO participants (decision_id, user_id, invite_email, invite_token, invite_accepted_at, display_name, position)
    SELECT ${newId}::uuid,
           user_id,
           invite_email,
           CASE WHEN user_id IS NULL THEN gen_random_uuid()::text ELSE NULL END,
           CASE WHEN user_id IS NOT NULL THEN NOW() ELSE NULL END,
           display_name,
           position
    FROM participants
    WHERE decision_id = ${decision_id}
  `);

  // 4. Audit log
  await db.insert(schema.auditLog).values({
    actorUserId: session.userId,
    action: 'decision.restarted',
    targetType: 'decision',
    targetId: decision_id,
    metadata: { new_decision_id: newId, question: old.question, tier: old.tier, duration_days: old.durationDays },
  }).catch(() => {});

  return NextResponse.json({ ok: true, new_decision_id: newId, message: 'Decision restarted · the new copy is now active.' }, { status: 200 });
}
