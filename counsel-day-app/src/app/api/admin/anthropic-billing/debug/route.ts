/**
 * GET /api/admin/anthropic-billing/debug
 *
 * Returns the RAW Anthropic Admin API responses for cost_report and
 * credit_balance so we can see the exact shape and fix the parser in
 * lib/anthropic-billing.ts. Admin-gated. Do not link from the UI ·
 * this is a one-shot diagnostic.
 *
 * Drop this route once the live billing card is rendering correctly.
 */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ADMIN_BASE = 'https://api.anthropic.com';

async function fetchRaw(path: string, params?: Record<string, string>): Promise<{ status: number; body: unknown }> {
  const key = process.env.ANTHROPIC_ADMIN_API_KEY;
  if (!key) return { status: 0, body: 'ANTHROPIC_ADMIN_API_KEY not set in env.local' };
  const url = new URL(ADMIN_BASE + path);
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  try {
    const res = await fetch(url.toString(), {
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
    });
    const text = await res.text();
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* keep as text */ }
    return { status: res.status, body };
  } catch (err) {
    return { status: -1, body: String(err) };
  }
}

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  // Known + speculative Admin API endpoints. We're hunting for whichever
  // one returns the "current spent / monthly limit" pair that the
  // platform.claude.com console renders · cost_report + usage_report
  // both lag and don't expose the spend-limit total.
  const probe = (path: string) => fetchRaw(path);
  const probeWith = (path: string, params: Record<string, string>) => fetchRaw(path, params);

  const [
    costAllTime,
    costRecent,
    balance,
    usage,
    // Speculative endpoints · listed alphabetically. Most will 404; we
    // want to see WHICH return 200 and what shape they have.
    apiKeys,
    billing,
    billingPeriod,
    currentBillingPeriod,
    me,
    organization,
    spendLimits,
    usageRoot,
    usageSummary,
    workspaces,
  ] = await Promise.all([
    probeWith('/v1/organizations/cost_report', {
      starting_at: '2024-01-01T00:00:00Z',
      bucket_width: '1d',
      limit: '5',
    }),
    probeWith('/v1/organizations/cost_report', {
      starting_at: '2026-05-15T00:00:00Z',
      bucket_width: '1d',
      limit: '10',
    }),
    probe('/v1/organizations/credit_balance'),
    probeWith('/v1/organizations/usage_report/messages', {
      starting_at: '2026-05-15T00:00:00Z',
      bucket_width: '1d',
      limit: '10',
    }),
    probe('/v1/organizations/api_keys'),
    probe('/v1/organizations/billing'),
    probe('/v1/organizations/billing_period'),
    probe('/v1/organizations/current_billing_period'),
    probe('/v1/organizations/me'),
    probe('/v1/organizations'),
    probe('/v1/organizations/spend_limits'),
    probe('/v1/organizations/usage_report'),
    probe('/v1/organizations/usage_summary'),
    probe('/v1/organizations/workspaces'),
  ]);

  return NextResponse.json(
    {
      ok: true,
      hint: 'Look for any path that returned status 200 (other than cost_report / usage_report which we already use). Those are candidates for surfacing the real-time spent / spend-limit pair the console shows.',
      key_configured: !!process.env.ANTHROPIC_ADMIN_API_KEY,
      known: {
        cost_all_time: costAllTime,
        cost_recent: costRecent,
        credit_balance: balance,
        usage_recent: usage,
      },
      probes: {
        api_keys: apiKeys,
        billing,
        billing_period: billingPeriod,
        current_billing_period: currentBillingPeriod,
        me,
        organization,
        spend_limits: spendLimits,
        usage_root: usageRoot,
        usage_summary: usageSummary,
        workspaces,
      },
    },
    { status: 200, headers: { 'cache-control': 'private, no-store' } }
  );
}
