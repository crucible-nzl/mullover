/**
 * GET /api/verdict-reveal?id=<uuid>
 *
 * Returns the verdict for a decision the requesting user is a participant in.
 * Strict sealing: the verdict body is only returned after `unseals_at` has
 * passed. Before that, returns metadata only (question, days remaining).
 *
 * Returns:
 *   200 { ok:true, decision, verdict?, participants }   · sealed + reveal-day cases
 *   401  not signed in
 *   403  not a participant in this decision
 *   404  decision not found
 *   409  unsealed but verdict not yet generated (cron will pick up within 30 min)
 */

import { NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { readSession, readSessionCookie } from '@/lib/sessions';
import { eq, and, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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

  // Check the user is a participant
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

  // Participants (display names + position only · NEVER user ids or emails)
  const participants = await db
    .select({
      position: schema.participants.position,
      displayName: schema.participants.displayName,
    })
    .from(schema.participants)
    .where(eq(schema.participants.decisionId, id));

  const now = Date.now();
  const unseals = decision.unsealsAt?.getTime() ?? Infinity;
  const isUnsealed = unseals <= now;

  if (!isUnsealed) {
    // Sealed · return metadata only, never the verdict
    return NextResponse.json(
      {
        ok: true,
        sealed: true,
        decision: {
          id: decision.id,
          question: decision.question,
          format: decision.format,
          duration_days: decision.durationDays,
          starts_at: decision.startsAt,
          unseals_at: decision.unsealsAt,
          days_remaining: Math.ceil((unseals - now) / (24 * 60 * 60 * 1000)),
        },
        participants,
      },
      { status: 200, headers: { 'cache-control': 'private, no-store' } }
    );
  }

  // Unsealed · fetch verdict if generated
  const verdictRows = await db
    .select({
      generatedAt: schema.verdicts.generatedAt,
      aiModel: schema.verdicts.aiModel,
      synthesisText: schema.verdicts.synthesisText,
      perParticipantSummary: schema.verdicts.perParticipantSummary,
      themes: schema.verdicts.themes,
      nextConversationPrompt: schema.verdicts.nextConversationPrompt,
      // TTS narration (optional · null when the cron hasn't generated
      // audio yet, when the verdict is solo_free / Python-summary-only,
      // or when OpenAI was unreachable at generation time).
      ttsAudioUrl: schema.verdicts.ttsAudioUrl,
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

  // For unsealed verdict we now include the day-by-day vote trajectory
  const votes = await db.execute(sql`
    SELECT p.display_name, p.position, v.vote_date, v.direction, v.conviction, v.note
    FROM votes v
    JOIN participants p ON p.id = v.participant_id
    WHERE v.decision_id = ${id}
    ORDER BY p.position, v.vote_date
  `);

  return NextResponse.json(
    {
      ok: true,
      sealed: false,
      decision: {
        id: decision.id,
        question: decision.question,
        format: decision.format,
        duration_days: decision.durationDays,
        starts_at: decision.startsAt,
        unseals_at: decision.unsealsAt,
      },
      participants,
      verdict: {
        ...verdictRows[0],
        // The HTML reads snake_case keys; mirror them so both work.
        // Tolerate both shapes long-term · don't break clients in either case.
        synthesis_text: verdictRows[0].synthesisText,
        next_conversation_prompt: verdictRows[0].nextConversationPrompt,
        tts_audio_url: verdictRows[0].ttsAudioUrl,
      },
      votes,
    },
    { status: 200, headers: { 'cache-control': 'private, no-store' } }
  );
}
