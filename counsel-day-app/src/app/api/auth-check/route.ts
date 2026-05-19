/**
 * GET /api/auth-check
 *
 * Called by Caddy's forward_auth directive on every request to a protected
 * route (/account, /billing, /decisions, /decision, /compose, /vote-today,
 * /verdict-reveal, /invite) AND by ga4.js refreshNav() to decorate the nav
 * for signed-in users.
 *
 * Returns:
 *   200 + X-Auth-User-Id: <uuid>      · session valid · Caddy serves the file
 *         X-Is-Admin: 1               · only when users.is_admin = true
 *         JSON body { ok, is_admin }  · convenience for browser-side nav
 *   401 + WWW-Authenticate: Bearer    · no session   · Caddy redirects to /signin
 *
 * Side effect: slides the session expiry forward (touchSession).
 *
 * Caddy's forward_auth ignores the response body, so adding JSON here is
 * free from the gate's perspective. The extra user lookup on every
 * protected request is a single indexed read · keep it cheap, keep it
 * cached if needed in the future.
 */

import { NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
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

  // Look up is_admin so the browser can decorate nav. One indexed row read.
  const rows = await db
    .select({ isAdmin: schema.users.isAdmin })
    .from(schema.users)
    .where(eq(schema.users.id, session.userId))
    .limit(1);
  const isAdmin = !!rows[0]?.isAdmin;

  const headers: Record<string, string> = {
    'x-auth-user-id': session.userId,
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  };
  if (isAdmin) headers['x-is-admin'] = '1';

  return new NextResponse(JSON.stringify({ ok: true, is_admin: isAdmin }), {
    status: 200,
    headers,
  });
}
