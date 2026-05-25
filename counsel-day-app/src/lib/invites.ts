/**
 * Counsel.day · invite-email dispatch helper.
 *
 * Two callers today:
 *   · /api/stripe/webhook  · fires on checkout.session.completed when a
 *                            decision transitions pending_payment →
 *                            pending_invites
 *   · /api/compose         · fires immediately when a comped user files
 *                            a couple/family decision (no payment gate)
 *
 * Both call sendInvitesForDecision(decisionId, question, ownerUserId).
 * Best-effort: a Brevo failure is logged but does not throw, so the
 * caller still returns 200.
 *
 * Audit-logs invite.sent or invite.send_failed per participant.
 * Pass `context` (e.g. 'after_payment', 'comped') to the metadata so
 * audit-log readers can distinguish the path.
 */

import { db, schema } from '@/lib/db';
import { sendTransactional, buildInviteEmail } from '@/lib/email';
import { eq, and, isNotNull, isNull } from 'drizzle-orm';

const BASE = process.env.APP_BASE_URL ?? 'https://counsel.day';

export async function sendInvitesForDecision(
  decisionId: string,
  question: string,
  ownerUserId: string,
  context: 'after_payment' | 'comped' = 'after_payment'
): Promise<{ sent: number; failed: number }> {
  const ownerRows = await db
    .select({ firstName: schema.users.firstName, email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.id, ownerUserId))
    .limit(1);
  const ownerName = ownerRows[0]?.firstName ?? 'Someone';

  const invites = await db
    .select({
      id: schema.participants.id,
      displayName: schema.participants.displayName,
      inviteEmail: schema.participants.inviteEmail,
      inviteToken: schema.participants.inviteToken,
    })
    .from(schema.participants)
    .where(and(
      eq(schema.participants.decisionId, decisionId),
      isNotNull(schema.participants.inviteEmail),
      isNotNull(schema.participants.inviteToken),
      isNull(schema.participants.inviteAcceptedAt)
    ));

  if (invites.length === 0) return { sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;
  const sends = invites.map(async (p) => {
    const inviteUrl = `${BASE}/invite?token=${encodeURIComponent(p.inviteToken as string)}`;
    const { text, html } = buildInviteEmail({
      ownerName,
      displayName: p.displayName,
      question,
      inviteUrl,
    });
    try {
      await sendTransactional({
        to: { email: p.inviteEmail as string, name: p.displayName },
        subject: `${ownerName} invited you to a Counsel.day decision`,
        textContent: text,
        htmlContent: html,
      });
      sent += 1;
      await db.insert(schema.auditLog).values({
        action: 'invite.sent',
        targetType: 'participant',
        targetId: p.id,
        metadata: { decision_id: decisionId, context },
      }).catch(() => {});
    } catch (err) {
      failed += 1;
      console.error('[invites] send failed for', p.inviteEmail, (err as Error).message);
      await db.insert(schema.auditLog).values({
        action: 'invite.send_failed',
        targetType: 'participant',
        targetId: p.id,
        metadata: { decision_id: decisionId, error: (err as Error).message, context },
      }).catch(() => {});
    }
  });

  await Promise.allSettled(sends);
  return { sent, failed };
}
