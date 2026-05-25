/**
 * POST /api/decision/delete
 * Body: { decision_id, confirm: 'DELETE' }
 *
 * Owner-only. Removes the decision from the user's record.
 *
 * Behaviour depends on whether money was taken:
 *   · UNPAID (amount_paid_cents = 0 · solo_free or status='pending_payment'
 *     where the webhook never cleared) · HARD delete · cascades to
 *     participants + votes via foreign keys.
 *   · PAID · SOFT delete · status='cancelled', cancelled_at=NOW(). The
 *     row stays in the database so the payment audit trail is preserved
 *     and admin can issue a refund through the normal flow. The user's
 *     list filters cancelled rows out by default, so to them it looks
 *     gone.
 *
 * Forbidden once the verdict is being generated or has been completed ·
 * sealed history is immutable. The user can hide it from their list
 * via the existing archive flow (future).
 *
 * Always audit-logged. confirm:'DELETE' guards against accidental clicks
 * and double-submits.
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
  confirm: z.literal('DELETE'),
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
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: 'decision_id (uuid) and confirm:"DELETE" are required.' }, { status: 422 });
  }
  const { decision_id } = parsed.data;

  const rows = await db
    .select({
      id: schema.decisions.id,
      question: schema.decisions.question,
      tier: schema.decisions.tier,
      status: schema.decisions.status,
      amountPaidCents: schema.decisions.amountPaidCents,
    })
    .from(schema.decisions)
    .where(and(eq(schema.decisions.id, decision_id), eq(schema.decisions.ownerUserId, session.userId)))
    .limit(1);
  if (rows.length === 0) {
    return NextResponse.json({ ok: false, message: 'That decision was not found on your account.' }, { status: 404 });
  }
  const d = rows[0];

  if (['verdict_generating', 'completed'].indexOf(d.status) !== -1) {
    return NextResponse.json({ ok: false, message: 'A decision that has reached its verdict is sealed history and cannot be deleted.' }, { status: 409 });
  }
  if (d.status === 'cancelled') {
    return NextResponse.json({ ok: false, message: 'This decision is already cancelled.' }, { status: 409 });
  }

  const wasPaid = d.amountPaidCents > 0;
  const auditMeta = {
    question: d.question,
    tier: d.tier,
    prior_status: d.status,
    amount_paid_cents: d.amountPaidCents,
    mode: wasPaid ? 'soft_cancelled' : 'hard_deleted',
  };

  if (wasPaid) {
    // Soft · preserve payment audit trail; refund handled by admin flow
    await db.update(schema.decisions)
      .set({ status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.decisions.id, decision_id));
  } else {
    // Hard · cascades to participants + votes via FK
    await db.delete(schema.decisions).where(eq(schema.decisions.id, decision_id));
  }

  await db.insert(schema.auditLog).values({
    actorUserId: session.userId,
    action: 'decision.deleted',
    targetType: 'decision',
    targetId: decision_id,
    metadata: auditMeta,
  }).catch(() => {});

  return NextResponse.json({
    ok: true,
    mode: wasPaid ? 'cancelled' : 'deleted',
    message: wasPaid
      ? 'Decision cancelled. The record is preserved for refund processing. It will no longer appear in your list.'
      : 'Decision deleted.',
  }, { status: 200 });
}
