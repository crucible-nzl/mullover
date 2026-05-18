/**
 * POST /api/compose
 *   question       (10-280 chars · the actual question being decided)
 *   format         ('yes_no' | 'strong_lean' | 'a_b')
 *   duration_days  (7-365, capped at tier max)
 *   tier           ('solo_free' | 'solo_paid' | 'couple' | 'family')
 *   participants   ('James' or [{display_name, invite_email}] for couple/family)
 *
 * Requires an active session. Creates a decision in the 'pending_invites'
 * state, plus one participant row per voter. For solo_free / solo_paid,
 * the owner is the single participant and the row immediately becomes
 * 'active' with starts_at = NOW(), unseals_at = NOW() + duration_days.
 *
 * For couple/family, the decision sits in 'pending_invites' until either
 * (a) all invited participants have accepted, OR (b) Stripe checkout
 * completes (for paid SKUs · the webhook flips status to 'active').
 *
 * Returns: { ok: true, decision_id, checkout_required }
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@/lib/db';
import { readSession, readSessionCookie } from '@/lib/sessions';
import { newToken } from '@/lib/tokens';
import { sendTransactional, buildInviteEmail } from '@/lib/email';
import { eq, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BASE = process.env.APP_BASE_URL ?? 'https://counsel.day';

const participantSchema = z.object({
  display_name: z.string().trim().min(1).max(80),
  invite_email: z.string().trim().toLowerCase().email().max(200).optional(),
});

const composeSchema = z.object({
  question: z.string().trim().min(10).max(280),
  format: z.enum(['yes_no', 'strong_lean', 'a_b']),
  duration_days: z.coerce.number().int().min(7).max(365),
  tier: z.enum(['solo_free', 'solo_paid', 'couple', 'family']),
  owner_display_name: z.string().trim().min(1).max(80).optional(),
  participants: z.array(participantSchema).optional(),
});

function expectedParticipantCount(tier: string): { min: number; max: number } {
  switch (tier) {
    case 'solo_free':
    case 'solo_paid': return { min: 1, max: 1 };
    case 'couple':    return { min: 2, max: 2 };
    case 'family':    return { min: 3, max: 6 };
    default:          return { min: 1, max: 1 };
  }
}

export async function POST(req: Request) {
  // ---- auth ----
  const session = await readSession(readSessionCookie(req.headers));
  if (!session) {
    return NextResponse.json({ ok: false, message: 'You must be signed in.' }, { status: 401 });
  }

  // ---- parse ----
  let raw: Record<string, unknown>;
  try {
    const ct = req.headers.get('content-type') ?? '';
    raw = ct.includes('application/json')
      ? ((await req.json()) as Record<string, unknown>)
      : Object.fromEntries((await req.formData()).entries());
  } catch {
    return NextResponse.json({ ok: false, message: 'Could not read request body.' }, { status: 400 });
  }
  const parsed = composeSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) {
      const k = i.path[0]?.toString() ?? 'form';
      if (!fieldErrors[k]) fieldErrors[k] = i.message;
    }
    return NextResponse.json({ ok: false, field_errors: fieldErrors }, { status: 422 });
  }
  const input = parsed.data;

  // ---- participant arithmetic ----
  const { min, max } = expectedParticipantCount(input.tier);
  const partners = input.participants ?? [];
  const totalParticipants = 1 + partners.length; // owner counts
  if (totalParticipants < min || totalParticipants > max) {
    return NextResponse.json(
      { ok: false, message: `Tier ${input.tier} requires between ${min} and ${max} participants. You sent ${totalParticipants}.` },
      { status: 422 }
    );
  }

  // ---- look up owner display name from user record if not supplied ----
  const userRows = await db
    .select({ firstName: schema.users.firstName, email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.id, session.userId))
    .limit(1);
  const ownerName = input.owner_display_name ?? userRows[0]?.firstName ?? 'Owner';

  // ---- insert decision ----
  const isSolo = input.tier === 'solo_free' || input.tier === 'solo_paid';
  const isFree = input.tier === 'solo_free';
  const initialStatus = isFree
    ? 'active'
    : isSolo
      ? 'pending_invites' // paid solo waits for checkout
      : 'pending_invites'; // couple/family wait for invites + checkout

  const startsAt = isFree ? new Date() : null;
  const unsealsAt = isFree ? new Date(Date.now() + input.duration_days * 24 * 60 * 60 * 1000) : null;

  const insertedDecision = await db
    .insert(schema.decisions)
    .values({
      ownerUserId: session.userId,
      question: input.question,
      format: input.format,
      durationDays: input.duration_days,
      tier: input.tier,
      status: initialStatus,
      startsAt,
      unsealsAt,
    })
    .returning({ id: schema.decisions.id });

  const decisionId = insertedDecision[0].id;

  // ---- insert participants ----
  // owner is position 1, partners are 2..n
  const participantRows: typeof schema.participants.$inferInsert[] = [
    {
      decisionId,
      userId: session.userId,
      displayName: ownerName,
      position: 1,
      inviteAcceptedAt: new Date(), // owner is implicitly accepted
    },
  ];
  for (let i = 0; i < partners.length; i++) {
    participantRows.push({
      decisionId,
      displayName: partners[i].display_name,
      position: i + 2,
      inviteEmail: partners[i].invite_email ?? null,
      inviteToken: partners[i].invite_email ? newToken() : null,
    });
  }
  await db.insert(schema.participants).values(participantRows);

  // ---- auto-save invited partners to the user's saved_contacts ----
  // So the next time they compose a Couple/Family decision they can
  // quick-pick from a list instead of retyping every email. Upsert
  // keyed on (user_id, LOWER(email)) bumps the last_invited_at and
  // count when the same person is invited again.
  const contactRows = participantRows
    .slice(1)
    .filter((p) => p.inviteEmail)
    .map((p) => ({
      userId: session.userId,
      displayName: p.displayName,
      email: p.inviteEmail as string,
      relationship: (input.tier === 'couple' ? 'partner' : input.tier === 'family' ? 'family' : 'other') as
        'partner' | 'family' | 'other',
      lastInvitedAt: new Date(),
      inviteCount: 1,
    }));
  if (contactRows.length > 0) {
    for (const c of contactRows) {
      await db
        .insert(schema.savedContacts)
        .values(c)
        .onConflictDoUpdate({
          target: [schema.savedContacts.userId, schema.savedContacts.email],
          set: {
            displayName: c.displayName,
            lastInvitedAt: c.lastInvitedAt,
            inviteCount: sql`${schema.savedContacts.inviteCount} + 1`,
            updatedAt: new Date(),
          },
        })
        .catch(() => { /* best-effort · contact-save must never break compose */ });
    }
  }

  // ---- send invite emails (best-effort, never blocks the response) ----
  // We don't await inside the loop: a slow or failing Brevo call must not
  // hold up the compose flow. Failures are logged inside sendTransactional.
  const inviteRows = participantRows.slice(1).filter((p) => p.inviteEmail && p.inviteToken);
  if (inviteRows.length > 0) {
    const sends = inviteRows.map((p) => {
      const inviteUrl = `${BASE}/invite?token=${encodeURIComponent(p.inviteToken as string)}`;
      const { text, html } = buildInviteEmail({
        ownerName: ownerName,
        displayName: p.displayName,
        question: input.question,
        inviteUrl,
      });
      return sendTransactional({
        to: { email: p.inviteEmail as string, name: p.displayName },
        subject: `${ownerName} invited you to a Counsel.day decision`,
        textContent: text,
        htmlContent: html,
      });
    });
    // fire-and-await as a batch so 429 / 5xx surface in the server log
    await Promise.allSettled(sends);
  }

  return NextResponse.json(
    {
      ok: true,
      decision_id: decisionId,
      checkout_required: !isFree,
      status: initialStatus,
      invites_sent: inviteRows.length,
    },
    { status: 200 }
  );
}
