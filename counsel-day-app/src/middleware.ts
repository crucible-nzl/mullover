/**
 * Edge middleware · per-IP rate limiting on /api/*.
 *
 * Storage: in-memory Map per instance. Counters reset on app restart,
 * which is acceptable for single-instance · an attacker would still hit
 * the limit per restart cycle. When we go multi-instance, swap the Map
 * for Postgres or Redis (the helper signatures stay the same).
 *
 * Rule selection: first matching prefix wins. Order matters; specific
 * paths must precede the `/api/` catch-all.
 *
 * Bypass: stripe-webhook (Stripe retries aggressively; idempotency in
 * the handler dedupes), auth-check (called by Caddy on every protected
 * page render · would shred the limit), and health (monitoring probe).
 *
 * IP source: trust the X-Real-IP header set by Caddy. Caddy is the only
 * public ingress, so this is safe. If we ever sit behind a CDN, switch
 * to parsing X-Forwarded-For with an allowlist of trusted upstreams.
 *
 * Headers emitted on every limited response:
 *   X-RateLimit-Limit       · the bucket cap per window
 *   X-RateLimit-Remaining   · requests left in the current window
 *   X-RateLimit-Reset       · unix timestamp when the window resets
 * On 429 responses additionally:
 *   Retry-After             · seconds until next attempt is permitted
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

interface Bucket {
  resetAt: number;
  count: number;
}
const buckets = new Map<string, Bucket>();

// Garbage-collect expired buckets every 5 minutes so the Map doesn't
// grow unbounded under sustained abuse.
const GC_INTERVAL_MS = 5 * 60 * 1000;
let lastGc = Date.now();
function maybeGc(now: number) {
  if (now - lastGc < GC_INTERVAL_MS) return;
  lastGc = now;
  for (const [k, v] of buckets) {
    if (v.resetAt <= now) buckets.delete(k);
  }
}

interface Rule { prefix: string; key: string; limit: number; windowMs: number }

const RULES: Rule[] = [
  // ---- Auth abuse vectors · password cracking, email bombing, token guessing ----
  { prefix: '/api/signin',                 key: 'signin',   limit: 5,   windowMs: 60_000 },
  { prefix: '/api/signup',                 key: 'signup',   limit: 5,   windowMs: 60_000 },
  { prefix: '/api/password-reset/request', key: 'pwreq',    limit: 3,   windowMs: 60_000 },
  { prefix: '/api/password-reset/consume', key: 'pwcons',   limit: 5,   windowMs: 60_000 },
  { prefix: '/api/verify',                 key: 'verify',   limit: 5,   windowMs: 60_000 },
  { prefix: '/api/set-password',           key: 'setpw',    limit: 5,   windowMs: 60_000 },
  // ---- Money paths ----
  { prefix: '/api/checkout/create',        key: 'checkout', limit: 10,  windowMs: 60_000 },
  { prefix: '/api/billing/portal',         key: 'portal',   limit: 10,  windowMs: 60_000 },
  // ---- Decision lifecycle ----
  { prefix: '/api/compose',                key: 'compose',  limit: 10,  windowMs: 60_000 },
  { prefix: '/api/vote',                   key: 'vote',     limit: 30,  windowMs: 60_000 },
  { prefix: '/api/invite/accept',          key: 'invacc',   limit: 10,  windowMs: 60_000 },
  { prefix: '/api/invite/preview',         key: 'invprv',   limit: 30,  windowMs: 60_000 },
  // ---- Generous default for any other /api/* (read-mostly endpoints) ----
  { prefix: '/api/',                       key: 'default',  limit: 120, windowMs: 60_000 },
];

const BYPASS = new Set<string>([
  '/api/stripe/webhook',
  '/api/auth-check',
  '/api/health',
]);

function ipFor(req: NextRequest): string {
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp;
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return 'unknown';
}

function pickRule(pathname: string): Rule | null {
  for (const r of RULES) {
    if (pathname.startsWith(r.prefix)) return r;
  }
  return null;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (BYPASS.has(pathname)) return NextResponse.next();
  const rule = pickRule(pathname);
  if (!rule) return NextResponse.next();

  const ip = ipFor(req);
  const now = Date.now();
  maybeGc(now);

  const key = `${ip}:${rule.key}`;
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { resetAt: now + rule.windowMs, count: 0 };
    buckets.set(key, bucket);
  }
  bucket.count++;

  const remaining = Math.max(0, rule.limit - bucket.count);
  const resetUnix = Math.floor(bucket.resetAt / 1000);

  if (bucket.count > rule.limit) {
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    return NextResponse.json(
      { ok: false, message: `Too many requests. Try again in ${retryAfter} seconds.` },
      {
        status: 429,
        headers: {
          'retry-after': String(retryAfter),
          'x-ratelimit-limit': String(rule.limit),
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': String(resetUnix),
        },
      }
    );
  }

  const res = NextResponse.next();
  res.headers.set('x-ratelimit-limit', String(rule.limit));
  res.headers.set('x-ratelimit-remaining', String(remaining));
  res.headers.set('x-ratelimit-reset', String(resetUnix));
  return res;
}

// Scope middleware to /api/* only · static + page routes get nothing
// added to their latency.
export const config = {
  matcher: '/api/:path*',
};
