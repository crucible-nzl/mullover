/**
 * POST /api/compose
 *   question       (10-280 chars)
 *   format         ('yes_no' | 'strong_lean' | 'a_b')
 *   duration_days  (7-365)
 *   tier           ('solo_free' | 'solo_paid' | 'couple' | 'family')
 *   participants   ([{display_name, invite_email}] for couple/family)
 *
 * PAYMENT-FIRST GATE (2026-05-24 rewrite).
 *
 * Status flow on insert:
 *   solo_free                              → 'active'           (runs immediately)
 *   solo_paid / couple / family            → 'pending_payment'  (no invites sent)
 *
 * For paid tiers, this endpoint NEVER sends invite emails. The Stripe
 * checkout-complete webhook is what flips 'pending_payment' →
 * 'pending_invites' AND fires the invite emails. This guarantees no
 * partner ever receives an email for a decision the owner has not paid
 * for, and no decision can be activated by partner-acceptance until
 * the webhook has confirmed payment.
 *
 * AUTO-UPGRADE TIER. If participants are supplied with a Solo tier,
 * the tier is upgraded silently to Couple (2 participants total) or
 * Family (3-6). The returned `tier` field reflects the effective tier
 * so the frontend can show the correct price before redirecting to
 * checkout. This means a Solo user who adds a partner WILL be charged
 * Couple pricing, but the frontend is responsible for previewing that
 * price before submit · the API is the defense-in-depth.
 *
 * Returns:
 *   { ok: true, decision_id, tier: <effective>, checkout_required, status,
 *     upgraded_from: <original-tier-if-upgraded> | null }
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@/lib/db';
import { readSession, readSessionCookie } from '@/lib/sessions';
import { newToken } from '@/lib/tokens';
import { eq, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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

type Tier = 'solo_free' | 'solo_paid' | 'couple' | 'family';

function maxParticipants(tier: Tier): number {
  switch (tier) {
    case 'solo_free':
    case 'solo_paid': return 1;
    case 'couple':    return 2;
    case 'family':    return 6;
  }
}

/**
 * Auto-upgrade tier based on participant count. Any non-solo tier with
 * the wrong count is rejected (we don't silently downgrade · that would
 * surprise the user). Solo + participants gets upgraded to couple/family.
 */
function resolveTier(requested: Tier, totalParticipants: number): { tier: Tier; upgradedFrom: Tier | null; error: string | null } {
  if (totalParticipants < 1) return { tier: requested, upgradedFrom: null, error: 'You must have at least one participant.' };
  if (totalParticipants > 6) return { tier: requested, upgradedFrom: null, error: 'A decision can have at most six participants.' };

  if (totalParticipants === 1) {
    if (requested === 'couple' || requested === 'family') {
      return { tier: requested, upgradedFrom: null, error: 'Couple and Family tiers need additional participants. Add at least one partner email.' };
    }
    return { tier: requested, upgradedFrom: null, error: null };
  }

  if (totalParticipants === 2) {
    if (requested === 'solo_free' || requested === 'solo_paid') {
      return { tier: 'couple', upgradedFrom: requested, error: null };
    }
    if (requested === 'family') {
      return { tier: requested, upgradedFrom: null, error: 'Family tier needs three or more participants.' };
    }
    return { tier: 'couple', upgradedFrom: null, error: null };
  }

  // 3-6 participants
  if (requested === 'solo_free' || requested === 'solo_paid' || requested === 'couple') {
    return { tier: 'family', upgradedFrom: requested, error: null };
  }
  return { tier: 'family', upgradedFrom: null, error: null };
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

  // ---- tier resolution (auto-upgrade) ----
  const partners = input.participants ?? [];
  const totalParticipants = 1 + partners.length; // owner counts as 1
  const { tier, upgradedFrom, error } = resolveTier(input.tier, totalParticipants);
  if (error) {
    return NextResponse.json({ ok: false, message: error }, { status: 422 });
  }
  if (totalParticipants > maxParticipants(tier)) {
    return NextResponse.json({ ok: false, message: `Tier ${tier} accepts at most ${maxParticipants(tier)} participants.` }, { status: 422 });
  }

  // ---- look up owner display name ----
  const userRows = await db
    .select({ firstName: schema.users.firstName, email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.id, session.userId))
    .limit(1);
  if (userRows.length === 0) {
    return NextResponse.json({ ok: false, message: 'Account not found.' }, { status: 404 });
  }
  const ownerName = input.owner_display_name ?? userRows[0].firstName ?? 'Owner';

  // ---- payment classification ----
  const isFree = tier === 'solo_free';
  const isPaid = !isFree;

  // ---- status on insert ----
  // FREE: active immediately. PAID: pending_payment until webhook clears.
  // Note: we still create the participant rows + invite tokens up front,
  // but the email send is deferred until the webhook fires for paid tiers.
  const initialStatus = isFree ? 'active' : 'pending_payment';
  const startsAt = isFree ? new Date() : null;
  const unsealsAt = isFree ? new Date(Date.now() + input.duration_days * 24 * 60 * 60 * 1000) : null;

  // ---- insert decision ----
  const insertedDecision = await db
    .insert(schema.decisions)
    .values({
      ownerUserId: session.userId,
      question: input.question,
      format: input.format,
      durationDays: input.duration_days,
      tier,
      status: initialStatus,
      startsAt,
      unsealsAt,
    })
    .returning({ id: schema.decisions.id });
  const decisionId = insertedDecision[0].id;

  // ---- insert participants (tokens generated for email-bound invites) ----
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

  // ---- auto-save invited partners to saved_contacts (free tiers only) ----
  // For paid tiers, defer this until the payment clears so we don't pollute
  // contacts with people who were never actually invited.
  if (isFree) {
    await persistContacts(session.userId, participantRows.slice(1), tier);
  }

  // ---- audit + log ----
  await db.insert(schema.auditLog).values({
    action: 'decision.created',
    actorUserId: session.userId,
    targetType: 'decision',
    targetId: decisionId,
    metadata: {
      tier,
      upgraded_from: upgradedFrom,
      participants: totalParticipants,
      status: initialStatus,
    },
  }).catch(() => { /* never fail compose on audit error */ });

  // ---- response ----
  // Free: success, redirect to /decisions.
  // Paid: success + checkout_required true; the frontend follows up with
  // POST /api/checkout/create to get the Stripe URL. The webhook is what
  // actually moves status forward and fires invites.
  return NextResponse.json(
    {
      ok: true,
      decision_id: decisionId,
      tier,
      checkout_required: isPaid,
      status: initialStatus,
      upgraded_from: upgradedFrom,
    },
    { status: 200 }
  );
}

async function persistContacts(
  userId: string,
  partners: typeof schema.participants.$inferInsert[],
  tier: Tier
) {
  const rows = partners
    .filter((p) => p.inviteEmail)
    .map((p) => ({
      userId,
      displayName: p.displayName,
      email: p.inviteEmail as string,
      relationship: (tier === 'couple' ? 'partner' : tier === 'family' ? 'family' : 'other') as
        'partner' | 'family' | 'other',
      lastInvitedAt: new Date(),
      inviteCount: 1,
    }));
  for (const c of rows) {
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
      .catch(() => { /* contact-save must never break compose */ });
  }
}
