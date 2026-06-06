/**
 * GET /api/me/inbox · unified "what's new" feed for the signed-in user.
 *
 * Aggregates two streams that previously lived only inside their
 * respective product surfaces:
 *
 *   1. Decision verdicts · verdicts table joined to decisions for
 *      question text
 *   2. Journal verdicts · journalVerdicts table · weekly + monthly
 *      themed kinds
 *
 * Returns a unified list shape so the /inbox page can render both with
 * a single template. Sorted newest-first. Paginated via ?cursor= (the
 * created_at of the last item on the previous page).
 *
 * Response:
 *   { ok: true,
 *     items: [
 *       { kind: 'decision_verdict' | 'journal_weekly' | 'journal_monthly',
 *         id: string,           // verdict row id
 *         generated_at: ISO,
 *         title: string,        // decision question or "Week of X to Y"
 *         preview: string,      // first 220 chars of synthesis / throughline
 *         link: string,         // deep link · /decision.html?id=… etc.
 *         meta?: { ... }        // kind-specific extras
 *       },
 *       ...
 *     ],
 *     next_cursor: ISO | null
 *   }
 */

import { NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { readSession, readSessionCookie } from '@/lib/sessions';
import { sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PAGE_SIZE = 30;

type Row = {
  kind: 'decision_verdict' | 'journal_weekly' | 'journal_monthly';
  id: string;
  generated_at: string;
  title: string;
  preview: string;
  link: string;
  meta?: Record<string, unknown>;
};

export async function GET(req: Request) {
  const session = await readSession(readSessionCookie(req.headers));
  if (!session) {
    return NextResponse.json({ ok: false, message: 'You must be signed in.' }, { status: 401 });
  }

  const url = new URL(req.url);
  const cursorRaw = url.searchParams.get('cursor');
  const cursor = cursorRaw && /^\d{4}-\d{2}-\d{2}T/.test(cursorRaw) ? cursorRaw : null;

  // Single SQL · union the two streams server-side so we can offset by
  // generated_at globally rather than fetching extra rows per stream.
  type RawRow = {
    kind: string;
    id: string;
    generated_at: string;
    title: string;
    preview: string;
    link: string;
    week_starts_on: string | null;
    week_ends_on: string | null;
    journal_kind: string | null;
  };

  const userId = session.userId;
  const rows = await db.execute<RawRow>(sql`
    WITH decision_feed AS (
      SELECT
        'decision_verdict'::text AS kind,
        v.id::text               AS id,
        v.generated_at           AS generated_at,
        d.question               AS title,
        COALESCE(SUBSTRING(v.synthesis_text FROM 1 FOR 220), '') AS preview,
        ('/decision.html?id=' || d.id::text) AS link,
        NULL::date AS week_starts_on,
        NULL::date AS week_ends_on,
        NULL::text AS journal_kind
      FROM verdicts v
      JOIN decisions d ON d.id = v.decision_id
      WHERE d.id IN (SELECT decision_id FROM participants WHERE user_id = ${userId})
    ),
    journal_feed AS (
      SELECT
        CASE WHEN jv.kind = 'monthly_themed' OR jv.kind = 'monthly'
             THEN 'journal_monthly' ELSE 'journal_weekly' END  AS kind,
        jv.id::text             AS id,
        jv.created_at           AS generated_at,
        CASE WHEN jv.kind = 'monthly_themed' OR jv.kind = 'monthly'
             THEN ('Monthly themed verdict for ' || TO_CHAR(jv.week_starts_on, 'FMMonth YYYY'))
             ELSE ('Week of ' || TO_CHAR(jv.week_starts_on, 'DD Mon') || ' to ' || TO_CHAR(jv.week_ends_on, 'DD Mon YYYY'))
        END                     AS title,
        COALESCE(SUBSTRING(jv.throughline FROM 1 FOR 220), '') AS preview,
        '/vault.html'           AS link,
        jv.week_starts_on       AS week_starts_on,
        jv.week_ends_on         AS week_ends_on,
        jv.kind                 AS journal_kind
      FROM journal_verdicts jv
      WHERE jv.user_id = ${userId}
    )
    SELECT * FROM (
      SELECT * FROM decision_feed
      UNION ALL
      SELECT * FROM journal_feed
    ) feed
    WHERE ${cursor ? sql`generated_at < ${cursor}::timestamptz` : sql`true`}
    ORDER BY generated_at DESC
    LIMIT ${PAGE_SIZE + 1}
  `);

  const arr = Array.from(rows) as RawRow[];
  const items: Row[] = arr.slice(0, PAGE_SIZE).map((r) => {
    const out: Row = {
      kind: r.kind as Row['kind'],
      id: r.id,
      generated_at: r.generated_at,
      title: r.title,
      preview: r.preview,
      link: r.link,
    };
    if (r.kind !== 'decision_verdict') {
      out.meta = {
        week_starts_on: r.week_starts_on,
        week_ends_on: r.week_ends_on,
        journal_kind: r.journal_kind,
      };
    }
    return out;
  });
  const nextCursor = arr.length > PAGE_SIZE ? arr[PAGE_SIZE - 1].generated_at : null;

  return NextResponse.json(
    { ok: true, items, next_cursor: nextCursor },
    { status: 200, headers: { 'cache-control': 'private, no-store' } },
  );
}
