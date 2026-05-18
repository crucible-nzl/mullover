/**
 * GET    /api/me/sessions          · list this user's active sessions
 * DELETE /api/me/sessions          · revoke ALL OTHER sessions (keeps current)
 *
 * Returns sanitised session metadata only · the cookie value itself is
 * NEVER exposed. Used by /account.html "Devices and sessions" section.
 */

import { NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { readSession, readSessionCookie } from '@/lib/sessions';
import { eq, and, ne } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Lightweight UA parser · just enough for the device-name column.
// Order matters · check specific mobile UAs before desktop.
function parseUserAgent(ua: string | null): { device: string; browser: string } {
  if (!ua) return { device: 'Unknown device', browser: 'Unknown browser' };
  const u = ua.toLowerCase();
  let device = 'Desktop';
  let browser = 'Unknown';
  if (/iphone/.test(u))            device = 'iPhone';
  else if (/ipad/.test(u))         device = 'iPad';
  else if (/android.*mobile/.test(u)) device = 'Android phone';
  else if (/android/.test(u))      device = 'Android tablet';
  else if (/macintosh|mac os x/.test(u)) device = 'Mac';
  else if (/windows/.test(u))      device = 'Windows';
  else if (/linux/.test(u))        device = 'Linux';
  if (/edg\//.test(u))             browser = 'Edge';
  else if (/chrome\//.test(u) && !/edg\//.test(u)) browser = 'Chrome';
  else if (/firefox\//.test(u))    browser = 'Firefox';
  else if (/safari\//.test(u) && !/chrome\//.test(u)) browser = 'Safari';
  return { device, browser };
}

export async function GET(req: Request) {
  const cookieValue = readSessionCookie(req.headers);
  const session = await readSession(cookieValue);
  if (!session) {
    return NextResponse.json({ ok: false, message: 'You must be signed in.' }, { status: 401 });
  }

  const rows = await db
    .select({
      id: schema.sessions.id,
      createdAt: schema.sessions.createdAt,
      expiresAt: schema.sessions.expiresAt,
      userAgent: schema.sessions.userAgent,
      ipAddress: schema.sessions.ipAddress,
    })
    .from(schema.sessions)
    .where(eq(schema.sessions.userId, session.userId));

  const sessions = rows.map((r) => {
    const parsed = parseUserAgent(r.userAgent);
    return {
      id: r.id,
      is_current: r.id === cookieValue,
      device: parsed.device,
      browser: parsed.browser,
      ip_address: r.ipAddress ?? null,
      created_at: r.createdAt,
      expires_at: r.expiresAt,
    };
  });

  // Put current session first, then most-recently-created
  sessions.sort((a, b) => {
    if (a.is_current && !b.is_current) return -1;
    if (b.is_current && !a.is_current) return 1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  return NextResponse.json(
    { ok: true, sessions },
    { status: 200, headers: { 'cache-control': 'private, no-store' } }
  );
}

export async function DELETE(req: Request) {
  const cookieValue = readSessionCookie(req.headers);
  const session = await readSession(cookieValue);
  if (!session || !cookieValue) {
    return NextResponse.json({ ok: false, message: 'You must be signed in.' }, { status: 401 });
  }

  // Optional ?id=<session_id> · revoke a single session
  const url = new URL(req.url);
  const id = url.searchParams.get('id');

  if (id) {
    if (id === cookieValue) {
      return NextResponse.json(
        { ok: false, message: 'To sign out of this session, use the Sign-out button.' },
        { status: 400 }
      );
    }
    await db
      .delete(schema.sessions)
      .where(and(eq(schema.sessions.userId, session.userId), eq(schema.sessions.id, id)));
    return NextResponse.json({ ok: true, message: 'Session revoked.' }, { status: 200 });
  }

  // No id · revoke all OTHER sessions
  await db
    .delete(schema.sessions)
    .where(and(eq(schema.sessions.userId, session.userId), ne(schema.sessions.id, cookieValue)));
  return NextResponse.json({ ok: true, message: 'All other sessions revoked.' }, { status: 200 });
}
