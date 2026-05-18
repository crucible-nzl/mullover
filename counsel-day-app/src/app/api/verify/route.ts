/**
 * GET /api/verify?token=...
 *
 * Target of the email-verification link sent at signup. On success:
 *   - marks the token consumed (single-use)
 *   - sets users.email_verified_at
 *   - creates a new session
 *   - sets the cd_session cookie
 *   - 302-redirects to /account
 *
 * On failure: 302-redirects to /verify-email?status=<code>
 *   status=missing  · no token param
 *   status=invalid  · token not in DB or already consumed
 *   status=expired  · token past expires_at
 */

import { NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { createSession, ctxFromHeaders, buildSessionCookie } from '@/lib/sessions';
import { eq, and, isNull } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BASE = process.env.APP_BASE_URL ?? 'https://counsel.day';

function fail(code: string) {
  return NextResponse.redirect(`${BASE}/verify-email?status=${code}`, { status: 302 });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  if (!token || token.length < 16 || token.length > 64) return fail('missing');

  // Single-use: look up unconsumed only
  const rows = await db
    .select({
      token: schema.emailVerificationTokens.token,
      userId: schema.emailVerificationTokens.userId,
      email: schema.emailVerificationTokens.email,
      expiresAt: schema.emailVerificationTokens.expiresAt,
    })
    .from(schema.emailVerificationTokens)
    .where(
      and(
        eq(schema.emailVerificationTokens.token, token),
        isNull(schema.emailVerificationTokens.consumedAt)
      )
    )
    .limit(1);

  if (rows.length === 0) return fail('invalid');
  const { userId, expiresAt } = rows[0];
  if (expiresAt.getTime() < Date.now()) return fail('expired');

  // Mark consumed BEFORE creating session · safer if the next step errors.
  await db
    .update(schema.emailVerificationTokens)
    .set({ consumedAt: new Date() })
    .where(eq(schema.emailVerificationTokens.token, token));

  // Set users.email_verified_at if not already set.
  await db
    .update(schema.users)
    .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.users.id, userId));

  // Create session + cookie
  const ctx = ctxFromHeaders(req.headers);
  const session = await createSession(userId, ctx);
  const cookie = buildSessionCookie(session.id, session.expiresAt);

  const res = NextResponse.redirect(`${BASE}/account?welcome=1`, { status: 302 });
  res.headers.set('set-cookie', cookie);
  return res;
}
