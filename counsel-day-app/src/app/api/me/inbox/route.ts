/**
 * GET /api/me/inbox · unified "what's new" feed for the signed-in user.
 *
 * Surfaces Decision verdicts (the verdicts table joined to decisions for
 * question text) as a single feed the /inbox page renders with one
 * template. Sorted newest-first. Paginated via ?cursor= (the generated_at
 * of the last item on the previous page).
 *
 * (Counsel Journal verdicts were part of this feed until the Journal
 * product was decommissioned on 2026-08-09.)
 *
 * Response:
 *   { ok: true,
 *     items: [
 *       { kind: 'decision_verdict',
 *         id: string,           // verdict row id
 *         generated_at: ISO,
 *         title: string,        // decision question
 *         preview: string,      // first 220 chars of synthesis
 *         link: string,         // deep link · /decision.html?id=…
 *       },
 *       ...
 *     ],
 *     next_cursor: ISO | null
 *   }
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { readSession, readSessionCookie } from '@/lib/sessions';
import { sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PAGE_SIZE = 30;

type Row = {
  kind: 'decision_verdict';
  id: string;
  generated_at: string;
  title: string;
  preview: string;
  link: string;
};

export async function GET(req: Request) {
  const session = await readSession(readSessionCookie(req.headers));
  if (!session) {
    return NextResponse.json({ ok: false, message: 'You must be signed in.' }, { status: 401 });
  }

  const url = new URL(req.url);
  const cursorRaw = url.searchParams.get('cursor');
  const cursor = cursorRaw && /^\d{4}-\d{2}-\d{2}T/.test(cursorRaw) ? cursorRaw : null;

  const userId = session.userId;
  const rows = await db.execute<Row>(sql`
    SELECT
      'decision_verdict'::text AS kind,
      v.id::text               AS id,
      v.generated_at           AS generated_at,
      d.question               AS title,
      COALESCE(SUBSTRING(v.synthesis_text FROM 1 FOR 220), '') AS preview,
      ('/decision.html?id=' || d.id::text) AS link
    FROM verdicts v
    JOIN decisions d ON d.id = v.decision_id
    WHERE d.id IN (SELECT decision_id FROM participants WHERE user_id = ${userId})
      AND ${cursor ? sql`v.generated_at < ${cursor}::timestamptz` : sql`true`}
    ORDER BY v.generated_at DESC
    LIMIT ${PAGE_SIZE + 1}
  `);

  const arr = Array.from(rows) as Row[];
  const items: Row[] = arr.slice(0, PAGE_SIZE);
  const nextCursor = arr.length > PAGE_SIZE ? arr[PAGE_SIZE - 1].generated_at : null;

  return NextResponse.json(
    { ok: true, items, next_cursor: nextCursor },
    { status: 200, headers: { 'cache-control': 'private, no-store' } },
  );
}
