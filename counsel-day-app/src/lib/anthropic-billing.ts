/**
 * Live Anthropic billing fetch · talks to the Admin API to get the
 * organization's actual spend, both settled and realtime-estimated.
 *
 * Requires an Admin API key in env (separate from the regular
 * ANTHROPIC_API_KEY · format `sk-ant-admin-...`). Get one from
 * console.anthropic.com → Settings → Admin Keys.
 *
 * Two endpoints, two complementary numbers:
 *
 *   /v1/organizations/cost_report
 *     Returns SETTLED daily spend (line items {currency, amount,
 *     model, token_type}). Anthropic takes 2-5 days to settle, so
 *     today's testing-area runs aren't in here yet. Authoritative for
 *     finance / month-end reconciliation.
 *
 *   /v1/organizations/usage_report/messages
 *     Returns REAL-TIME token usage by day (uncached_input_tokens,
 *     cache_read_input_tokens, cache_creation.*, output_tokens, model).
 *     We multiply by per-model pricing from lib/anthropic-pricing.ts
 *     to get a current spend estimate. This matches what the Anthropic
 *     console shows under "$X.XX spent" · the user explicitly asked
 *     for the real number, not the settled one.
 *
 *   /v1/organizations/credit_balance
 *     404s on Counsel.day's account · documented but not available
 *     for all org types. We don't surface a balance card; the operator
 *     checks platform.claude.com/cost manually for that.
 *
 * Cached in-process for 5 minutes so /admin overview's 60-second
 * refresh doesn't burn an Anthropic API call every tick.
 */

import { calculateAnthropicCostCents } from './anthropic-pricing';

const ADMIN_BASE = 'https://api.anthropic.com';
const CACHE_TTL_MS = 5 * 60 * 1000;

export type CostReport = {
  // SETTLED spend from cost_report · lags 2-5 days. Authoritative.
  settled_usd: number;
  // REALTIME-ESTIMATED spend from usage_report × per-model pricing ·
  // matches the Anthropic console's "spent" number. This is the main
  // figure the admin card surfaces.
  realtime_usd: number;
  // Total: realtime_usd is the authoritative "what we've actually
  // spent so far" number. settled is just a confidence check.
  total_usd: number;
  // Currency is always USD on Counsel.day's account but we surface
  // it anyway in case Anthropic ever returns a multi-currency total.
  currency: string;
  // First → last day in the data returned (across both endpoints).
  starting_at: string;
  ending_at: string;
  // Total tokens processed across the org · diagnostic.
  total_input_tokens: number;
  total_output_tokens: number;
  // Pages walked on each endpoint · operator can see when the API is
  // slow to pull a full history.
  cost_pages_walked: number;
  usage_pages_walked: number;
  // Human note for the admin UI.
  note: string;
};

interface CacheEntry<T> { value: T | null; ts: number; }
const costCache: CacheEntry<CostReport> = { value: null, ts: 0 };

function adminKey(): string | null {
  const k = process.env.ANTHROPIC_ADMIN_API_KEY;
  if (!k || !k.trim()) return null;
  return k.trim();
}

