/**
 * GET /api/admin/crm
 *
 * The customer-relationship view backing /admin-crm.html. Returns top-
 * line counts, MRR/LTV/ARPU, active-user windows, the activation funnel,
 * hot leads scored by 14-day engagement, monthly retention cohorts,
 * product + acquisition segments.
 *
 * Admin-only. All counts derived live · no caching layer because the
 * volumes pre-launch are tiny and the dashboard is for the operator
 * (us), not high-traffic. Once we have 10k+ users the per-cohort
 * retention scan will need a materialised view.
 *
 * Acquisition channels (direct/practitioner/social/unknown) come back
 * as zeros until a `users.acquisition_source` column is added · the UI
 * already handles nulls.
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/admin-auth';
import { sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const JOURNAL_PRICE_USD = 4.99;

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  // ---------------------------------------------------------------
  // CONTACTS · all signed-up users that aren't soft-deleted.
  // PAYING · has either a paid decision OR an active journal sub.
  // ---------------------------------------------------------------
  const contactsRow = await db.execute(sql<{ total: number; paying: number }>`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (
        WHERE EXISTS (SELECT 1 FROM decisions d WHERE d.owner_user_id = u.id AND d.amount_paid_cents > 0)
           OR EXISTS (SELECT 1 FROM daily_subscriptions s WHERE s.user_id = u.id AND s.status = 'active' AND s.current_period_end > NOW())
      )::int AS paying
    FROM users u
    WHERE u.deleted_at IS NULL
  `);
  const contacts = (contactsRow[0] as { total: number; paying: number }) ?? { total: 0, paying: 0 };

  // ---------------------------------------------------------------
  // ACTIVE USERS · sessions.last_active_at within 24h/7d/30d windows.
  // ---------------------------------------------------------------
  const activeRow = await db.execute(sql<{ dau: number; wau: number; mau: number }>`
    SELECT
      COUNT(DISTINCT user_id) FILTER (WHERE last_active_at > NOW() - INTERVAL '1 day')::int   AS dau,
      COUNT(DISTINCT user_id) FILTER (WHERE last_active_at > NOW() - INTERVAL '7 days')::int  AS wau,
      COUNT(DISTINCT user_id) FILTER (WHERE last_active_at > NOW() - INTERVAL '30 days')::int AS mau
    FROM sessions
  `);
  const active = (activeRow[0] as { dau: number; wau: number; mau: number }) ?? { dau: 0, wau: 0, mau: 0 };

  // ---------------------------------------------------------------
  // SIGNUPS · users.created_at by window.
  // ---------------------------------------------------------------
  const signupsRow = await db.execute(sql<{ day: number; week: number; month: number }>`
    SELECT
      COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 day')::int   AS day,
      COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::int  AS week,
      COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days')::int AS month
    FROM users
    WHERE deleted_at IS NULL
  `);
  const signups = (signupsRow[0] as { day: number; week: number; month: number }) ?? { day: 0, week: 0, month: 0 };

  // ---------------------------------------------------------------
  // ACTIVATION FUNNEL · last 30 days · counts at each stage.
  // ---------------------------------------------------------------
  const funnelRow = await db.execute(sql<{
    signed_up: number;
    email_verified: number;
    composed: number;
    voted: number;
    verdict_opened: number;
    paid: number;
  }>`
    WITH u AS (
      SELECT id, created_at, email_verified_at FROM users
      WHERE deleted_at IS NULL AND created_at > NOW() - INTERVAL '30 days'
    )
    SELECT
      COUNT(*)::int AS signed_up,
      COUNT(*) FILTER (WHERE email_verified_at IS NOT NULL)::int AS email_verified,
      COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM decisions d WHERE d.owner_user_id = u.id))::int AS composed,
      COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM votes v JOIN participants p ON p.id = v.participant_id WHERE p.user_id = u.id))::int AS voted,
      COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM verdicts vd JOIN decisions d ON d.id = vd.decision_id WHERE d.owner_user_id = u.id))::int AS verdict_opened,
      COUNT(*) FILTER (
        WHERE EXISTS (SELECT 1 FROM decisions d WHERE d.owner_user_id = u.id AND d.amount_paid_cents > 0)
           OR EXISTS (SELECT 1 FROM daily_subscriptions s WHERE s.user_id = u.id AND s.status = 'active')
      )::int AS paid
    FROM u
  `);
  const fr = (funnelRow[0] as {
    signed_up: number; email_verified: number; composed: number;
    voted: number; verdict_opened: number; paid: number;
  }) ?? { signed_up: 0, email_verified: 0, composed: 0, voted: 0, verdict_opened: 0, paid: 0 };
  const top = fr.signed_up || 1;
  const stages = [
    { key: 'signed_up',      label: '01 · Signed up',            count: fr.signed_up },
    { key: 'email_verified', label: '02 · Email verified',       count: fr.email_verified },
    { key: 'composed',       label: '03 · Composed a decision',  count: fr.composed },
    { key: 'voted',          label: '04 · Voted at least once',  count: fr.voted },
    { key: 'verdict_opened', label: '05 · Verdict opened',       count: fr.verdict_opened },
    { key: 'paid',           label: '06 · Paid for something',   count: fr.paid },
  ];
  const funnel = stages.map((s, i) => {
    const from_top_pct = top > 0 ? (s.count / top) * 100 : null;
    const drop_pct = i === 0 || stages[i - 1].count === 0
      ? null
      : ((stages[i - 1].count - s.count) / stages[i - 1].count) * 100;
    return { label: s.label, count: s.count, from_top_pct, drop_pct };
  });

  // ---------------------------------------------------------------
  // HOT LEADS · users who signed up in the last 30 days but have NOT
  // paid yet, scored by engagement signals in the last 14 days:
  //   journal entries × 1
  //   composed decisions × 3
  //   audit events × 0.25 (rough proxy for activity)
  // Hot ≥ 8, Warm 4-7, Cold < 4. Show top 20 by score.
  // ---------------------------------------------------------------
  const leadsRows = await db.execute<{
    email: string;
    signed_up_at: string;
    last_seen_at: string | null;
    entries: number;
    decisions: number;
    audit: number;
  }>(sql`
    WITH u AS (
      SELECT id, email, created_at FROM users
      WHERE deleted_at IS NULL
        AND created_at > NOW() - INTERVAL '30 days'
        AND NOT EXISTS (SELECT 1 FROM decisions d WHERE d.owner_user_id = users.id AND d.amount_paid_cents > 0)
        AND NOT EXISTS (SELECT 1 FROM daily_subscriptions s WHERE s.user_id = users.id AND s.status = 'active')
    )
    SELECT
      u.email,
      u.created_at AS signed_up_at,
      (SELECT MAX(last_active_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen_at,
      (SELECT COUNT(*) FROM journal_entries je WHERE je.user_id = u.id AND je.created_at > NOW() - INTERVAL '14 days')::int AS entries,
      (SELECT COUNT(*) FROM decisions d WHERE d.owner_user_id = u.id AND d.created_at > NOW() - INTERVAL '14 days')::int AS decisions,
      (SELECT COUNT(*) FROM audit_log a WHERE a.actor_user_id = u.id AND a.created_at > NOW() - INTERVAL '14 days')::int AS audit
    FROM u
    ORDER BY u.created_at DESC
    LIMIT 100
  `);
  type LeadRow = { email: string; signed_up_at: string; last_seen_at: string | null; entries: number; decisions: number; audit: number };
  const hot_leads = (leadsRows as unknown as LeadRow[])
    .map((r) => {
      const score = (r.entries * 1) + (r.decisions * 3) + (r.audit * 0.25);
      const bits = [
        r.entries > 0  ? `${r.entries}e` : '',
        r.decisions > 0 ? `${r.decisions}d` : '',
        r.audit > 0    ? `${r.audit}a` : '',
      ].filter(Boolean).join(' ');
      return {
        email: r.email,
        signed_up_at: r.signed_up_at,
        last_seen_at: r.last_seen_at,
        activity: bits || '·',
        score: Math.round(score * 10) / 10,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);

  // ---------------------------------------------------------------
  // COHORTS · monthly. For each signup-month cohort, what % of users
  // were active (had a session) in each subsequent month. Last 6 months.
  // ---------------------------------------------------------------
  const cohortsRow = await db.execute<{
    cohort_month: string;
    size: number;
    retention_json: string;
  }>(sql`
    WITH cohorts AS (
      SELECT
        to_char(date_trunc('month', created_at), 'YYYY-MM') AS cohort_month,
        id AS user_id,
        date_trunc('month', created_at) AS cohort_start
      FROM users
      WHERE deleted_at IS NULL
        AND created_at > NOW() - INTERVAL '6 months'
    ),
    monthly_active AS (
      SELECT DISTINCT user_id, date_trunc('month', last_active_at) AS active_month
      FROM sessions
      WHERE last_active_at > NOW() - INTERVAL '6 months'
    ),
    grid AS (
      SELECT
        c.cohort_month,
        c.cohort_start,
        c.user_id,
        generate_series(0, 5) AS month_offset
      FROM cohorts c
    ),
    retention AS (
      SELECT
        g.cohort_month,
        g.cohort_start,
        g.month_offset,
        COUNT(DISTINCT g.user_id) AS cohort_size,
        COUNT(DISTINCT g.user_id) FILTER (
          WHERE EXISTS (SELECT 1 FROM monthly_active m WHERE m.user_id = g.user_id AND m.active_month = g.cohort_start + (g.month_offset || ' months')::INTERVAL)
        ) AS active_count
      FROM grid g
      GROUP BY g.cohort_month, g.cohort_start, g.month_offset
    )
    SELECT
      cohort_month,
      MAX(cohort_size)::int AS size,
      json_agg(
        CASE WHEN cohort_size > 0 THEN ROUND(active_count::numeric / cohort_size * 100, 1) ELSE NULL END
        ORDER BY month_offset
      )::text AS retention_json
    FROM retention
    GROUP BY cohort_month, cohort_start
    ORDER BY cohort_month DESC
  `);
  type CohortRow = { cohort_month: string; size: number; retention_json: string };
  const cohorts = (cohortsRow as unknown as CohortRow[]).map((r) => ({
    cohort_month: r.cohort_month,
    size: r.size,
    retention_pct_by_month: (() => { try { return JSON.parse(r.retention_json); } catch { return []; } })(),
  }));

  // ---------------------------------------------------------------
  // CHURN · 30-day window.
  //   logo churn = subs cancelled in 30d / active subs 30 days ago
  //   revenue churn = cancelled MRR / active MRR
  // ---------------------------------------------------------------
  const churnRow = await db.execute<{ active_now: number; cancelled_30d: number; active_30d_ago: number }>(sql`
    SELECT
      COUNT(*) FILTER (WHERE status = 'active' AND (current_period_end IS NULL OR current_period_end > NOW()))::int AS active_now,
      COUNT(*) FILTER (WHERE canceled_at IS NOT NULL AND canceled_at > NOW() - INTERVAL '30 days')::int AS cancelled_30d,
      COUNT(*) FILTER (WHERE started_at IS NOT NULL AND started_at < NOW() - INTERVAL '30 days' AND (canceled_at IS NULL OR canceled_at > NOW() - INTERVAL '30 days'))::int AS active_30d_ago
    FROM daily_subscriptions
  `);
  const ch = (churnRow[0] as { active_now: number; cancelled_30d: number; active_30d_ago: number }) ?? { active_now: 0, cancelled_30d: 0, active_30d_ago: 0 };
  const logo_pct    = ch.active_30d_ago > 0 ? (ch.cancelled_30d / ch.active_30d_ago) * 100 : 0;
  const revenue_pct = logo_pct;  // identical at single-price-point until tiers diverge

  // ---------------------------------------------------------------
  // REVENUE · MRR, ARPU, LTV 90d, free-to-paid conversion.
  // ---------------------------------------------------------------
  const mrr_usd = ch.active_now * JOURNAL_PRICE_USD;

  const revenueRow = await db.execute<{ total_decision_cents: number; total_paying: number; revenue_90d_cents: number }>(sql`
    SELECT
      COALESCE(SUM(amount_paid_cents), 0)::bigint AS total_decision_cents,
      (SELECT COUNT(DISTINCT owner_user_id) FROM decisions WHERE amount_paid_cents > 0)::int AS total_paying,
      COALESCE(SUM(amount_paid_cents) FILTER (WHERE paid_at > NOW() - INTERVAL '90 days'), 0)::bigint AS revenue_90d_cents
    FROM decisions
  `);
  const rev = (revenueRow[0] as { total_decision_cents: number; total_paying: number; revenue_90d_cents: number }) ?? { total_decision_cents: 0, total_paying: 0, revenue_90d_cents: 0 };
  const total_paying_contacts = Math.max(contacts.paying, 1);
  const arpu_usd = (Number(rev.total_decision_cents) / 100 + ch.active_now * JOURNAL_PRICE_USD) / total_paying_contacts;
  const ltv_90d_usd = (Number(rev.revenue_90d_cents) / 100 + ch.active_now * JOURNAL_PRICE_USD * 3) / total_paying_contacts;
  const free_to_paid_pct = contacts.total > 0 ? (contacts.paying / contacts.total) * 100 : 0;

  // ---------------------------------------------------------------
  // SEGMENTS · by product engagement.
  // ---------------------------------------------------------------
  const segRow = await db.execute<{ decision_only: number; journal_only: number; both: number; inactive_60d: number }>(sql`
    WITH u AS (
      SELECT
        id,
        EXISTS (SELECT 1 FROM decisions d WHERE d.owner_user_id = users.id) AS has_dec,
        EXISTS (SELECT 1 FROM journal_entries je WHERE je.user_id = users.id) AS has_jou,
        (SELECT MAX(last_active_at) FROM sessions s WHERE s.user_id = users.id) AS last_seen
      FROM users
      WHERE deleted_at IS NULL
    )
    SELECT
      COUNT(*) FILTER (WHERE has_dec AND NOT has_jou)::int AS decision_only,
      COUNT(*) FILTER (WHERE has_jou AND NOT has_dec)::int AS journal_only,
      COUNT(*) FILTER (WHERE has_dec AND has_jou)::int AS both,
      COUNT(*) FILTER (WHERE last_seen IS NULL OR last_seen < NOW() - INTERVAL '60 days')::int AS inactive_60d
    FROM u
  `);
  const segments = (segRow[0] as { decision_only: number; journal_only: number; both: number; inactive_60d: number }) ?? { decision_only: 0, journal_only: 0, both: 0, inactive_60d: 0 };

  // ---------------------------------------------------------------
  // ACQUISITION · stubbed at 0 until users.acquisition_source ships.
  // ---------------------------------------------------------------
  const acquisition = { direct: 0, practitioner: 0, social: 0, unknown: contacts.total };

  return NextResponse.json({
    ok: true,
    generated_at: new Date().toISOString(),
    contacts: { total: contacts.total, paying: contacts.paying },
    active: { dau: active.dau, wau: active.wau, mau: active.mau },
    signups: { day: signups.day, week: signups.week, month: signups.month },
    funnel,
    hot_leads,
    cohorts,
    churn: { logo_pct, revenue_pct },
    revenue: {
      mrr_usd,
      ltv_90d_usd,
      arpu_usd,
      free_to_paid_pct,
    },
    segments,
    acquisition,
  });
}
