/**
 * GET /api/decision?id=<uuid>
 *
 * Single-decision detail view used by /decision.html. Auth-gated and scoped:
 * the requesting user must be a participant in the decision. Returns enough
 * data to draw the day-strip, counters, CTA, and specimen without ever
 * leaking the contents of another participant's sealed votes.
 *
 * Sealing guarantee:
 *   · For the requesting user: their own past vote directions + notes ARE
 *     returned (it's their own data).
 *   · For OTHER participants: only a per-day boolean ("did they vote on
 *     this date?") is exposed. Direction/conviction/note are withheld
 *     until decisions.unseals_at has passed AND the verdict has been
 *     generated · at which point /api/verdict-reveal is the entry point.
 *
 * Returns:
 *   200 { ok, decision, participants, days, self_votes, partner_voted_dates }
 *   400  invalid id
 *   401  not signed in
 *   403  not a participant
 *   404  not found
 */

import { NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { readSession, readSessionCookie } from '@/lib/sessions';
import { eq, and, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toIsoDate(d: Date): string {
  // YYYY-MM-DD in UTC
  return d.toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  const session = await readSession(readSessionCookie(req.headers));
  if (!session) {
    return NextResponse.json({ ok: false, message: 'You must be signed in.' }, { status: 401 });
  }

  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ ok: false, message: 'Invalid decision id.' }, { status: 400 });
  }

  // Is the requester a participant? (also gives us their participant id)
  const meRows = await db
    .select({ id: schema.participants.id, position: schema.participants.position })
    .from(schema.participants)
    .where(
      and(eq(schema.participants.decisionId, id), eq(schema.participants.userId, session.userId))
    )
    .limit(1);
  if (meRows.length === 0) {
    // Treat as not-found rather than 403 to avoid enumeration.
    return NextResponse.json({ ok: false, message: 'Decision not found.' }, { status: 404 });
  }
  const myParticipantId = meRows[0].id;
  const myPosition = meRows[0].position;

  // Decision row
  const decisionRows = await db
    .select({
      id: schema.decisions.id,
      ownerUserId: schema.decisions.ownerUserId,
      question: schema.decisions.question,
      format: schema.decisions.format,
      durationDays: schema.decisions.durationDays,
      tier: schema.decisions.tier,
      status: schema.decisions.status,
      startsAt: schema.decisions.startsAt,
      unsealsAt: schema.decisions.unsealsAt,
      amountPaidCents: schema.decisions.amountPaidCents,
      createdAt: schema.decisions.createdAt,
      pausedAt: schema.decisions.pausedAt,
      reopenAt: schema.decisions.reopenAt,
      mode: schema.decisions.mode,
      options: schema.decisions.options,
      pausedUntil: schema.decisions.pausedUntil,
    })
    .from(schema.decisions)
    .where(eq(schema.decisions.id, id))
    .limit(1);
  if (decisionRows.length === 0) {
    return NextResponse.json({ ok: false, message: 'Decision not found.' }, { status: 404 });
  }
  const decision = decisionRows[0];

  // Participants · display names + position + accepted/invited status only.
  // Never the email address, never the user id.
  const participants = await db
    .select({
      position: schema.participants.position,
      displayName: schema.participants.displayName,
      isOwner: sql<boolean>`${schema.participants.userId} = ${decision.ownerUserId}`,
      accepted: sql<boolean>`${schema.participants.inviteAcceptedAt} IS NOT NULL`,
      isYou: sql<boolean>`${schema.participants.id} = ${myParticipantId}`,
    })
    .from(schema.participants)
    .where(eq(schema.participants.decisionId, id))
    .orderBy(schema.participants.position);

  // Self votes · the requesting user IS allowed to see their own past
  // vote directions + notes (it's their data). Restricted to their own
  // participant id.
  const selfVotes = await db
    .select({
      voteDate: schema.votes.voteDate,
      direction: schema.votes.direction,
      conviction: schema.votes.conviction,
      note: schema.votes.note,
      sealedAt: schema.votes.sealedAt,
    })
    .from(schema.votes)
    .where(eq(schema.votes.participantId, myParticipantId))
    .orderBy(schema.votes.voteDate);

  // Partner voted-dates · boolean only. For each non-self participant,
  // give the list of dates they have a vote row for. UI uses this to
  // render the "partner voted tonight" indicator without ever exposing
  // direction.
  const partnerDateRows = await db.execute<{
    position: number;
    display_name: string;
    vote_date: string;
  }>(sql`
    SELECT p.position, p.display_name, v.vote_date::text AS vote_date
    FROM votes v
    JOIN participants p ON p.id = v.participant_id
    WHERE v.decision_id = ${id}
      AND p.id <> ${myParticipantId}
    ORDER BY p.position, v.vote_date
  `);

  // Day strip · from starts_at (inclusive) to MIN(today, unseals_at-1).
  // For decisions still in 'pending_invites' (no starts_at yet), return
  // an empty days array; the UI will fall through to the placeholder.
  const days: Array<{
    n: number;
    iso_date: string;
    state: 'sealed' | 'today' | 'pending' | 'skipped';
    self_voted: boolean;
  }> = [];

  if (decision.startsAt && decision.unsealsAt) {
    const startMs = decision.startsAt.getTime();
    const endMs = decision.unsealsAt.getTime();
    const totalDays = Math.max(1, Math.round((endMs - startMs) / MS_PER_DAY));
    const todayIso = toIsoDate(new Date());
    const selfDates = new Set(selfVotes.map((v) => String(v.voteDate)));

    for (let i = 0; i < totalDays; i++) {
      const dayDate = new Date(startMs + i * MS_PER_DAY);
      const iso = toIsoDate(dayDate);
      const isFuture = iso > todayIso;
      const isToday = iso === todayIso;
      const selfVoted = selfDates.has(iso);
      let state: 'sealed' | 'today' | 'pending' | 'skipped';
      if (isFuture) state = 'pending';
      else if (isToday) state = selfVoted ? 'sealed' : 'today';
      else state = selfVoted ? 'sealed' : 'skipped';
      days.push({ n: i + 1, iso_date: iso, state, self_voted: selfVoted });
    }
  }

  // Per-partner voted-dates (boolean only) grouped by participant
  const partnerVotedByPos: Record<number, string[]> = {};
  const partnerNames: Record<number, string> = {};
  for (const r of partnerDateRows) {
    const pos = Number(r.position);
    (partnerVotedByPos[pos] ||= []).push(String(r.vote_date));
    partnerNames[pos] ||= String(r.display_name);
  }

  const todayIso = toIsoDate(new Date());
  const youVotedToday = selfVotes.some((v) => String(v.voteDate) === todayIso);

  // Total day count for "Day X of Y" header
  const totalDays =
    decision.startsAt && decision.unsealsAt
      ? Math.max(
          1,
          Math.round(
            (decision.unsealsAt.getTime() - decision.startsAt.getTime()) / MS_PER_DAY
          )
        )
      : decision.durationDays;
  const dayNumber = decision.startsAt
    ? Math.min(
        totalDays,
        Math.max(1, Math.floor((Date.now() - decision.startsAt.getTime()) / MS_PER_DAY) + 1)
      )
    : 0;
  const daysRemaining = decision.unsealsAt
    ? Math.max(0, Math.ceil((decision.unsealsAt.getTime() - Date.now()) / MS_PER_DAY))
    : decision.durationDays;

  return NextResponse.json(
    {
      ok: true,
      decision: {
        id: decision.id,
        question: decision.question,
        format: decision.format,
        duration_days: decision.durationDays,
        tier: decision.tier,
        status: decision.status,
        starts_at: decision.startsAt,
        unseals_at: decision.unsealsAt,
        created_at: decision.createdAt,
        amount_paid_cents: decision.amountPaidCents,
        day_number: dayNumber,
        total_days: totalDays,
        days_remaining: daysRemaining,
        you_voted_today: youVotedToday,
        is_unsealed: decision.unsealsAt ? decision.unsealsAt.getTime() <= Date.now() : false,
        paused_at: decision.pausedAt,
        reopen_at: decision.reopenAt,
        mode: decision.mode,
        options: decision.options,
        paused_until: decision.pausedUntil,
        is_paused: decision.pausedUntil ? decision.pausedUntil.getTime() > Date.now() : false,
      },
      you: { participant_id: myParticipantId, position: myPosition },
      participants: participants.map((p) => ({
        position: p.position,
        display_name: p.displayName,
        is_you: p.isYou,
        is_owner: p.isOwner,
        accepted: p.accepted,
        voted_today: (partnerVotedByPos[p.position] ?? selfVotes.map((v) => String(v.voteDate)))
          .includes(todayIso),
        voted_dates: p.isYou
          ? selfVotes.map((v) => String(v.voteDate))
          : (partnerVotedByPos[p.position] ?? []),
      })),
      days,
      self_votes: selfVotes.map((v) => ({
        date: String(v.voteDate),
        direction: v.direction,
        conviction: v.conviction,
        note: v.note,
        sealed_at: v.sealedAt,
      })),
    },
    { status: 200, headers: { 'cache-control': 'private, no-store' } }
  );
}
