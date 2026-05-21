/**
 * Live Anthropic billing fetch · talks to the Admin API to get the
 * organization's actual settled spend.
 *
 * Requires an Admin API key in env (separate from the regular
 * ANTHROPIC_API_KEY · format `sk-ant-admin-...`). Get one from
 * console.anthropic.com → Settings → Admin Keys.
 *
 * Notes from the response shapes Anthropic actually returns (verified
 * against the live API on 2026-05-22):
 *   · /v1/organizations/cost_report  · returns paginated daily buckets,
 *     each with a `results[]` of line items {currency, amount, model,
 *     token_type, ...}. amount is a string. Pages link via next_page.
 *     Reports SETTLED spend · there's typically a 2-5 day lag between
 *     real-time API calls and the cost showing up here.
 *   · /v1/organizations/credit_balance  · 404s on Counsel.day's account.
 *     This endpoint is documented but not available for all org types.
 *     We don't surface a balance card; the operator checks the console.
 *
 * Cached in-process for 5 minutes so /admin overview's 60-second refresh
 * doesn't burn an Anthropic API call every tick.
 */

const ADMIN_BASE = 'https://api.anthropic.com';
const CACHE_TTL_MS = 5 * 60 * 1000;

export type CostReport = {
  total_usd: number;
  // Currency is always USD on Counsel.day's account but we surface it
  // anyway in case Anthropic ever returns a multi-currency total.
  currency: string;
  // First settled day → last settled day in the data returned.
  starting_at: string;
  ending_at: string;
  // Total number of pages we walked · operator can see when the API is
  // slow to pull a full history.
  pages_walked: number;
  // Inform the admin UI that there's typically a 2-5 day settling lag.
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

/**
 * Walks every page of cost_report from `startingAt` to today.
 * Anthropic returns ~31 days per page, paginates via `?page=<token>`.
 * Safety cap of 24 pages (≈ 2 years of daily buckets) so a misconfigured
 * starting_at never makes us hammer the API.
 */
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

/**
 * Settled Anthropic spend across the entire account history. Caches
 * for 5 minutes. Returns null if the admin key is missing or the API
 * call fails.
 */
export async function getAnthropicCost(): Promise<CostReport | null> {
  if (costCache.value && Date.now() - costCache.ts < CACHE_TTL_MS) return costCache.value;

  // 2026-01-01 covers Counsel.day's life so far. Bump backwards if we
  // ever need older history; the paginator handles it.
  const { buckets, pages } = await fetchAllCostPages('2026-01-01T00:00:00Z');
  if (buckets.length === 0 && pages === 0) return null;

  let total = 0;
  let earliest: string | null = null;
  let latest: string | null = null;
  let currency = 'USD';
  for (const bucket of buckets) {
    if (!earliest || bucket.starting_at < earliest) earliest = bucket.starting_at;
    if (!latest || bucket.ending_at > latest) latest = bucket.ending_at;
    for (const row of bucket.results ?? []) {
      const amt = Number(row.amount ?? 0);
      if (!Number.isFinite(amt)) continue;
      total += amt;
      if (row.currency) currency = row.currency;
    }
  }

  const report: CostReport = {
    total_usd: Math.round(total * 10000) / 10000,
    currency,
    starting_at: earliest ?? '2026-01-01T00:00:00Z',
    ending_at: latest ?? new Date().toISOString(),
    pages_walked: pages,
    note: 'Anthropic settles cost_report data 2-5 days after the API call. Today\'s testing-area spend will appear here later in the week.',
  };
  costCache.value = report;
  costCache.ts = Date.now();
  return report;
}
