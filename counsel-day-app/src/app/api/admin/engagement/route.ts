/**
 * GET /api/admin/engagement
 *
 * Product engagement metrics. Everything is from Postgres.
 *
 *   · vote_fill_rate         votes_cast / votes_expected · last 30 active days
 *   · verdict_completion     decisions that reached verdict / decisions that started
 *   · participants_per_dec   histogram of (participant count) → decision count
 *   · time_to_first_vote     median seconds from decision start to first vote
 *   · status_funnel          { pending, active, completed, cancelled, refunded }
 *
 * Admin gate via requireAdmin().
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';
import { requireAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    try { return await fn(); } catch (e) { console.warn('[admin/engagement] subquery failed:', e); return fallback; }
  }

  // Vote fill rate · count actual votes per (decision, day) across active
  // decisions in last 30 days, divided by what we *should* have had given
  // the participant count.
  const voteFillRate = await safe(async () => {
    const rows = await db.execute<{ cast: string; expected: string }>(sql`
      WITH active_days AS (
        SELECT d.id AS decision_id,
               generate_series(d.starts_at::date, LEAST(d.unseals_at::date, CURRENT_DATE)::date, INTERVAL '1 day')::date AS vote_date
        FROM decisions d
        WHERE d.starts_at > NOW() - INTERVAL '30 days'
          AND d.status IN ('active', 'completed', 'verdict_generating')
      ),
      expected AS (
        SELECT count(*)::text AS expected
        FROM active_days a
        JOIN participants p ON p.decision_id = a.decision_id
        WHERE p.user_id IS NOT NULL
      ),
      cast_count AS (
        SELECT count(*)::text AS cast
        FROM votes v
        WHERE v.vote_date > NOW() - INTERVAL '30 days'
      )
      SELECT (SELECT cast FROM cast_count) AS cast,
             (SELECT expected FROM expected) AS expected
    `);
    const r = rows[0] as { cast: string; expected: string };
    const cast = Number(r.cast);
    const expected = Math.max(1, Number(r.expected));
    return { cast, expected, percent: +(cast * 100 / expected).toFixed(2) };
  }, { cast: 0, expected: 0, percent: 0 });

  // Verdict completion · decisions reaching verdict / decisions that started
  const verdictCompletion = await safe(async () => {
    const rows = await db.execute<{ started: string; completed: string }>(sql`
      SELECT
        (SELECT count(*)::text FROM decisions WHERE status IN ('active', 'completed', 'verdict_generating', 'cancelled')) AS started,
        (SELECT count(*)::text FROM decisions WHERE status = 'completed') AS completed
    `);
    const r = rows[0] as { started: string; completed: string };
    const started = Number(r.started);
    const completed = Number(r.completed);
    return { started, completed, percent: started === 0 ? 0 : +(completed * 100 / started).toFixed(2) };
  }, { started: 0, completed: 0, percent: 0 });

  // Participant histogram · how many decisions have N participants
  const participantsHist = await safe(async () => {
    const rows = await db.execute<{ n: string; decisions: string }>(sql`
      SELECT n::text AS n, count(*)::text AS decisions
      FROM (
        SELECT decision_id, count(*) AS n FROM participants GROUP BY decision_id
      ) sub
      GROUP BY n
      ORDER BY n
    `);
    return Array.from(rows).map((r) => ({ participants: Number(r.n), decisions: Number(r.decisions) }));
  }, []);

  // Median time to first vote (seconds) · how quickly users start once they file
  const timeToFirstVote = await safe(async () => {
    const rows = await db.execute<{ p50: string | null }>(sql`
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (first_vote - d.starts_at)))::text AS p50
      FROM (
        SELECT v.decision_id, MIN(v.created_at) AS first_vote
        FROM votes v
        GROUP BY v.decision_id
      ) firsts
      JOIN decisions d ON d.id = firsts.decision_id
      WHERE d.starts_at > NOW() - INTERVAL '90 days'
    `);
    const r = rows[0] as { p50: string | null };
    return { median_seconds: r.p50 ? Math.round(Number(r.p50)) : null };
  }, { median_seconds: null });

  // Status funnel
  const statusFunnel = await safe(async () => {
    const rows = await db.execute<{ pending: string; active: string; vg: string; completed: string; cancelled: string; refunded: string }>(sql`
      SELECT
        count(*) FILTER (WHERE status = 'pending_invites')::text AS pending,
        count(*) FILTER (WHERE status = 'active')::text AS active,
        count(*) FILTER (WHERE status = 'verdict_generating')::text AS vg,
        count(*) FILTER (WHERE status = 'completed')::text AS completed,
        count(*) FILTER (WHERE status = 'cancelled')::text AS cancelled,
        count(*) FILTER (WHERE status = 'refunded')::text AS refunded
      FROM decisions
    `);
    const r = rows[0] as { pending: string; active: string; vg: string; completed: string; cancelled: string; refunded: string };
    return {
      pending_invites: Number(r.pending),
      active: Number(r.active),
      verdict_generating: Number(r.vg),
      completed: Number(r.completed),
      cancelled: Number(r.cancelled),
      refunded: Number(r.refunded),
    };
  }, { pending_invites: 0, active: 0, verdict_generating: 0, completed: 0, cancelled: 0, refunded: 0 });

  return NextResponse.json(
    { ok: true, generated_at: new Date().toISOString(), vote_fill_rate: voteFillRate, verdict_completion: verdictCompletion, participants_hist: participantsHist, time_to_first_vote: timeToFirstVote, status_funnel: statusFunnel },
    { headers: { 'cache-control': 'private, no-store' } }
  );
}
