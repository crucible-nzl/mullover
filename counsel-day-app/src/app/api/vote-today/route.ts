/**
 * GET /api/vote-today[?decision=<uuid>]
 *
 * Helper for the /vote-today.html page. Returns the user's active decision
 * (or the specific one if a decision_id query is supplied) along with their
 * "have you voted today" state. The page uses this to render the question,
 * the vote buttons, and an "already voted" notice if applicable.
 *
 * Returns 401 if not signed in, 404 if no active decision, 200 with payload otherwise.
 */

import { NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { readSession, readSessionCookie } from '@/lib/sessions';
import { sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const session = await readSession(readSessionCookie(req.headers));
  if (!session) {
    return NextResponse.json({ ok: false, message: 'You must be signed in.' }, { status: 401 });
  }

  const url = new URL(req.url);
  const wantedId = url.searchParams.get('decision');

  // Find the user's active decisions where they are a participant.
  // If a specific decision_id was supplied, filter to that one. Otherwise
  // return the one with the most recent activity.
  const idFilter = wantedId && /^[0-9a-f-]{36}$/i.test(wantedId)
    ? sql`AND d.id = ${wantedId}`
    : sql``;

  const rows = await db.execute(sql`
    SELECT
      d.id,
      d.question,
      d.format,
      d.duration_days,
      d.starts_at,
      d.unseals_at,
      d.tier,
      d.options,
      d.mode,
      p.id AS participant_id,
      p.display_name,
      EXTRACT(DAY FROM (NOW() - d.starts_at))::integer + 1 AS day_number,
      EXISTS (
        SELECT 1 FROM votes v
        WHERE v.participant_id = p.id
          AND v.vote_date = CURRENT_DATE
      ) AS voted_today
    FROM participants p
    JOIN decisions d ON d.id = p.decision_id
    WHERE p.user_id = ${session.userId}
      AND d.status = 'active'
      ${idFilter}
    ORDER BY d.starts_at DESC
    LIMIT 1
  `);

  const r = (rows as unknown as Array<Record<string, unknown>>)[0];
  if (!r) {
    return NextResponse.json(
      { ok: false, message: 'You have no active decisions.' },
      { status: 404 }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      decision: {
        id: r.id,
        question: r.question,
        format: r.format,
        duration_days: r.duration_days,
        starts_at: r.starts_at,
        unseals_at: r.unseals_at,
        day_number: r.day_number,
        tier: r.tier,
        mode: r.mode,
        options: r.options,
      },
      participant: {
        id: r.participant_id,
        display_name: r.display_name,
      },
      voted_today: r.voted_today,
    },
    { status: 200, headers: { 'cache-control': 'private, no-store' } }
  );
}
