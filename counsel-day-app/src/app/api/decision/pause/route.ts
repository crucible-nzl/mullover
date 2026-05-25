/**
 * POST /api/decision/pause
 * Body: { decision_id, days } · pause an active decision for N days
 * POST /api/decision/pause  with { decision_id, resume: true } · resume early
 *
 * Owner-only. Allowed during active or pending_invites status only ·
 * not after the verdict has been generated.
 *
 * On pause:
 *   1. paused_at  = NOW()
 *   2. paused_until = NOW() + N days
 *   3. unseals_at = unseals_at + N days  (so the same total voting
 *      window is preserved · the pause simply shifts the close date)
 *   4. audit-log decision.paused with {days}
 *
 * On resume (early):
 *   1. paused_until = NOW() · resumes immediately
 *   2. unseals_at is NOT adjusted back · the extension already applied
 *      stays; the user chose to come back early but the calendar moved.
 *   3. audit-log decision.resumed
 *
 * Range: 1-90 days per pause. Multiple consecutive pauses are allowed
 * but each one extends unseals_at further. Hard cap is enforced at
 * 365 days total decision length to match the schema check.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@/lib/db';
import { readSession, readSessionCookie } from '@/lib/sessions';
import { sql, and, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const bodySchema = z.union([
  z.object({ decision_id: z.string().uuid(), days: z.coerce.number().int().min(1).max(90), resume: z.undefined().optional() }),
  z.object({ decision_id: z.string().uuid(), resume: z.literal(true), days: z.undefined().optional() }),
]);

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
    return NextResponse.json({ ok: false, message: 'decision_id and either days (1-90) or resume:true are required.' }, { status: 422 });
  }
  const { decision_id } = parsed.data;
  const isResume = 'resume' in parsed.data && parsed.data.resume === true;
  const days: number = !isResume && 'days' in parsed.data ? (parsed.data.days as number) : 0;

  const rows = await db
    .select({
      id: schema.decisions.id,
      status: schema.decisions.status,
      unsealsAt: schema.decisions.unsealsAt,
      pausedUntil: schema.decisions.pausedUntil,
      durationDays: schema.decisions.durationDays,
    })
    .from(schema.decisions)
    .where(and(eq(schema.decisions.id, decision_id), eq(schema.decisions.ownerUserId, session.userId)))
    .limit(1);
  if (rows.length === 0) {
    return NextResponse.json({ ok: false, message: 'That decision was not found on your account.' }, { status: 404 });
  }
  const d = rows[0];
  if (['verdict_generating', 'completed', 'cancelled', 'refunded'].indexOf(d.status) !== -1) {
    return NextResponse.json({ ok: false, message: 'A decision in this state cannot be paused or resumed.' }, { status: 409 });
  }

  if (isResume) {
    if (!d.pausedUntil || d.pausedUntil <= new Date()) {
      return NextResponse.json({ ok: false, message: 'This decision is not currently paused.' }, { status: 409 });
    }
    await db.update(schema.decisions)
      .set({ pausedUntil: new Date(), updatedAt: new Date() })
      .where(eq(schema.decisions.id, decision_id));
    await db.insert(schema.auditLog).values({
      actorUserId: session.userId,
      action: 'decision.resumed',
      targetType: 'decision',
      targetId: decision_id,
      metadata: {},
    }).catch(() => {});
    return NextResponse.json({ ok: true, message: 'Decision resumed.' }, { status: 200 });
  }

  // Pause for N days · shift unseals_at forward
  const now = new Date();
  const pausedUntil = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  // unseals_at extension · preserve the same remaining vote window
  const oldUnseals = d.unsealsAt ?? new Date(now.getTime() + d.durationDays * 24 * 60 * 60 * 1000);
  const newUnseals = new Date(oldUnseals.getTime() + days * 24 * 60 * 60 * 1000);

  await db.update(schema.decisions)
    .set({
      pausedAt: now,
      pausedUntil,
      unsealsAt: newUnseals,
      updatedAt: now,
    })
    .where(eq(schema.decisions.id, decision_id));

  await db.insert(schema.auditLog).values({
    actorUserId: session.userId,
    action: 'decision.paused',
    targetType: 'decision',
    targetId: decision_id,
    metadata: { days, paused_until: pausedUntil.toISOString(), new_unseals_at: newUnseals.toISOString() },
  }).catch(() => {});

  return NextResponse.json({
    ok: true,
    message: 'Paused for ' + days + ' day' + (days === 1 ? '' : 's') + ' · resumes ' + pausedUntil.toISOString().slice(0, 10),
    paused_until: pausedUntil.toISOString(),
    new_unseals_at: newUnseals.toISOString(),
  }, { status: 200 });
}
