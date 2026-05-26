/**
 * POST /api/decision/reopen-schedule
 * Body: { decision_id, months }  // months ∈ [3, 24]
 *
 * Schedule a 6-month (or N-month) re-check on a completed flagship
 * decision. When reopen_at <= NOW(), the evening-prompt cron picks up
 * the row and emails the user: "six months ago you decided X · re-vote
 * for 14 nights to see if your conviction has shifted." When the user
 * accepts, /api/decision/restart spawns a new decision pre-filled with
 * the original question + a back-pointer (reopen_of) to the parent.
 *
 * Owner-only. Only valid on completed decisions · the re-check is the
 * "is this still the right answer six months on" loop.
 *
 * DELETE /api/decision/reopen-schedule  · cancel a scheduled re-check.
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
  months: z.coerce.number().int().min(3).max(24),
});

const cancelSchema = z.object({ decision_id: z.string().uuid() });

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
    return NextResponse.json({ ok: false, message: 'decision_id and months (3-24) are required.' }, { status: 422 });
  }
  const { decision_id, months } = parsed.data;

  const rows = await db
    .select({ id: schema.decisions.id, status: schema.decisions.status })
    .from(schema.decisions)
    .where(and(eq(schema.decisions.id, decision_id), eq(schema.decisions.ownerUserId, session.userId)))
    .limit(1);
  if (rows.length === 0) {
    return NextResponse.json({ ok: false, message: 'That decision is not on your account.' }, { status: 404 });
  }
  if (rows[0].status !== 'completed') {
    return NextResponse.json({ ok: false, message: 'Only completed decisions can be scheduled for re-check.' }, { status: 409 });
  }

  const reopenAt = new Date();
  reopenAt.setMonth(reopenAt.getMonth() + months);

  await db.update(schema.decisions)
    .set({ reopenAt, updatedAt: new Date() })
    .where(eq(schema.decisions.id, decision_id));

  await db.insert(schema.auditLog).values({
    actorUserId: session.userId,
    action: 'decision.reopen_scheduled',
    targetType: 'decision',
    targetId: decision_id,
    metadata: { months, reopen_at: reopenAt.toISOString() },
  }).catch(() => {});

  return NextResponse.json({
    ok: true,
    reopen_at: reopenAt.toISOString(),
    message: `Scheduled for re-check in ${months} month${months === 1 ? '' : 's'} · ${reopenAt.toISOString().slice(0, 10)}.`,
  }, { status: 200 });
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
  const parsed = cancelSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: 'decision_id is required.' }, { status: 422 });
  }
  await db.update(schema.decisions)
    .set({ reopenAt: null, updatedAt: new Date() })
    .where(and(eq(schema.decisions.id, parsed.data.decision_id), eq(schema.decisions.ownerUserId, session.userId)));
  await db.insert(schema.auditLog).values({
    actorUserId: session.userId,
    action: 'decision.reopen_cancelled',
    targetType: 'decision',
    targetId: parsed.data.decision_id,
    metadata: {},
  }).catch(() => {});
  return NextResponse.json({ ok: true, message: 'Re-check cancelled.' }, { status: 200 });
}
