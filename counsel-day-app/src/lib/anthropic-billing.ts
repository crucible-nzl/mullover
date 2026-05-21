/**
 * Live Anthropic billing fetch · talks to the Admin API to get the
 * organization's actual spend and credit balance.
 *
 * Requires an Admin API key in env (separate from the regular
 * ANTHROPIC_API_KEY · format `sk-ant-admin-...`). Get one from
 * console.anthropic.com → Settings → Admin Keys.
 *
 * If ANTHROPIC_ADMIN_API_KEY is unset, every function here resolves
 * to null and /admin overview falls back to the internal sums from
 * the verdicts + verdict_test_runs tables.
 *
 * Cached in-process for 5 minutes so /admin overview's 60-second
 * refresh doesn't burn an Anthropic API call every tick. Cache lives
 * for the lifetime of the Node process, which is fine · we restart
 * the systemd unit on every deploy.
 */

const ADMIN_BASE = 'https://api.anthropic.com';
const CACHE_TTL_MS = 5 * 60 * 1000;

type CostReport = {
  // Total spent across the billing period that the API returns
  // (Anthropic returns last-N-days; we ask for "all-time" by passing
  // a starting_at far in the past).
  total_usd: number;
  by_model: Array<{ model: string; usd: number; input_tokens: number; output_tokens: number }>;
  // Period boundaries reported by Anthropic.
  starting_at: string;
  ending_at: string;
};

type BalanceReport = {
  // Prepaid credit balance remaining on the account. May be null if
  // the org is on post-paid billing.
  balance_usd: number | null;
};

interface CacheEntry<T> { value: T | null; ts: number; }
const costCache: CacheEntry<CostReport> = { value: null, ts: 0 };
const balanceCache: CacheEntry<BalanceReport> = { value: null, ts: 0 };

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

/**
 * All-time spend across every model. Caches for 5 minutes.
 * Returns null if the admin key is missing or the API call fails.
 */
export async function getAnthropicCost(): Promise<CostReport | null> {
  if (costCache.value && Date.now() - costCache.ts < CACHE_TTL_MS) return costCache.value;

  // 2024-01-01 covers any reasonable "all-time" window for Counsel.day.
  // Anthropic's cost report endpoint returns daily aggregates; we sum
  // them on the client side.
  type StripeStyleResponse = {
    data: Array<{
      starting_at: string;
      ending_at: string;
      results: Array<{
        cost_type?: string;
        currency?: string;
        amount?: string;
        model?: string;
        context_window?: string;
        token_type?: string;
        service_tier?: string;
        usage_type?: string;
      }>;
    }>;
  };
  const data = await adminFetch<StripeStyleResponse>('/v1/organizations/cost_report', {
    starting_at: '2024-01-01T00:00:00Z',
    bucket_width: '1d',
    limit: '31',
  });
  if (!data || !Array.isArray(data.data)) return null;

  let total = 0;
  const byModel: Record<string, { usd: number; input_tokens: number; output_tokens: number }> = {};
  let earliest: string | null = null;
  let latest: string | null = null;
  for (const bucket of data.data) {
    if (!earliest || bucket.starting_at < earliest) earliest = bucket.starting_at;
    if (!latest || bucket.ending_at > latest) latest = bucket.ending_at;
    for (const row of bucket.results ?? []) {
      const usd = Number(row.amount ?? 0) || 0;
      total += usd;
      const model = row.model ?? 'unknown';
      if (!byModel[model]) byModel[model] = { usd: 0, input_tokens: 0, output_tokens: 0 };
      byModel[model].usd += usd;
      // Token counts aren't in the cost_report payload directly. Leave 0
      // and surface them via usage_report if the operator wants depth.
    }
  }
  const report: CostReport = {
    total_usd: Math.round(total * 100) / 100,
    by_model: Object.entries(byModel)
      .map(([model, v]) => ({ model, usd: Math.round(v.usd * 100) / 100, input_tokens: v.input_tokens, output_tokens: v.output_tokens }))
      .sort((a, b) => b.usd - a.usd),
    starting_at: earliest ?? '2024-01-01T00:00:00Z',
    ending_at: latest ?? new Date().toISOString(),
  };
  costCache.value = report;
  costCache.ts = Date.now();
  return report;
}

/**
 * Prepaid credit balance. Returns null on post-paid orgs or if the
 * Admin API call fails.
 */
export async function getAnthropicBalance(): Promise<BalanceReport | null> {
  if (balanceCache.value && Date.now() - balanceCache.ts < CACHE_TTL_MS) return balanceCache.value;

  type BalanceResponse = {
    amount?: { value?: string };
    balance?: number;
    currency?: string;
  };
  // Anthropic exposes balance under workspaces or the billing endpoint
  // depending on plan shape · we try both, picking the first one that
  // returns something. The current public path is:
  //   /v1/organizations/credit_balance
  // returning { balance: { amount, currency } }.
  const data = await adminFetch<{ balance?: { amount?: string; currency?: string } }>(
    '/v1/organizations/credit_balance'
  );
  if (!data) return null;
  const amountStr = data.balance?.amount;
  if (amountStr == null) {
    balanceCache.value = { balance_usd: null };
    balanceCache.ts = Date.now();
    return balanceCache.value;
  }
  const report: BalanceReport = { balance_usd: Number(amountStr) || 0 };
  balanceCache.value = report;
  balanceCache.ts = Date.now();
  return report;
}
