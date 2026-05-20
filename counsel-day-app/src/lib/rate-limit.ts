/**
 * Counsel.day · rate-limit helper.
 *
 * Postgres-backed fixed-window counter. One row per bucket key.
 * Atomic upsert handles concurrency · Postgres serialises the
 * ON CONFLICT update within the row lock.
 *
 * Usage:
 *
 *   import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
 *
 *   const ip = getClientIp(req);
 *   const ipCheck = await checkRateLimit(`signin-ip:${ip}`, 10, 3600);
 *   if (!ipCheck.allowed) {
 *     return rateLimitResponse(ipCheck);
 *   }
 *
 *   const emailCheck = await checkRateLimit(`signin-email:${email}`, 5, 3600);
 *   if (!emailCheck.allowed) return rateLimitResponse(emailCheck);
 *
 * Two checks per request is cheap (single UPSERT each). Run both
 * BEFORE any expensive work (DB user lookup, email send) so abuse
 * traffic exits fast.
 *
 * Limits are configured at the call site, not in this file · the
 * helper is policy-free. Per docs/SECURITY_PENTEST_2026-05-20.md
 * recommendation: /api/signin uses 10/hour per IP and 5/hour per
 * email.
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';

export type RateLimitResult = {
  allowed: boolean;
  count: number;
  limit: number;
  remaining: number;
  resetAt: Date;
  retryAfterSeconds: number;
};

/**
 * Extract the requesting client's IP from request headers, in the
 * order Caddy provides it. Falls back to "unknown" so the key is
 * never empty.
 *
 * Caddyfile sets `header_up X-Real-IP {remote_host}` for proxied
 * routes; for everything else (forward_auth gates etc.) we also
 * check X-Forwarded-For.
 */
export function getClientIp(req: Request): string {
  const real = req.headers.get('x-real-ip')?.trim();
  if (real) return real;
  const fwd = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (fwd) return fwd;
  return 'unknown';
}

/**
 * checkRateLimit("signin-ip:1.2.3.4", 10, 3600)
 *   → atomically upsert. Resets the counter if reset_at < NOW(),
 *     otherwise increments. Returns the new count, the limit, and
 *     the timestamp at which the window resets.
 *
 * `allowed` is true when count <= limit. When false, the response
 * should return 429 with Retry-After.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  if (!key || limit <= 0 || windowSeconds <= 0) {
    throw new Error('checkRateLimit: invalid parameters');
  }

  // Atomic upsert. The CASE inside ON CONFLICT handles the
  // window-rollover case: when the existing row's reset_at is in
  // the past, we start a fresh window.
  const rows = await db.execute<{ count: string; reset_at: string }>(sql`
    INSERT INTO rate_limits (key, count, reset_at, last_hit_at)
    VALUES (${key}, 1, NOW() + (${windowSeconds} * INTERVAL '1 second'), NOW())
    ON CONFLICT (key) DO UPDATE
       SET count = CASE
             WHEN rate_limits.reset_at < NOW() THEN 1
             ELSE rate_limits.count + 1
           END,
           reset_at = CASE
             WHEN rate_limits.reset_at < NOW() THEN NOW() + (${windowSeconds} * INTERVAL '1 second')
             ELSE rate_limits.reset_at
           END,
           last_hit_at = NOW()
    RETURNING count::text, reset_at::text
  `);
  const r = rows[0] as { count: string; reset_at: string };
  const count = Number(r.count);
  const resetAt = new Date(r.reset_at);
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000));

  return {
    allowed: count <= limit,
    count,
    limit,
    remaining: Math.max(0, limit - count),
    resetAt,
    retryAfterSeconds,
  };
}

/**
 * Standard 429 response with the headers a well-behaved client expects.
 * Use this when `result.allowed` is false.
 */
export function rateLimitResponse(result: RateLimitResult, message?: string): NextResponse {
  return new NextResponse(
    JSON.stringify({
      ok: false,
      message: message ?? 'Too many requests. Please wait and try again.',
      retry_after_seconds: result.retryAfterSeconds,
    }),
    {
      status: 429,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'retry-after': String(result.retryAfterSeconds),
        'x-ratelimit-limit': String(result.limit),
        'x-ratelimit-remaining': String(result.remaining),
        'x-ratelimit-reset': String(Math.floor(result.resetAt.getTime() / 1000)),
      },
    },
  );
}
