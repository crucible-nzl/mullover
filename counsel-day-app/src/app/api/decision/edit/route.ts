/**
 * PATCH /api/decision/edit
 * Body: { decision_id, question? }
 *
 * Edit the wording of a decision. Owner-only, only before the decision
 * is unsealed (status in pending_invites, active). Once verdict_generating
 * or completed, the question is frozen · changing it would invalidate
 * every vote cast against it.
 *
 * Audit-logged with the old + new wording so we can restore on user
 * request.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@/lib/db';
import { readSession, readSessionCookie } from '@/lib/sessions';
import { and, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const bodySchema = z.object({
  decision_id: z.string().uuid(),
  question: z.string().trim().min(8).max(280),
});

export async function PATCH(req: Request) {
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
    return NextResponse.json({ ok: false, message: 'Provide a decision_id and a question between 8 and 280 characters.' }, { status: 422 });
  }
  const { decision_id, question } = parsed.data;

  const rows = await db
    .select({ id: schema.decisions.id, question: schema.decisions.question, status: schema.decisions.status })
    .from(schema.decisions)
    .where(and(eq(schema.decisions.id, decision_id), eq(schema.decisions.ownerUserId, session.userId)))
    .limit(1);
  if (rows.length === 0) {
    return NextResponse.json({ ok: false, message: 'That decision was not found on your account.' }, { status: 404 });
  }
  const d = rows[0];
  if (d.status === 'verdict_generating' || d.status === 'completed' || d.status === 'refunded' || d.status === 'cancelled') {
    return NextResponse.json({ ok: false, message: 'This decision is no longer editable.' }, { status: 409 });
  }
  if (question === d.question) {
    return NextResponse.json({ ok: true, message: 'No change.' }, { status: 200 });
  }

  await db.update(schema.decisions).set({ question, updatedAt: new Date() }).where(eq(schema.decisions.id, decision_id));
  await db.insert(schema.auditLog).values({
    actorUserId: session.userId,
    action: 'decision.edited',
    targetType: 'decision',
    targetId: decision_id,
    metadata: { old_question: d.question, new_question: question },
  }).catch(() => {});

  return NextResponse.json({ ok: true, message: 'Question updated.' }, { status: 200 });
}
