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

  const [costAllTime, costRecent, balance, usage] = await Promise.all([
    fetchRaw('/v1/organizations/cost_report', {
      starting_at: '2024-01-01T00:00:00Z',
      bucket_width: '1d',
      limit: '5',
    }),
    fetchRaw('/v1/organizations/cost_report', {
      starting_at: '2026-05-15T00:00:00Z',
      bucket_width: '1d',
      limit: '10',
    }),
    fetchRaw('/v1/organizations/credit_balance'),
    fetchRaw('/v1/organizations/usage_report/messages', {
      starting_at: '2026-05-15T00:00:00Z',
      bucket_width: '1d',
      limit: '10',
    }),
  ]);

  return NextResponse.json(
    {
      ok: true,
      hint: 'Paste the four raw response bodies back to Claude so the parser in lib/anthropic-billing.ts can be fixed to match Anthropic\'s actual shape.',
      key_configured: !!process.env.ANTHROPIC_ADMIN_API_KEY,
      cost_all_time: costAllTime,
      cost_recent: costRecent,
      credit_balance: balance,
      usage_recent: usage,
    },
    { status: 200, headers: { 'cache-control': 'private, no-store' } }
  );
}
