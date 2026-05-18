/**
 * POST /api/signout
 *
 * Deletes the current session row (if any) and clears the cd_session cookie.
 * Always returns 200 + redirect=/signed-out, even if there was no session.
 *
 * GET is also accepted so a plain anchor tag <a href="/api/signout"> works.
 */

import { NextResponse } from 'next/server';
import { destroySession, readSessionCookie, buildClearedSessionCookie } from '@/lib/sessions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BASE = process.env.APP_BASE_URL ?? 'https://counsel.day';

async function handler(req: Request, redirectInsteadOfJson: boolean) {
  const sessionId = readSessionCookie(req.headers);
  if (sessionId) {
    try { await destroySession(sessionId); } catch { /* ignore */ }
  }
  const clearedCookie = buildClearedSessionCookie();
  if (redirectInsteadOfJson) {
    const res = NextResponse.redirect(`${BASE}/signed-out`, { status: 302 });
    res.headers.set('set-cookie', clearedCookie);
    return res;
  }
  const res = NextResponse.json({ ok: true, redirect: '/signed-out' }, { status: 200 });
  res.headers.set('set-cookie', clearedCookie);
  return res;
}

export function GET(req: Request) { return handler(req, true); }
export function POST(req: Request) { return handler(req, false); }
