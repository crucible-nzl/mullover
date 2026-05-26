/**
 * GET /api/daily/verdicts
 *
 * Returns the caller's recent weekly verdicts in descending order.
 * Only the user's own verdicts. No body, no Stripe fetch · the
 * cron writes the row, this endpoint just reads.
 */

import { NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { readSession, readSessionCookie } from '@/lib/sessions';
import { desc, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const session = await readSession(readSessionCookie(req.headers));
  if (!session) {
    return NextResponse.json({ ok: false, message: 'You must be signed in.' }, { status: 401 });
  }
  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '12'), 1), 60);

  const rows = await db
    .select({
      id: schema.journalVerdicts.id,
      week_starts_on: schema.journalVerdicts.weekStartsOn,
      week_ends_on: schema.journalVerdicts.weekEndsOn,
      kind: schema.journalVerdicts.kind,
      entries_count: schema.journalVerdicts.entriesCount,
      positives: schema.journalVerdicts.positives,
      strains: schema.journalVerdicts.strains,
      throughline: schema.journalVerdicts.throughline,
      question_for_next: schema.journalVerdicts.questionForNext,
      delivered_email_at: schema.journalVerdicts.deliveredEmailAt,
      created_at: schema.journalVerdicts.createdAt,
    })
    .from(schema.journalVerdicts)
    .where(eq(schema.journalVerdicts.userId, session.userId))
    .orderBy(desc(schema.journalVerdicts.weekStartsOn))
    .limit(limit);

  return NextResponse.json(
    { ok: true, verdicts: rows },
    { status: 200, headers: { 'cache-control': 'private, no-store' } }
  );
}
