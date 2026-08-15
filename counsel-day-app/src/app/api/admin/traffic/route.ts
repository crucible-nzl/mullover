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
import { and, gte, ne, sql } from 'drizzle-orm';
import { requireAdmin } from '@/lib/admin-auth';
import { db, schema } from '@/lib/db';

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

/**
 * First-party traffic, straight from page_hits (migration 0039).
 *
 * This is the number to trust. GA4 only ever sees visitors who accepted the
 * cookie banner AND are not running an ad blocker, which on this audience is a
 * small minority: the first Facebook post produced 48 short-link clicks and 9
 * GA4 users. page_hits is same-origin and identifier-free, so it counts
 * everyone. Bots are recorded but reported separately rather than silently
 * inflating the totals.
 */
async function fetchFirstParty(days: number) {
  const since = new Date(Date.now() - days * 86400_000);

  const [daily, topPages, referrers, countries] = await Promise.all([
    db
      .select({
        day: sql<string>`to_char(date_trunc('day', ${schema.pageHits.createdAt}), 'YYYY-MM-DD')`,
        views: sql<number>`count(*)::int`,
        visitors: sql<number>`count(distinct ${schema.pageHits.visitorHash})::int`,
      })
      .from(schema.pageHits)
      .where(and(gte(schema.pageHits.createdAt, since), ne(schema.pageHits.device, 'bot')))
      .groupBy(sql`1`)
      .orderBy(sql`1 desc`),
    db
      .select({
        path: schema.pageHits.path,
        views: sql<number>`count(*)::int`,
        visitors: sql<number>`count(distinct ${schema.pageHits.visitorHash})::int`,
      })
      .from(schema.pageHits)
      .where(and(gte(schema.pageHits.createdAt, since), ne(schema.pageHits.device, 'bot')))
      .groupBy(schema.pageHits.path)
      .orderBy(sql`2 desc`)
      .limit(25),
    db
      .select({
        host: schema.pageHits.referrerHost,
        views: sql<number>`count(*)::int`,
      })
      .from(schema.pageHits)
      .where(and(gte(schema.pageHits.createdAt, since), ne(schema.pageHits.device, 'bot')))
      .groupBy(schema.pageHits.referrerHost)
      .orderBy(sql`2 desc`)
      .limit(15),
    db
      .select({
        country: schema.pageHits.country,
        views: sql<number>`count(*)::int`,
      })
      .from(schema.pageHits)
      .where(and(gte(schema.pageHits.createdAt, since), ne(schema.pageHits.device, 'bot')))
      .groupBy(schema.pageHits.country)
      .orderBy(sql`2 desc`)
      .limit(15),
  ]);

  const [totals] = await db
    .select({
      views: sql<number>`count(*) filter (where ${schema.pageHits.device} <> 'bot')::int`,
      visitors: sql<number>`count(distinct ${schema.pageHits.visitorHash}) filter (where ${schema.pageHits.device} <> 'bot')::int`,
      bot_views: sql<number>`count(*) filter (where ${schema.pageHits.device} = 'bot')::int`,
    })
    .from(schema.pageHits)
    .where(gte(schema.pageHits.createdAt, since));

  return {
    window_days: days,
    totals: totals ?? { views: 0, visitors: 0, bot_views: 0 },
    daily,
    top_pages: topPages,
    referrers,
    countries,
    note: 'Cookieless first-party counts. Visitors are per-day uniques; the digest rotates daily, so the same person on two days counts twice. Bots excluded from every figure except bot_views.',
  };
}

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const url = new URL(req.url);
  const days = Math.min(Math.max(Number(url.searchParams.get('days') ?? 30) || 30, 1), 365);

  const [ga4, firstParty] = await Promise.all([
    fetchGA4(),
    fetchFirstParty(days).catch((err) => {
      console.warn('[admin/traffic] first-party query failed:', err);
      return null;
    }),
  ]);

  return NextResponse.json(
    { ok: true, generated_at: new Date().toISOString(), first_party: firstParty, ga4 },
    { headers: { 'cache-control': 'private, no-store' } }
  );
}
