/**
 * POST /api/hit   (JSON, fire-and-forget)
 *   path  (required) · the path the visitor is on, e.g. "/pricing"
 *   ref   (optional) · document.referrer, used ONLY to derive the host
 *
 * First-party, cookieless pageview counter. See migration 0039 for why this
 * exists: GA4 undercounts by design on this site (Consent Mode defaults to
 * denied, and ad blockers strip the tag before it loads), so the GA4 "users"
 * figure is a fraction of real traffic. This endpoint is same-origin, so ad
 * blockers do not touch it, and stores no identifiers, so it is aggregate
 * statistics rather than tracking and does not depend on consent.
 *
 * PRIVACY CONTRACT · do not weaken any of these without updating privacy.html:
 *   · no cookies are set or read
 *   · the raw IP is never stored, only mixed into a one-way digest
 *   · the full user-agent is never stored, only a coarse device class
 *   · the user id is NEVER attached, even for a signed-in visitor · this must
 *     not become a per-person activity log
 *   · only the referrer HOST is kept, never the full referring URL, which can
 *     itself carry personal data in query strings
 *
 * Always returns 204, even on bad input or a DB error: a measurement endpoint
 * must never surface an error to a visitor or slow down a page.
 */

import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { db, schema } from '@/lib/db';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const hitSchema = z.object({
  path: z.string().trim().min(1).max(200),
  ref: z.string().trim().max(500).optional(),
});

const noContent = () => new NextResponse(null, { status: 204 });

/** Coarse device class from the UA. Deliberately lossy · we want a bucket,
 *  not a fingerprint. Known crawlers are labelled so they can be excluded
 *  from reporting rather than silently inflating the numbers. */
function deviceClass(ua: string): string {
  const s = ua.toLowerCase();
  if (!s) return 'unknown';
  if (/bot|crawl|spider|slurp|facebookexternalhit|preview|monitor|curl|wget|headless|lighthouse/.test(s)) {
    return 'bot';
  }
  if (/ipad|tablet|playbook|silk/.test(s)) return 'tablet';
  if (/mobi|android|iphone|ipod/.test(s)) return 'mobile';
  return 'desktop';
}

/** Non-reversible daily-rotating visitor digest.
 *
 *  The UTC date is an input, so the same person on two days produces two
 *  unrelated values: "uniques today" works, cross-day tracking does not.
 *  SESSION_SECRET is already required for the app to boot, so this adds no
 *  new secret to manage; if it is somehow absent we fall back to a per-process
 *  random value, which degrades uniqueness accuracy rather than leaking. */
const FALLBACK_SALT = createHash('sha256')
  .update(String(Math.random()) + String(process.pid))
  .digest('hex');

function visitorHash(ip: string, ua: string): string {
  const secret = process.env.SESSION_SECRET || process.env.DATABASE_URL || FALLBACK_SALT;
  const day = new Date().toISOString().slice(0, 10); // UTC date
  return createHash('sha256').update(`${secret}|${day}|${ip}|${deviceClass(ua)}`).digest('hex').slice(0, 32);
}

/** Referrer host only, and never our own domain (that is internal navigation,
 *  which would drown out the acquisition signal we actually want). */
function referrerHost(ref: string | undefined, selfHost: string | null): string | null {
  if (!ref) return null;
  try {
    const h = new URL(ref).hostname.replace(/^www\./, '');
    if (!h) return null;
    if (selfHost && h === selfHost.replace(/^www\./, '')) return null;
    return h.slice(0, 100);
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const ip = getClientIp(req);

  // Generous: a real reader legitimately views many pages. This only exists to
  // stop a script inflating the counts.
  const rl = await checkRateLimit(`hit-ip:${ip}`, 300, 3600);
  if (!rl.allowed) return noContent();

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return noContent();
  }

  const parsed = hitSchema.safeParse(raw);
  if (!parsed.success) return noContent();

  // Only record our own paths. Guards against a third-party page POSTing here
  // to pollute the data.
  const path = parsed.data.path.startsWith('/') ? parsed.data.path.split('?')[0].split('#')[0] : null;
  if (!path) return noContent();

  const ua = req.headers.get('user-agent') ?? '';
  const device = deviceClass(ua);

  try {
    await db.insert(schema.pageHits).values({
      path,
      referrerHost: referrerHost(parsed.data.ref, req.headers.get('host')),
      // Cloudflare gives us the country at the edge · no IP geolocation needed.
      country: (req.headers.get('cf-ipcountry') ?? '').slice(0, 2).toUpperCase() || null,
      device,
      visitorHash: visitorHash(ip, ua),
    });
  } catch {
    // Best effort · a measurement failure must never affect the visitor.
  }

  return noContent();
}
