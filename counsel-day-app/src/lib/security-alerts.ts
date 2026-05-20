/**
 * Counsel.day · burst-based security alerts via Sentry.
 *
 * Per docs/SECURITY_PENTEST_2026-05-20.md item 9.4. The pattern:
 *
 *   trackAuthFailure(scope, key, severity)
 *     · increments a counter for "<scope>:<key>" (e.g. signin-ip:1.2.3.4)
 *       in the existing rate_limits table (re-using the row but a
 *       different key prefix so we don't collide with rate buckets).
 *     · when the counter crosses a threshold inside a 5-minute window,
 *       fires Sentry.captureMessage at the configured level with the
 *       relevant tags.
 *     · INFO breadcrumb every event; WARN captureMessage at burst.
 *
 * Why a separate keyspace: rate_limits is already there; reusing
 * avoids a new table. The session-purge cron already trims dead rows.
 *
 * Why burst-based: per-event Sentry captures would flood the 5K/month
 * free tier on any sustained probe. Bursts only fire once per
 * threshold-crossing inside the window, so noise is bounded.
 */

import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';

const BURST_THRESHOLD = 5;        // events
const BURST_WINDOW_SECONDS = 300; // 5 minutes

let cachedSentry: typeof import('@sentry/nextjs') | null | undefined;

async function loadSentry(): Promise<typeof import('@sentry/nextjs') | null> {
  if (cachedSentry !== undefined) return cachedSentry;
  try {
    cachedSentry = await import('@sentry/nextjs');
    return cachedSentry;
  } catch {
    cachedSentry = null;
    return null;
  }
}

/**
 * Track an auth failure. Returns true if this event tripped the burst
 * threshold (fired a Sentry captureMessage), false otherwise.
 *
 *   scope · short label, e.g. 'signin', 'admin', 'verify'
 *   key   · identifier that groups events, e.g. an IP or an email
 *   meta  · optional tag/context for Sentry
 */
export async function trackAuthFailure(
  scope: string,
  key: string,
  meta: Record<string, unknown> = {},
): Promise<boolean> {
  if (!scope || !key) return false;

  // Re-use rate_limits as a counter with the 'auth-fail:' prefix so it
  // doesn't collide with rate-limit buckets.
  const bucketKey = `auth-fail:${scope}:${key}`;
  let count = 1;
  try {
    const rows = await db.execute<{ count: string }>(sql`
      INSERT INTO rate_limits (key, count, reset_at, last_hit_at)
      VALUES (${bucketKey}, 1, NOW() + (${BURST_WINDOW_SECONDS} * INTERVAL '1 second'), NOW())
      ON CONFLICT (key) DO UPDATE
         SET count = CASE
               WHEN rate_limits.reset_at < NOW() THEN 1
               ELSE rate_limits.count + 1
             END,
             reset_at = CASE
               WHEN rate_limits.reset_at < NOW() THEN NOW() + (${BURST_WINDOW_SECONDS} * INTERVAL '1 second')
               ELSE rate_limits.reset_at
             END,
             last_hit_at = NOW()
      RETURNING count::text
    `);
    count = Number((rows[0] as { count: string }).count);
  } catch (err) {
    console.warn('[security-alerts] counter upsert failed', err);
    return false;
  }

  const sentry = await loadSentry();
  if (!sentry) return false;

  // INFO breadcrumb on every event so the trail is visible in
  // surrounding Sentry events.
  sentry.addBreadcrumb({
    category: 'auth',
    level: 'info',
    message: `auth-fail scope=${scope} key=${key} count=${count}`,
    data: meta,
  });

  // Fire captureMessage exactly when we cross the threshold inside
  // the window. On subsequent events inside the same window we stay
  // quiet (the breadcrumb still records them).
  if (count === BURST_THRESHOLD) {
    sentry.captureMessage(
      `Auth-failure burst · ${scope} · ${count} events in ${BURST_WINDOW_SECONDS}s`,
      {
        level: 'warning',
        tags: { scope, security: 'auth-burst' },
        extra: { key, count, window_seconds: BURST_WINDOW_SECONDS, ...meta },
      },
    );
    return true;
  }
  return false;
}
