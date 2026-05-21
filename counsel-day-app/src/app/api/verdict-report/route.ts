/**
 * GET /api/verdict-report?id=<uuid>
 *
 * Premium verdict report endpoint · returns everything /api/verdict-reveal
 * returns PLUS the full analysis_json blob (sentiment trajectory, themes,
 * asymmetries, vocabulary overlap, word cloud, key quotes) that the
 * Python NLP pass writes into verdicts.analysis_json during cron.
 *
 * Tier gating: the rich analysis is only included for paid tiers
 * (solo_paid, couple, family). Solo_free decisions still get the prose
 * verdict and per-participant numerical summary via /api/verdict-reveal;
 * this endpoint returns 402 for them so the frontend can upsell.
 *
 * Sealing: identical rules to /api/verdict-reveal · sealed decisions
 * return metadata only, no report body.
 *
 * Returns:
 *   200 { ok:true, decision, verdict, participants, analysis, votes, time_capsules }
 *   401 not signed in
 *   402 free tier · upgrade required
 *   403 not a participant
 *   404 decision not found
 *   409 unsealed but verdict still generating
 */

import { NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { readSession, readSessionCookie } from '@/lib/sessions';
import { eq, and, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PAID_TIERS = new Set(['solo_paid', 'couple', 'family']);

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

  // Participant check · same as /api/verdict-reveal. Returning 403 (not
  // 404) is correct here · the requester is signed in but isn't on this
  // decision. We don't leak whether the id exists.
  const partRows = await db
    .select({ id: schema.participants.id })
    .from(schema.participants)
    .where(and(eq(schema.participants.decisionId, id), eq(schema.participants.userId, session.userId)))
    .limit(1);
  if (partRows.length === 0) {
    return NextResponse.json({ ok: false, message: 'Not found.' }, { status: 403 });
  }

  const decisionRows = await db
    .select({
      id: schema.decisions.id,
      question: schema.decisions.question,
      format: schema.decisions.format,
      tier: schema.decisions.tier,
      durationDays: schema.decisions.durationDays,
      status: schema.decisions.status,
      startsAt: schema.decisions.startsAt,
      unsealsAt: schema.decisions.unsealsAt,
    })
    .from(schema.decisions)
    .where(eq(schema.decisions.id, id))
    .limit(1);
  if (decisionRows.length === 0) {
    return NextResponse.json({ ok: false, message: 'Decision not found.' }, { status: 404 });
  }
  const decision = decisionRows[0];

  if (!PAID_TIERS.has(decision.tier)) {
    return NextResponse.json(
      {
        ok: false,
        upgrade_required: true,
        message: 'The premium verdict report is available for Solo Paid, Couple, and Family tiers. Your current decision is on the free tier.',
      },
      { status: 402, headers: { 'cache-control': 'private, no-store' } }
    );
  }

  const now = Date.now();
  const unseals = decision.unsealsAt?.getTime() ?? Infinity;
  const isUnsealed = unseals <= now;

  if (!isUnsealed) {
    // Sealed · same shape as /api/verdict-reveal so the report page can
    // render a "still sealed" view without a separate code path.
    return NextResponse.json(
      {
        ok: true,
        sealed: true,
        decision: {
          id: decision.id,
          question: decision.question,
          format: decision.format,
          tier: decision.tier,
          duration_days: decision.durationDays,
          starts_at: decision.startsAt,
          unseals_at: decision.unsealsAt,
          days_remaining: Math.ceil((unseals - now) / (24 * 60 * 60 * 1000)),
        },
      },
      { status: 200, headers: { 'cache-control': 'private, no-store' } }
    );
  }

  // Unsealed · fetch verdict + analysis
  const verdictRows = await db
    .select({
      generatedAt: schema.verdicts.generatedAt,
      aiModel: schema.verdicts.aiModel,
      synthesisText: schema.verdicts.synthesisText,
      perParticipantSummary: schema.verdicts.perParticipantSummary,
      themes: schema.verdicts.themes,
      nextConversationPrompt: schema.verdicts.nextConversationPrompt,
      analysisJson: schema.verdicts.analysisJson,
    })
    .from(schema.verdicts)
    .where(eq(schema.verdicts.decisionId, id))
    .limit(1);

  if (verdictRows.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        sealed: false,
        message: 'The decision period has ended; the verdict is being generated. Check back in a few minutes.',
      },
      { status: 409, headers: { 'cache-control': 'private, no-store' } }
    );
  }

  const participants = await db
    .select({ position: schema.participants.position, displayName: schema.participants.displayName })
    .from(schema.participants)
    .where(eq(schema.participants.decisionId, id));

  const votes = await db.execute(sql`
    SELECT p.display_name, p.position, v.vote_date, v.direction, v.conviction, v.note
    FROM votes v
    JOIN participants p ON p.id = v.participant_id
    WHERE v.decision_id = ${id}
    ORDER BY p.position, v.vote_date
  `);

  // Time capsules already opted into · the report page renders these as
  // "scheduled re-deliveries" with options to add new ones.
  const timeCapsules = await db
    .select({
      intervalMonths: schema.verdictTimeCapsules.intervalMonths,
      deliverAt: schema.verdictTimeCapsules.deliverAt,
      deliveredAt: schema.verdictTimeCapsules.deliveredAt,
      createdAt: schema.verdictTimeCapsules.createdAt,
    })
    .from(schema.verdictTimeCapsules)
    .where(
      and(
        eq(schema.verdictTimeCapsules.decisionId, id),
        eq(schema.verdictTimeCapsules.userId, session.userId)
      )
    );

  return NextResponse.json(
    {
      ok: true,
      sealed: false,
      decision: {
        id: decision.id,
        question: decision.question,
        format: decision.format,
        tier: decision.tier,
        duration_days: decision.durationDays,
        starts_at: decision.startsAt,
        unseals_at: decision.unsealsAt,
      },
      participants,
      verdict: verdictRows[0],
      // analysis_json is the Python NLP output · documented shape in
      // counsel-day-app/python/analyse_verdict.py. May be null when the
      // analysis pass failed (verdict still ships, panels degrade).
      analysis: verdictRows[0].analysisJson ?? null,
      votes,
      time_capsules: timeCapsules,
    },
    { status: 200, headers: { 'cache-control': 'private, no-store' } }
  );
}
