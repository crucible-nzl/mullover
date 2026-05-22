/**
 * GET /api/admin/insights
 *
 * Returns three datasets for the /admin-insights.html dashboard.
 * All three are computed live (no caching) but each query is shape-
 * small enough that even at 100k users we stay sub-second.
 *
 *   1. funnel        · counts at each activation stage; rendered as
 *                       a Sankey diagram (D3 sankey)
 *   2. vote_heatmap  · 7 x 24 counts of votes cast by (day-of-week,
 *                       hour-of-day) in the requestor's UTC frame.
 *                       Rendered as a coloured grid.
 *   3. cohort        · users grouped by signup month, then per-cohort
 *                       count of users who voted in each subsequent
 *                       month. Returned as a 2-D array. Rendered as
 *                       a coloured retention heatmap.
 *
 * Admin-only. Operator uses this to see where the funnel leaks, when
 * to schedule the evening-prompt cron, and whether cohorts are retaining.
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/admin-auth';
import { sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  // ---- FUNNEL ----
  // Stages, in order:
  //   signed_up           · users row exists
  //   email_verified      · users.email_verified_at set
  //   composed_first      · has at least one decision they own
  //   voted_first         · has cast at least one vote
  //   verdict_opened      · has a decision past unseals_at with verdict row
  //   second_decision     · has composed a second decision
  // The Sankey edges are stage[i] -> stage[i+1]; the value of each
  // edge is the count of users who made the transition.
  type FunnelRow = {
    signed_up: string;
    email_verified: string;
    composed_first: string;
    voted_first: string;
    verdict_opened: string;
    second_decision: string;
  };
  const funnelRows = await db.execute<FunnelRow>(sql`
    WITH user_states AS (
      SELECT
        u.id,
        u.email_verified_at IS NOT NULL                                 AS verified,
        EXISTS (SELECT 1 FROM decisions d WHERE d.owner_user_id = u.id) AS composed,
        EXISTS (
          SELECT 1 FROM votes v
          JOIN participants p ON p.id = v.participant_id
          WHERE p.user_id = u.id
        )                                                                AS voted,
        EXISTS (
          SELECT 1 FROM verdicts v
          JOIN decisions d ON d.id = v.decision_id
          WHERE d.owner_user_id = u.id
        )                                                                AS verdict_opened,
        (SELECT count(*) FROM decisions d WHERE d.owner_user_id = u.id) AS decision_count
      FROM users u
      WHERE u.deleted_at IS NULL
    )
    SELECT
      count(*)::text                                                            AS signed_up,
      count(*) FILTER (WHERE verified)::text                                    AS email_verified,
      count(*) FILTER (WHERE verified AND composed)::text                       AS composed_first,
      count(*) FILTER (WHERE verified AND composed AND voted)::text             AS voted_first,
      count(*) FILTER (WHERE verified AND composed AND voted AND verdict_opened)::text AS verdict_opened,
      count(*) FILTER (WHERE decision_count >= 2)::text                         AS second_decision
    FROM user_states
  `);
  const f = funnelRows[0] as Record<string, string>;
  const funnel = {
    nodes: [
      { id: 'signed_up',       label: 'Signed up' },
      { id: 'email_verified',  label: 'Verified email' },
      { id: 'composed_first',  label: 'Composed first decision' },
      { id: 'voted_first',     label: 'Cast first vote' },
      { id: 'verdict_opened',  label: 'Verdict opened' },
      { id: 'second_decision', label: 'Second decision' },
    ],
    counts: {
      signed_up:       Number(f.signed_up),
      email_verified:  Number(f.email_verified),
      composed_first:  Number(f.composed_first),
      voted_first:     Number(f.voted_first),
      verdict_opened:  Number(f.verdict_opened),
      second_decision: Number(f.second_decision),
    },
  };

  // ---- VOTE-TIME HEATMAP ----
  // 7 days × 24 hours. Postgres `extract(dow ...)` returns 0=Sunday,
  // we offset to 0=Monday so the rendered grid reads Mon -> Sun.
  // We use sealed_at (UTC) for the timestamp, not vote_date, because
  // we want the hour-of-day signal that vote_date can't carry.
  type HeatRow = { dow: string; hour: string; n: string };
  const heatRows = await db.execute<HeatRow>(sql`
    SELECT
      (EXTRACT(DOW FROM sealed_at)::int + 6) % 7 AS dow,   -- 0=Mon ... 6=Sun
      EXTRACT(HOUR FROM sealed_at)::int          AS hour,
      count(*)::text                              AS n
    FROM votes
    WHERE sealed_at > NOW() - INTERVAL '90 days'
    GROUP BY 1, 2
    ORDER BY 1, 2
  `);
  // Build a dense 7 x 24 matrix · zero-fill missing buckets.
  const heatmap: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  let heatmapMax = 0;
  for (const r of (Array.from(heatRows) as HeatRow[])) {
    const d = Number(r.dow);
    const h = Number(r.hour);
    const n = Number(r.n);
    if (d >= 0 && d < 7 && h >= 0 && h < 24) {
      heatmap[d][h] = n;
      if (n > heatmapMax) heatmapMax = n;
    }
  }

  // ---- COHORT RETENTION ----
  // Cohort = signup month. For each cohort + each subsequent month
  // (0 = signup month itself, 1 = next month, ...), count users from
  // that cohort who cast at least one vote in that month.
  // Capped at 12 months back so the matrix stays readable.
  type CohortRow = { cohort_month: string; months_since: string; users: string };
  const cohortRows = await db.execute<CohortRow>(sql`
    WITH cohort AS (
      SELECT
        u.id,
        date_trunc('month', u.created_at)::date AS cohort_month
      FROM users u
      WHERE u.created_at > NOW() - INTERVAL '12 months'
        AND u.deleted_at IS NULL
    ),
    vote_months AS (
      SELECT DISTINCT
        p.user_id,
        date_trunc('month', v.sealed_at)::date AS active_month
      FROM votes v
      JOIN participants p ON p.id = v.participant_id
      WHERE v.sealed_at > NOW() - INTERVAL '12 months'
        AND p.user_id IS NOT NULL
    )
    SELECT
      c.cohort_month::text                                       AS cohort_month,
      (EXTRACT(YEAR FROM age(vm.active_month, c.cohort_month)) * 12
        + EXTRACT(MONTH FROM age(vm.active_month, c.cohort_month)))::int::text
                                                                  AS months_since,
      count(DISTINCT c.id)::text                                  AS users
    FROM cohort c
    JOIN vote_months vm ON vm.user_id = c.id
    WHERE vm.active_month >= c.cohort_month
    GROUP BY 1, 2
    ORDER BY 1, 2
  `);
  // Also pull cohort sizes so the dashboard can show "X retained of Y signed up"
  type CohortSizeRow = { cohort_month: string; size: string };
  const cohortSizes = await db.execute<CohortSizeRow>(sql`
    SELECT date_trunc('month', created_at)::date::text AS cohort_month, count(*)::text AS size
    FROM users
    WHERE created_at > NOW() - INTERVAL '12 months' AND deleted_at IS NULL
    GROUP BY 1 ORDER BY 1
  `);
  const cohort = {
    sizes: (Array.from(cohortSizes) as CohortSizeRow[]).map((r) => ({
      cohort_month: r.cohort_month,
      size: Number(r.size),
    })),
    activity: (Array.from(cohortRows) as CohortRow[]).map((r) => ({
      cohort_month: r.cohort_month,
      months_since: Number(r.months_since),
      users: Number(r.users),
    })),
  };

  return NextResponse.json(
    {
      ok: true,
      funnel,
      vote_heatmap: { matrix: heatmap, max: heatmapMax },
      cohort,
      generated_at: new Date().toISOString(),
    },
    { status: 200, headers: { 'cache-control': 'private, no-store' } }
  );
}
