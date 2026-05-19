/**
 * GET /api/push/public-key
 *
 * Returns the VAPID public key so the browser can construct a push
 * subscription that the backend will be able to authenticate against
 * when sending payloads.
 *
 * Security: public-by-design. The VAPID public key is meant to be
 * shared; the PRIVATE key stays server-side in env (never returned).
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const pub = process.env.VAPID_PUBLIC_KEY;
  if (!pub) {
    return NextResponse.json({ ok: false, message: 'Push is not configured on this server.' }, { status: 503 });
  }
  return NextResponse.json({ ok: true, public_key: pub }, {
    status: 200,
    headers: { 'cache-control': 'public, max-age=300' },
  });
}
