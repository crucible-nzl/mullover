/**
 * GET /api/admin/traffic
 *
 * Proxies the GA4 Data API so the admin dashboard can show live
 * traffic without exposing the service-account credentials to the
 * browser.
 *
 * Setup (one-time):
 *   1. In Google Cloud Console create a Service Account.
 *   2. In GA4 Admin → Property Access Management, add the service
 *      account email with "Viewer" role on property G-SX20BZZP59.
 *   3. Download the JSON key, paste the whole thing into
 *      /etc/counsel-day-app/env.local as GA4_SERVICE_ACCOUNT_JSON.
 *      Also set GA4_PROPERTY_ID=<numeric property id from GA4>.
 *   4. `npm install @google-analytics/data` and restart the service.
 *
 * Without those env vars set, the endpoint returns a "not configured"
 * payload so the admin page can render setup instructions instead of
 * crashing.
 *
 * Admin gate via requireAdmin().
 */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Series = Array<{ date: string; sessions: number; users: number }>;

async function fetchGA4(): Promise<{
  ok: boolean;
  reason?: 'not_configured' | 'fetch_failed';
  daily?: Series;
  top_pages?: Array<{ path: string; views: number }>;
  top_sources?: Array<{ source: string; sessions: number }>;
  totals?: { sessions: number; users: number; pageviews: number };
}> {
  const sa = process.env.GA4_SERVICE_ACCOUNT_JSON;
  const prop = process.env.GA4_PROPERTY_ID;
  if (!sa || !prop) return { ok: false, reason: 'not_configured' };

  try {
    const ga4 = await import('@google-analytics/data').catch(() => null);
    if (!ga4) return { ok: false, reason: 'not_configured' };
    const credentials = JSON.parse(sa);
    const client = new ga4.BetaAnalyticsDataClient({ credentials });

    const property = `properties/${prop}`;

    const [dailyResp] = await client.runReport({
      property,
      dimensions: [{ name: 'date' }],
      metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
      dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
      orderBys: [{ dimension: { dimensionName: 'date' } }],
    });
    const daily: Series = (dailyResp.rows ?? []).map((r) => ({
      date: r.dimensionValues?.[0]?.value ?? '',
      sessions: Number(r.metricValues?.[0]?.value ?? 0),
      users: Number(r.metricValues?.[1]?.value ?? 0),
    }));

    const [pagesResp] = await client.runReport({
      property,
      dimensions: [{ name: 'pagePath' }],
      metrics: [{ name: 'screenPageViews' }],
      dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
      orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
      limit: 20,
    });
    const topPages = (pagesResp.rows ?? []).map((r) => ({
      path: r.dimensionValues?.[0]?.value ?? '',
      views: Number(r.metricValues?.[0]?.value ?? 0),
    }));

    const [sourcesResp] = await client.runReport({
      property,
      dimensions: [{ name: 'sessionDefaultChannelGroup' }],
      metrics: [{ name: 'sessions' }],
      dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 10,
    });
    const topSources = (sourcesResp.rows ?? []).map((r) => ({
      source: r.dimensionValues?.[0]?.value ?? '(unknown)',
      sessions: Number(r.metricValues?.[0]?.value ?? 0),
    }));

    const [totalsResp] = await client.runReport({
      property,
      metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'screenPageViews' }],
      dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
    });
    const totalRow = totalsResp.rows?.[0];
    const totals = {
      sessions: Number(totalRow?.metricValues?.[0]?.value ?? 0),
      users: Number(totalRow?.metricValues?.[1]?.value ?? 0),
      pageviews: Number(totalRow?.metricValues?.[2]?.value ?? 0),
    };

    return { ok: true, daily, top_pages: topPages, top_sources: topSources, totals };
  } catch (err) {
    console.warn('[admin/traffic] GA4 fetch failed:', err);
    return { ok: false, reason: 'fetch_failed' };
  }
}

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const data = await fetchGA4();
  return NextResponse.json(
    { ok: true, generated_at: new Date().toISOString(), ga4: data },
    { headers: { 'cache-control': 'private, no-store' } }
  );
}
