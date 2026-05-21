/**
 * Time-capsule subscriptions for a verdict report. The user opts in to
 * receive a re-delivery email at 6 / 12 / 24 months past the unseal
 * date. The cron job `time-capsule-deliver` (src/jobs/cron.ts) scans
 * for deliver_at <= NOW() AND delivered_at IS NULL and emails.
 *
 * POST   /api/verdict-report/time-capsules
 *        body: { decision_id: uuid, intervals: number[] }
 *        intervals limited to [6, 12, 24] (months). Upsert semantics ·
 *        re-posting the same interval is a no-op, not an error.
 *
 * DELETE /api/verdict-report/time-capsules?decision_id=<uuid>&interval=<6|12|24>
 *        Cancel a previously-opted-in capsule. Only removes if it
 *        hasn't already been delivered.
 *
 * Auth: must be signed in and a participant in the decision; the
 * decision must be unsealed (you can't schedule a re-delivery for a
 * verdict that doesn't exist yet) and on a paid tier.
 */

import { NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { readSession, readSessionCookie } from '@/lib/sessions';
import { and, eq, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ALLOWED_INTERVALS = new Set([6, 12, 24]);
const PAID_TIERS = new Set(['solo_paid', 'couple', 'family']);

async function gateRequest(req: Request, decisionId: string): Promise<
  { ok: true; userId: string; unsealsAt: Date }
  | { ok: false; status: number; message: string }
> {
  const session = await readSession(readSessionCookie(req.headers));
  if (!session) return { ok: false, status: 401, message: 'You must be signed in.' };
  if (!/^[0-9a-f-]{36}$/i.test(decisionId)) {
    return { ok: false, status: 400, message: 'Invalid decision id.' };
  }

  const partRows = await db
    .select({ id: schema.participants.id })
    .from(schema.participants)
    .where(and(eq(schema.participants.decisionId, decisionId), eq(schema.participants.userId, session.userId)))
    .limit(1);
  if (partRows.length === 0) return { ok: false, status: 403, message: 'Not found.' };

  const decisionRows = await db
    .select({ tier: schema.decisions.tier, unsealsAt: schema.decisions.unsealsAt })
    .from(schema.decisions)
    .where(eq(schema.decisions.id, decisionId))
    .limit(1);
  if (decisionRows.length === 0) return { ok: false, status: 404, message: 'Decision not found.' };
  const d = decisionRows[0];

  if (!PAID_TIERS.has(d.tier)) {
    return { ok: false, status: 402, message: 'Time capsules are a paid-tier feature.' };
  }
  if (!d.unsealsAt || d.unsealsAt.getTime() > Date.now()) {
    return { ok: false, status: 409, message: 'The decision must be unsealed before scheduling a time capsule.' };
  }
  return { ok: true, userId: session.userId, unsealsAt: d.unsealsAt };
}

export async function POST(req: Request) {
  let body: { decision_id?: string; intervals?: unknown } = {};
  try { body = await req.json(); } catch { /* keep empty */ }
  const decisionId = String(body.decision_id ?? '');
  const intervalsIn = Array.isArray(body.intervals) ? body.intervals : [];

  const gate = await gateRequest(req, decisionId);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
  }

  const intervals = Array.from(new Set(
    intervalsIn
      .map((v) => Number(v))
      .filter((n) => Number.isFinite(n) && ALLOWED_INTERVALS.has(n))
  ));
  if (intervals.length === 0) {
    return NextResponse.json(
      { ok: false, message: 'Provide one or more intervals from {6, 12, 24}.' },
      { status: 400 }
    );
  }

  // Existing rows for this (decision, user) so we can skip duplicates.
  // Upsert via ON CONFLICT would be cleaner but the table has no unique
  // constraint on the triple yet · plain check-then-insert is fine for
  // this scale (max 3 rows per user per decision).
  const existing = await db
    .select({ intervalMonths: schema.verdictTimeCapsules.intervalMonths })
    .from(schema.verdictTimeCapsules)
    .where(
      and(
        eq(schema.verdictTimeCapsules.decisionId, decisionId),
        eq(schema.verdictTimeCapsules.userId, gate.userId)
      )
    );
  const existingSet = new Set(existing.map((r) => r.intervalMonths));
  const toInsert = intervals.filter((m) => !existingSet.has(m));

  for (const months of toInsert) {
    // deliver_at = unseals_at + N months. Postgres handles month math
    // correctly across DST and varying month lengths via INTERVAL.
    const deliverAt = new Date(gate.unsealsAt.getTime());
    deliverAt.setUTCMonth(deliverAt.getUTCMonth() + months);
    await db.insert(schema.verdictTimeCapsules).values({
      decisionId,
      userId: gate.userId,
      intervalMonths: months,
      deliverAt,
    });
  }

  return NextResponse.json(
    {
      ok: true,
      scheduled: intervals,
      newly_added: toInsert,
      already_subscribed: intervals.filter((m) => existingSet.has(m)),
    },
    { status: 200, headers: { 'cache-control': 'private, no-store' } }
  );
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const decisionId = String(url.searchParams.get('decision_id') ?? '');
  const interval = Number(url.searchParams.get('interval') ?? 0);

  const gate = await gateRequest(req, decisionId);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
  }
  if (!ALLOWED_INTERVALS.has(interval)) {
    return NextResponse.json({ ok: false, message: 'Interval must be 6, 12, or 24.' }, { status: 400 });
  }

  // Don't delete capsules that have already been delivered · they're
  // historical record. Use raw SQL for the IS NULL on delivered_at.
  await db.execute(sql`
    DELETE FROM verdict_time_capsules
    WHERE decision_id = ${decisionId}
      AND user_id = ${gate.userId}
      AND interval_months = ${interval}
      AND delivered_at IS NULL
  `);

  return NextResponse.json(
    { ok: true, cancelled: interval },
    { status: 200, headers: { 'cache-control': 'private, no-store' } }
  );
}
