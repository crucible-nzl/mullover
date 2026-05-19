/**
 * GET /api/admin/finance
 *
 * Financial dashboard data:
 *   · revenue_daily   [{ date, gross_cents, count }] last 90 days · from decisions table
 *   · revenue_by_tier { solo_paid, couple, family, consumer_annual } · cumulative
 *   · ai_cost_daily   [{ date, cost_cents, verdicts }] last 90 days · from verdicts table
 *   · refunds         { requested_30d, processed_30d, ratio_pct }
 *   · margin          { revenue_cents, ai_cost_cents, net_cents, margin_pct }
 *
 * Source-of-truth note: decisions.amount_paid_cents lands the *gross*
 * paid amount at compose time (the Stripe webhook writes it). For a
 * production ledger you would reconcile against Stripe Balance every
 * day; for the dashboard we trust the webhook log.
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
    try { return await fn(); } catch (e) { console.warn('[admin/finance] subquery failed:', e); return fallback; }
  }

  const revenueDaily = await safe(async () => {
    const rows = await db.execute<{ d: string; gross: string; count: string }>(sql`
      SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS d,
             COALESCE(SUM(amount_paid_cents), 0)::text AS gross,
             count(*)::text AS count
      FROM decisions
      WHERE created_at > NOW() - INTERVAL '90 days'
        AND amount_paid_cents > 0
      GROUP BY 1
      ORDER BY 1
    `);
    return Array.from(rows).map((r) => ({ date: r.d, gross_cents: Number(r.gross), count: Number(r.count) }));
  }, []);

  const revenueByTier = await safe(async () => {
    const rows = await db.execute<{ tier: string; gross: string; count: string }>(sql`
      SELECT tier, COALESCE(SUM(amount_paid_cents), 0)::text AS gross, count(*)::text AS count
      FROM decisions
      WHERE amount_paid_cents > 0
      GROUP BY tier
    `);
    const out: Record<string, { gross_cents: number; count: number }> = {};
    for (const r of Array.from(rows) as Array<{ tier: string; gross: string; count: string }>) {
      out[r.tier] = { gross_cents: Number(r.gross), count: Number(r.count) };
    }
    return out;
  }, {});

  const aiCostDaily = await safe(async () => {
    const rows = await db.execute<{ d: string; cost: string; verdicts: string }>(sql`
      SELECT to_char(date_trunc('day', generated_at), 'YYYY-MM-DD') AS d,
             COALESCE(SUM(cost_cents), 0)::text AS cost,
             count(*)::text AS verdicts
      FROM verdicts
      WHERE generated_at > NOW() - INTERVAL '90 days'
      GROUP BY 1
      ORDER BY 1
    `);
    return Array.from(rows).map((r) => ({ date: r.d, cost_cents: Number(r.cost), verdicts: Number(r.verdicts) }));
  }, []);

  const refunds = await safe(async () => {
    const rows = await db.execute<{ requested: string; processed: string }>(sql`
      SELECT
        (SELECT count(*)::text FROM audit_log WHERE action = 'refund.requested' AND created_at > NOW() - INTERVAL '30 days') AS requested,
        (SELECT count(*)::text FROM audit_log WHERE action = 'refund.processed' AND created_at > NOW() - INTERVAL '30 days') AS processed
    `);
    const r = rows[0] as { requested: string; processed: string };
    const requested = Number(r.requested);
    const processed = Number(r.processed);
    return { requested_30d: requested, processed_30d: processed, ratio_pct: requested === 0 ? 0 : +(processed * 100 / requested).toFixed(2) };
  }, { requested_30d: 0, processed_30d: 0, ratio_pct: 0 });

  const margin = await safe(async () => {
    const rows = await db.execute<{ revenue: string; cost: string }>(sql`
      SELECT
        (SELECT COALESCE(SUM(amount_paid_cents), 0)::text FROM decisions) AS revenue,
        (SELECT COALESCE(SUM(cost_cents), 0)::text FROM verdicts) AS cost
    `);
    const r = rows[0] as { revenue: string; cost: string };
    const revenue = Number(r.revenue);
    const cost = Number(r.cost);
    const net = revenue - cost;
    return { revenue_cents: revenue, ai_cost_cents: cost, net_cents: net, margin_pct: revenue === 0 ? 0 : +(net * 100 / revenue).toFixed(2) };
  }, { revenue_cents: 0, ai_cost_cents: 0, net_cents: 0, margin_pct: 0 });

  return NextResponse.json(
    { ok: true, generated_at: new Date().toISOString(), revenue_daily: revenueDaily, revenue_by_tier: revenueByTier, ai_cost_daily: aiCostDaily, refunds, margin },
    { headers: { 'cache-control': 'private, no-store' } }
  );
}
