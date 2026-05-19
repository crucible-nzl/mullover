/**
 * POST /api/decision/reinvite
 * Body: { decision_id, participant_id? }
 *
 * Resend the invite email to one (when participant_id given) or all
 * not-yet-accepted invitees on a decision. Owner-only.
 *
 * Mints a fresh invite_token each time so the previous one stops
 * working · prevents an old leaked link from being used after the
 * resend.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@/lib/db';
import { readSession, readSessionCookie } from '@/lib/sessions';
import { sendTransactional } from '@/lib/email';
import { and, eq, isNull } from 'drizzle-orm';
import { randomUUID } from 'crypto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const APP_BASE_URL = process.env.APP_BASE_URL ?? 'https://counsel.day';

const bodySchema = z.object({
  decision_id: z.string().uuid(),
  participant_id: z.string().uuid().optional(),
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
    return NextResponse.json({ ok: false, message: 'decision_id is required.' }, { status: 422 });
  }
  const { decision_id, participant_id } = parsed.data;

  // Ownership check
  const dRows = await db
    .select({ id: schema.decisions.id, question: schema.decisions.question, tier: schema.decisions.tier })
    .from(schema.decisions)
    .where(and(eq(schema.decisions.id, decision_id), eq(schema.decisions.ownerUserId, session.userId)))
    .limit(1);
  if (dRows.length === 0) {
    return NextResponse.json({ ok: false, message: 'That decision was not found on your account.' }, { status: 404 });
  }
  const decision = dRows[0];

  // Find participants to reinvite · always restricted to NOT-YET-accepted
  const whereClauses = [eq(schema.participants.decisionId, decision_id), isNull(schema.participants.inviteAcceptedAt)];
  const partRows = await db
    .select({ id: schema.participants.id, displayName: schema.participants.displayName, inviteEmail: schema.participants.inviteEmail })
    .from(schema.participants)
    .where(and(...whereClauses));

  let toReinvite = partRows.filter((p) => !!p.inviteEmail);
  if (participant_id) toReinvite = toReinvite.filter((p) => p.id === participant_id);
  if (toReinvite.length === 0) {
    return NextResponse.json({ ok: false, message: 'No pending invites to resend.' }, { status: 404 });
  }

  let sent = 0;
  for (const p of toReinvite) {
    const newToken = randomUUID();
    await db.update(schema.participants)
      .set({ inviteToken: newToken })
      .where(eq(schema.participants.id, p.id));

    const acceptUrl = `${APP_BASE_URL}/invite?token=${encodeURIComponent(newToken)}`;
    const text = [
      `Hi ${p.displayName},`,
      '',
      'You have been invited to share a Counsel.day decision:',
      '',
      `> ${decision.question}`,
      '',
      'Accept the invite here:',
      acceptUrl,
      '',
      'This link replaces any previous invite for this decision; the older one no longer works.',
      '',
      '· Counsel.day',
    ].join('\n');
    const html = `
      <p>Hi ${p.displayName},</p>
      <p>You have been invited to share a Counsel.day decision:</p>
      <blockquote style="border-left: 3px solid #722F37; padding-left: 14px; margin: 16px 0; font-style: italic;">${decision.question}</blockquote>
      <p><a href="${acceptUrl}" style="color: #722F37;">Accept the invite →</a></p>
      <p style="color: #6b7a90; font-size: 13px;">This link replaces any previous invite; the older one no longer works.</p>
    `.trim();
    const res = await sendTransactional({
      to: { email: p.inviteEmail!, name: p.displayName },
      subject: 'Your Counsel.day invite, resent',
      textContent: text,
      htmlContent: html,
    });
    if (res.ok) sent++;
  }

  await db.insert(schema.auditLog).values({
    actorUserId: session.userId,
    action: 'decision.reinvited',
    targetType: 'decision',
    targetId: decision_id,
    metadata: { count: sent, participants: toReinvite.map((p) => p.id) },
  }).catch(() => {});

  return NextResponse.json({ ok: true, sent, message: 'Invite' + (sent === 1 ? '' : 's') + ' resent.' }, { status: 200 });
}
