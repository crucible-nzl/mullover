/**
 * Counsel.day · Web Push helper
 *
 * One function: sendPushToUser(userId, payload) · looks up every
 * push subscription for that user, sends the payload to each, and
 * cleans up endpoints that have permanently expired (410 GONE).
 *
 * Backend wires this into:
 *   · evening-prompt cron · "Tonight's vote is ready"
 *   · verdict-reveal cron · "Your verdict is open · open the record"
 *   · invite-accept     · "Alex accepted your decision invite"
 *
 * If VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT are not
 * set in env, sendPushToUser becomes a no-op (returns a result with
 * ok: false, reason: 'not_configured'). This is deliberate · push
 * is opt-in for the deployment, not required for the product to run.
 *
 * Setup (one-time, on the server):
 *   $ npx web-push generate-vapid-keys
 *   → paste the two strings into /etc/counsel-day-app/env.local as
 *     VAPID_PUBLIC_KEY=…
 *     VAPID_PRIVATE_KEY=…
 *     VAPID_SUBJECT=mailto:admin@counsel.day
 *   $ sudo systemctl restart counsel-day-app
 *
 * The `web-push` npm package is loaded dynamically so it's only
 * required when push is actually configured; missing dep is non-fatal.
 */

import { db, schema } from '@/lib/db';
import { and, eq, sql } from 'drizzle-orm';

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  renotify?: boolean;
  requireInteraction?: boolean;
  icon?: string;
  badge?: string;
};

export type PushResult = {
  ok: boolean;
  reason?: 'not_configured' | 'no_subscriptions' | 'send_failed';
  sent: number;
  removed: number;
};

let cachedWebPush: typeof import('web-push') | null = null;

async function loadWebPush(): Promise<typeof import('web-push') | null> {
  if (cachedWebPush) return cachedWebPush;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subj = process.env.VAPID_SUBJECT;
  if (!pub || !priv || !subj) return null;
  try {
    const mod = await import('web-push');
    mod.setVapidDetails(subj, pub, priv);
    cachedWebPush = mod;
    return mod;
  } catch (err) {
    console.warn('[push] web-push module not available · run `npm install web-push` to enable', err);
    return null;
  }
}

export async function sendPushToUser(userId: string, payload: PushPayload): Promise<PushResult> {
  const webPush = await loadWebPush();
  if (!webPush) return { ok: false, reason: 'not_configured', sent: 0, removed: 0 };

  const subs = await db
    .select({
      id: schema.pushSubscriptions.id,
      endpoint: schema.pushSubscriptions.endpoint,
      p256dh: schema.pushSubscriptions.p256dh,
      auth: schema.pushSubscriptions.auth,
    })
    .from(schema.pushSubscriptions)
    .where(eq(schema.pushSubscriptions.userId, userId));

  if (subs.length === 0) return { ok: false, reason: 'no_subscriptions', sent: 0, removed: 0 };

  const body = JSON.stringify(payload);
  let sent = 0;
  let removed = 0;

  await Promise.all(subs.map(async (sub) => {
    try {
      await webPush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body,
        { TTL: 60 * 60 * 24 }, // 24h · stale evening prompts are useless
      );
      sent++;
      await db.execute(sql`
        UPDATE push_subscriptions
        SET last_seen_at = NOW(), last_error_at = NULL, last_error = NULL
        WHERE id = ${sub.id}
      `).catch(() => {});
    } catch (err: unknown) {
      const status = (err as { statusCode?: number })?.statusCode;
      const message = (err as Error)?.message ?? 'unknown';
      if (status === 404 || status === 410) {
        // Permanent · drop the subscription
        await db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.id, sub.id)).catch(() => {});
        removed++;
      } else {
        await db.execute(sql`
          UPDATE push_subscriptions
          SET last_error_at = NOW(), last_error = ${message.slice(0, 500)}
          WHERE id = ${sub.id}
        `).catch(() => {});
      }
    }
  }));

  return { ok: sent > 0, sent, removed };
}

/**
 * Convenience wrapper · same payload to many users (e.g. cron).
 * Returns aggregate counts; per-user failure is silently swallowed.
 */
export async function sendPushToUsers(userIds: string[], payload: PushPayload): Promise<{ sent: number; removed: number; users: number }> {
  let totalSent = 0;
  let totalRemoved = 0;
  await Promise.all(userIds.map(async (uid) => {
    const r = await sendPushToUser(uid, payload).catch(() => ({ sent: 0, removed: 0 } as PushResult));
    totalSent += r.sent;
    totalRemoved += r.removed;
  }));
  return { sent: totalSent, removed: totalRemoved, users: userIds.length };
}

/**
 * Used by the unsigned health check endpoint to surface whether the
 * deployment has VAPID configured.
 */
export function isPushConfigured(): boolean {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
}