async function adminFetch<T = unknown>(path: string, params?: Record<string, string>): Promise<T | null> {
  const key = adminKey();
  if (!key) return null;
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
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn(`[anthropic-billing] ${path} returned ${res.status}: ${text.slice(0, 200)}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.warn(`[anthropic-billing] ${path} failed:`, (err as Error).message);
    return null;
  }
}

// ---- cost_report (settled spend) ----

type CostBucket = {
  starting_at: string;
  ending_at: string;
  results: Array<{
    currency?: string;
    amount?: string;
    model?: string | null;
    token_type?: string | null;
    service_tier?: string | null;
  }>;
};
type CostResponse = {
  data?: CostBucket[];
  has_more?: boolean;
  next_page?: string | null;
};

async function fetchAllCostPages(startingAt: string): Promise<{ buckets: CostBucket[]; pages: number }> {
  const all: CostBucket[] = [];
  let nextPage: string | null = null;
  let pages = 0;
  const PAGE_CAP = 24;
  do {
    const params: Record<string, string> = {
      starting_at: startingAt,
      bucket_width: '1d',
      limit: '31',
    };
    if (nextPage) params.page = nextPage;
    const data = await adminFetch<CostResponse>('/v1/organizations/cost_report', params);
    if (!data || !Array.isArray(data.data)) break;
    all.push(...data.data);
    pages += 1;
    nextPage = data.has_more && data.next_page ? data.next_page : null;
  } while (nextPage && pages < PAGE_CAP);
  return { buckets: all, pages };
}

// ---- usage_report/messages (realtime tokens → cost) ----

type UsageBucket = {
  starting_at: string;
  ending_at: string;
  results: Array<{
    model?: string | null;
    service_tier?: string | null;
    context_window?: string | null;
    uncached_input_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_creation?: {
      ephemeral_5m_input_tokens?: number;
      ephemeral_1h_input_tokens?: number;
    };
    output_tokens?: number;
    server_tool_use?: unknown;
  }>;
};
type UsageResponse = {
  data?: UsageBucket[];
  has_more?: boolean;
  next_page?: string | null;
};

async function fetchAllUsagePages(startingAt: string): Promise<{ buckets: UsageBucket[]; pages: number }> {
  const all: UsageBucket[] = [];
  let nextPage: string | null = null;
  let pages = 0;
  const PAGE_CAP = 24;
  do {
    const params: Record<string, string> = {
      starting_at: startingAt,
      bucket_width: '1d',
      limit: '31',
    };
    if (nextPage) params.page = nextPage;
    const data = await adminFetch<UsageResponse>('/v1/organizations/usage_report/messages', params);
    if (!data || !Array.isArray(data.data)) break;
    all.push(...data.data);
    pages += 1;
    nextPage = data.has_more && data.next_page ? data.next_page : null;
  } while (nextPage && pages < PAGE_CAP);
  return { buckets: all, pages };
}

/**
 * Combined Anthropic spend across the entire account history · settled
 * (cost_report) + realtime-estimated (usage_report × pricing). Caches
 * for 5 minutes. Returns null if the admin key is missing or BOTH
 * endpoints fail. Returns partial data when only one endpoint works.
 *
 * The realtime figure is what the admin card shows as the headline
 * number · it matches the Anthropic console's "$X.XX spent" because
 * both numbers are computed from the same usage data, ours via our
 * pricing table and Anthropic's via their internal rate card. They
 * should agree to within a cent or two for any single model run.
 */
export async function getAnthropicCost(): Promise<CostReport | null> {
  if (costCache.value && Date.now() - costCache.ts < CACHE_TTL_MS) return costCache.value;

  // 2026-01-01 covers Counsel.day's life so far. Bump backwards if we
  // ever need older history; the paginators handle it.
  const startingAt = '2026-01-01T00:00:00Z';
  const [{ buckets: costBuckets, pages: costPages }, { buckets: usageBuckets, pages: usagePages }] = await Promise.all([
    fetchAllCostPages(startingAt),
    fetchAllUsagePages(startingAt),
  ]);

  // Both endpoints failed · admin key probably missing/invalid.
  if (costBuckets.length === 0 && costPages === 0 && usageBuckets.length === 0 && usagePages === 0) {
    return null;
  }

  // ---- Settled spend (cost_report) ----
  let settled = 0;
  let currency = 'USD';
  for (const bucket of costBuckets) {
    for (const row of bucket.results ?? []) {
      const amt = Number(row.amount ?? 0);
      if (!Number.isFinite(amt)) continue;
      settled += amt;
      if (row.currency) currency = row.currency;
    }
  }

  // ---- Realtime spend (usage_report × pricing) ----
  // Cache-read input is billed at 10% of standard input · cache-creation
  // at 125% (5m TTL) or 200% (1h TTL). Our pricing helper only knows
  // standard rates, so we apply the multiplier inline here.
  let realtimeCents = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  for (const bucket of usageBuckets) {
    for (const row of bucket.results ?? []) {
      const model = row.model ?? '';
      const uncachedIn = Number(row.uncached_input_tokens ?? 0) || 0;
      const cacheRead = Number(row.cache_read_input_tokens ?? 0) || 0;
      // Anthropic returns cache_creation either as a flat field (older
      // shape) or as a nested object split by TTL (current shape).
      const cacheCreateFlat = Number(row.cache_creation_input_tokens ?? 0) || 0;
      const cacheCreate5m = Number(row.cache_creation?.ephemeral_5m_input_tokens ?? 0) || 0;
      const cacheCreate1h = Number(row.cache_creation?.ephemeral_1h_input_tokens ?? 0) || 0;
      const out = Number(row.output_tokens ?? 0) || 0;

      // Convert each tier of input to standard-input-equivalent so the
      // pricing helper's per-million math stays right:
      //   uncached → 1.00x  cache_read → 0.10x  create_5m → 1.25x  create_1h → 2.00x
      const standardEquivIn = Math.round(
        uncachedIn
        + cacheRead * 0.10
        + cacheCreateFlat * 1.25
        + cacheCreate5m * 1.25
        + cacheCreate1h * 2.00
      );

      realtimeCents += calculateAnthropicCostCents(model, standardEquivIn, out);
      totalInputTokens += uncachedIn + cacheRead + cacheCreateFlat + cacheCreate5m + cacheCreate1h;
      totalOutputTokens += out;
    }
  }
  const realtime = realtimeCents / 100;

  // Date range across all data returned.
  let earliest: string | null = null;
  let latest: string | null = null;
  for (const b of [...costBuckets, ...usageBuckets]) {
    if (!earliest || b.starting_at < earliest) earliest = b.starting_at;
    if (!latest || b.ending_at > latest) latest = b.ending_at;
  }

  const report: CostReport = {
    settled_usd: Math.round(settled * 10000) / 10000,
    realtime_usd: Math.round(realtime * 10000) / 10000,
    // total_usd = realtime · realtime IS the running total. Settled is
    // a subset that's already been finance-reconciled.
    total_usd: Math.round(realtime * 10000) / 10000,
    currency,
    starting_at: earliest ?? startingAt,
    ending_at: latest ?? new Date().toISOString(),
    total_input_tokens: totalInputTokens,
    total_output_tokens: totalOutputTokens,
    cost_pages_walked: costPages,
    usage_pages_walked: usagePages,
    note: 'Realtime estimate from usage_report × per-model pricing · matches the Anthropic console "$X.XX spent" number. Settled is from cost_report (lags 2-5 days, authoritative for finance).',
  };
  costCache.value = report;
  costCache.ts = Date.now();
  return report;
}
