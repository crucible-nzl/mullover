/**
 * GET /api/auth-check
 *
 * Called by Caddy's forward_auth directive on every request to a protected
 * route (/account, /billing, /decisions, /decision, /compose, /vote-today,
 * /verdict-reveal, /invite).
 *
 * Returns:
 *   200 + X-Auth-User-Id: <uuid>     · session valid · Caddy serves the file
 *   401 + WWW-Authenticate: Bearer   · no session   · Caddy redirects to /signin
 *
 * Side effect: slides the session expiry forward (touchSession).
 */

import { NextResponse } from 'next/server';
import { readSession, readSessionCookie, touchSession } from '@/lib/sessions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const sessionId = readSessionCookie(req.headers);
  const session = await readSession(sessionId);
  if (!session || !sessionId) {
    return new NextResponse(null, {
      status: 401,
      headers: { 'cache-control': 'no-store' },
    });
  }
  // sliding window · cheap update
  void touchSession(sessionId);
  return new NextResponse(null, {
    status: 200,
    headers: {
      'x-auth-user-id': session.userId,
      'cache-control': 'no-store',
    },
  });
}
