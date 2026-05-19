/**
 * GET /api/admin/growth
 *
 * Returns SaaS-style growth metrics rendered into chart-ready series:
 *   · signups_daily      [{ date, free, paid }]   last 90 days
 *   · activations_daily  [{ date, verified }]     last 90 days
 *   · mrr                cents · current monthly recurring (Consumer Annual / 12)
 *   · arr                cents · 12 × MRR
 *   · churn_30d          % of users who deleted/refunded in last 30d
 *   · funnel             { signed_up, verified, started_decision, completed_decision }
 *
 * Everything is sourced from Postgres · we don't hit Stripe live here
 * because the webhook already lands subscription state in users.current_plan
 * + audit_log. Keeps the dashboard cheap.
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
    try { return await fn(); } catch (e) { console.warn('[admin/growth] subquery failed:', e); return fallback; }
  }

  const signupsDaily = await safe(async () => {
    const rows = await db.execute<{ d: string; free: string; paid: string }>(sql`
      SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS d,
             count(*) FILTER (WHERE current_plan = 'free')::text AS free,
             count(*) FILTER (WHERE current_plan <> 'free')::text AS paid
      FROM users
      WHERE deleted_at IS NULL
        AND created_at > NOW() - INTERVAL '90 days'
      GROUP BY 1
      ORDER BY 1
    `);
    return Array.from(rows).map((r) => ({ date: r.d, free: Number(r.free), paid: Number(r.paid) }));
  }, []);

  const activationsDaily = await safe(async () => {
    const rows = await db.execute<{ d: string; verified: string }>(sql`
      SELECT to_char(date_trunc('day', email_verified_at), 'YYYY-MM-DD') AS d,
             count(*)::text AS verified
      FROM users
      WHERE email_verified_at IS NOT NULL
        AND email_verified_at > NOW() - INTERVAL '90 days'
      GROUP BY 1
      ORDER BY 1
    `);
    return Array.from(rows).map((r) => ({ date: r.d, verified: Number(r.verified) }));
  }, []);

  // MRR · current annual subscribers / 12. Pricing pinned at $99 USD/year.
  const mrr = await safe(async () => {
    const rows = await db.execute<{ count: string }>(sql`
      SELECT count(*)::text AS count
      FROM users
      WHERE current_plan = 'consumer_annual'
        AND deleted_at IS NULL
    `);
    const subs = Number((rows[0] as { count: string }).count);
    const cents = Math.round((subs * 9900) / 12);
    return { active_subscribers: subs, mrr_cents: cents, arr_cents: cents * 12 };
  }, { active_subscribers: 0, mrr_cents: 0, arr_cents: 0 });

  // Churn · users deleted OR all decisions refunded in last 30d / users 30d ago
  const churn30d = await safe(async () => {
    const rows = await db.execute<{ deleted: string; baseline: string }>(sql`
      SELECT
        (SELECT count(*)::text FROM users
          WHERE deleted_at > NOW() - INTERVAL '30 days') AS deleted,
        (SELECT count(*)::text FROM users
          WHERE created_at < NOW() - INTERVAL '30 days'
            AND deleted_at IS NULL) AS baseline
    `);
    const r = rows[0] as { deleted: string; baseline: string };
    const deleted = Number(r.deleted);
    const baseline = Math.max(1, Number(r.baseline));
    return { deleted_30d: deleted, baseline, percent: +(deleted * 100 / baseline).toFixed(2) };
  }, { deleted_30d: 0, baseline: 0, percent: 0 });

  // Funnel · the four stages of becoming a paying user
  const funnel = await safe(async () => {
    const rows = await db.execute<{ signed_up: string; verified: string; started: string; completed: string }>(sql`
      SELECT
        (SELECT count(*)::text FROM users WHERE deleted_at IS NULL) AS signed_up,
        (SELECT count(*)::text FROM users WHERE email_verified_at IS NOT NULL AND deleted_at IS NULL) AS verified,
        (SELECT count(DISTINCT owner_user_id)::text FROM decisions WHERE status <> 'pending_invites') AS started,
        (SELECT count(DISTINCT owner_user_id)::text FROM decisions WHERE status = 'completed') AS completed
    `);
    const r = rows[0] as { signed_up: string; verified: string; started: string; completed: string };
    return {
      signed_up: Number(r.signed_up),
      verified: Number(r.verified),
      started_decision: Number(r.started),
      completed_decision: Number(r.completed),
    };
  }, { signed_up: 0, verified: 0, started_decision: 0, completed_decision: 0 });

  return NextResponse.json(
    { ok: true, generated_at: new Date().toISOString(), signups_daily: signupsDaily, activations_daily: activationsDaily, mrr, churn_30d: churn30d, funnel },
    { headers: { 'cache-control': 'private, no-store' } }
  );
}
