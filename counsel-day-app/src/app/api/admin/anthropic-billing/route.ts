/**
 * GET /api/admin/anthropic-billing
 *
 * Standalone endpoint for the Anthropic Admin-API cost figures
 * (cost_report settled + usage_report realtime). Split out of the
 * main /api/admin/overview because the paginated Admin-API call can
 * take 10-20 seconds on a cold 5-minute-cache miss, and we don't want
 * that blocking the rest of the dashboard.
 *
 * Response shape matches the prior overview field:
 *   { ok, configured: bool, cost: CostReport | null }
 *
 * The dashboard fetches /api/admin/overview and this endpoint in
 * parallel · the headline numbers paint immediately, the billing
 * card hydrates as soon as the API replies.
 */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getAnthropicCost } from '@/lib/anthropic-billing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  try {
    const cost = await getAnthropicCost();
    return NextResponse.json(
      { ok: true, configured: cost !== null, cost },
      { status: 200, headers: { 'cache-control': 'private, no-store' } },
    );
  } catch (e) {
    console.warn('[admin/anthropic-billing] fetch failed', e);
    return NextResponse.json(
      { ok: true, configured: false, cost: null, error: 'fetch_failed' },
      { status: 200, headers: { 'cache-control': 'private, no-store' } },
    );
  }
}
