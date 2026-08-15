/**
 * GET /api/geo
 *
 * Returns only which consent regime applies to this visitor:
 *   { "consent_required": true|false, "region": "eu"|"row" }
 *
 * WHY THIS EXISTS
 * Cookie consent comes from the ePrivacy Directive, which binds the EU, the
 * EEA, the UK and (via its own FADP) Switzerland. It does not apply in New
 * Zealand, Australia or the United States, whose regimes are notice-based or
 * opt-out. The site had been applying the strictest rule in the world to every
 * visitor, so analytics was off by default for an audience that is mostly
 * NZ-based. Cloudflare measured 70 real visitors on 15 Aug 2026; GA4 counted 9.
 *
 * Deliberately narrow: it does NOT return the country code, city, or anything
 * else a caller could log or fingerprint with. The client only needs to know
 * whether it must ask first. Cloudflare already knows the country at the edge,
 * so no IP geolocation happens here and no IP is read, stored, or logged.
 *
 * Fails CLOSED. Any missing header, unknown country or error yields
 * consent_required: true, i.e. the strict EU behaviour. Getting this wrong in
 * the safe direction costs us a little data; getting it wrong the other way is
 * a compliance breach.
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** EU 27 + EEA (IS, LI, NO) + UK + Switzerland.
 *  Keep this list here as the single source of truth; the client must never
 *  hold its own copy that can drift out of step. */
const CONSENT_REQUIRED = new Set([
  // EU 27
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR',
  'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
  'SI', 'ES', 'SE',
  // EEA non-EU
  'IS', 'LI', 'NO',
  // United Kingdom (UK GDPR + PECR)
  'GB',
  // Switzerland (revised FADP · treated as strict by choice)
  'CH',
]);

export async function GET(req: Request) {
  // Cloudflare sets this at the edge on every proxied request.
  const country = (req.headers.get('cf-ipcountry') ?? '').trim().toUpperCase();

  // 'XX' (unknown), 'T1' (Tor) and an absent header all fail closed.
  const known = /^[A-Z]{2}$/.test(country) && country !== 'XX' && country !== 'T1';
  const consentRequired = !known || CONSENT_REQUIRED.has(country);

  return NextResponse.json(
    { consent_required: consentRequired, region: consentRequired ? 'eu' : 'row' },
    {
      headers: {
        // Must never be cached: the answer differs per visitor, and a cached
        // 'row' served to an EU visitor would be a compliance failure.
        'cache-control': 'private, no-store, max-age=0',
        vary: 'CF-IPCountry',
      },
    }
  );
}
