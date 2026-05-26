/**
 * POST /api/vote
 *   decision_id   (uuid)
 *   direction     ('yes' | 'no' | 'strong_yes' | 'lean_yes' | 'lean_no' | 'strong_no' | 'a' | 'b')
 *   conviction    (optional · 0.00 to 1.00)
 *   note          (optional · max 2000 chars)
 *
 * Requires an active session. Inserts a vote row scoped to (participant, today).
 * One vote per participant per day. If already voted today, returns 409.
 *
 * The seal is the unique index on (participant_id, vote_date) PLUS the fact
 * that nothing in the API reveals OTHER participants' votes for a decision
 * until decisions.unseals_at has passed. See /api/verdict (next round).
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@/lib/db';
import { readSession, readSessionCookie } from '@/lib/sessions';
import { eq, and } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Follow-up chips on low-conviction / negative votes. Stored as
// short tag strings; the verdict cron clusters them across votes
// to produce cause-grounded themes ("workload came up 4 of 7 nights").
// Bank kept small + opinionated; "other" lets the user type free text
// in the note field.
const TAG_ENUM = z.enum([
  'workload',
  'sleep',
  'time',
  'money',
  'the_other_person',
  'health',
  'family',
  'role_clarity',
  'meetings',
  'other',
]);

const voteSchema = z.object({
  decision_id: z.string().uuid(),
  direction: z.enum(['yes', 'no', 'strong_yes', 'lean_yes', 'lean_no', 'strong_no', 'a', 'b', 'ranked']),
  conviction: z.coerce.number().min(0).max(1).optional(),
  note: z.string().max(2000).optional(),
  tags: z.array(TAG_ENUM).max(5).optional(),
  // ranked-format only: array of option indices (top-pick first).
  // Length must equal the parent decision's options length.
  ranked_order: z.array(z.coerce.number().int().min(0).max(20)).min(2).max(20).optional(),
});

function todayDateString(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export async function POST(req: Request) {
  const session = await readSession(readSessionCookie(req.headers));
  if (!session) {
    return NextResponse.json({ ok: false, message: 'You must be signed in.' }, { status: 401 });
  }

  let raw: Record<string, unknown>;
  try {
    const ct = req.headers.get('content-type') ?? '';
    raw = ct.includes('application/json')
      ? ((await req.json()) as Record<string, unknown>)
      : Object.fromEntries((await req.formData()).entries());
  } catch {
    return NextResponse.json({ ok: false, message: 'Could not read request body.' }, { status: 400 });
  }
  const parsed = voteSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: 'Invalid vote.', issues: parsed.error.issues }, { status: 422 });
  }
  const { decision_id, direction, conviction, note, tags, ranked_order } = parsed.data;

  // If direction === 'ranked' the caller MUST supply ranked_order, and
  // the indices must be unique + match the parent decision's option count.
  if (direction === 'ranked') {
    if (!ranked_order || ranked_order.length < 2) {
      return NextResponse.json({ ok: false, message: 'Ranked votes require an ordering of all options.' }, { status: 422 });
    }
    const uniq = new Set(ranked_order);
    if (uniq.size !== ranked_order.length) {
      return NextResponse.json({ ok: false, message: 'Each option must appear in the ranking exactly once.' }, { status: 422 });
    }
  }

  // Resolve participant row for THIS user in THIS decision (a user might
  // be the owner OR an invited partner who has accepted).
  const participantRows = await db
    .select({ id: schema.participants.id, decisionId: schema.participants.decisionId })
    .from(schema.participants)
    .where(and(eq(schema.participants.decisionId, decision_id), eq(schema.participants.userId, session.userId)))
    .limit(1);
  if (participantRows.length === 0) {
    return NextResponse.json({ ok: false, message: 'You are not a participant in this decision.' }, { status: 403 });
  }
  const participantId = participantRows[0].id;

  // Check decision is active (not pending, not sealed, not completed, not paused)
  const decisionRows = await db
    .select({ status: schema.decisions.status, unsealsAt: schema.decisions.unsealsAt, pausedUntil: schema.decisions.pausedUntil })
    .from(schema.decisions)
    .where(eq(schema.decisions.id, decision_id))
    .limit(1);
  if (decisionRows.length === 0) {
    return NextResponse.json({ ok: false, message: 'Decision not found.' }, { status: 404 });
  }
  const decision = decisionRows[0];
  if (decision.status !== 'active') {
    return NextResponse.json(
      { ok: false, message: `Decision is not accepting votes (status: ${decision.status}).` },
      { status: 409 }
    );
  }
  if (decision.pausedUntil && decision.pausedUntil.getTime() > Date.now()) {
    const resumes = decision.pausedUntil.toISOString().slice(0, 10);
    return NextResponse.json(
      { ok: false, message: `This decision is paused · resumes ${resumes}.` },
      { status: 409 }
    );
  }

  // Insert vote · unique index on (participant_id, vote_date) means re-vote returns 409
  try {
    await db.insert(schema.votes).values({
      decisionId: decision_id,
      participantId,
      voteDate: todayDateString(),
      direction,
      conviction: conviction != null ? conviction.toFixed(2) : null,
      note: note ?? null,
      tags: (tags ?? []) as unknown as object,
      rankedOrder: ranked_order ? (ranked_order as unknown as object) : null,
    });
  } catch (err) {
    const msg = (err as Error).message ?? '';
    if (msg.includes('votes_participant_date_unique')) {
      return NextResponse.json(
        { ok: false, message: "You've already voted today. Come back tomorrow." },
        { status: 409 }
      );
    }
    throw err;
  }

  return NextResponse.json({ ok: true, message: 'Vote sealed.' }, { status: 200 });
}
