/**
 * requireAdmin · the canonical gate for every /api/admin/* route.
 *
 * Returns { userId } if the request carries a valid session AND the
 * user has users.is_admin = true. Otherwise returns a NextResponse
 * with the appropriate status (401 for no session, 403 for
 * authenticated-but-not-admin).
 *
 * Use:
 *   export async function GET(req: Request) {
 *     const gate = await requireAdmin(req);
 *     if (gate instanceof NextResponse) return gate;
 *     // ... gate.userId is the admin's user id
 *   }
 */

import { NextResponse } from 'next/server';
import { db, schema } from './db';
import { readSession, readSessionCookie } from './sessions';
import { eq, sql } from 'drizzle-orm';

/**
 * Five-minute fresh-MFA window. Admin destructive actions
 * (promote/demote, soft-delete, product deactivation) require
 * the operator to have presented a fresh TOTP code within this
 * many seconds. Step up via POST /api/me/mfa/step-up.
 */
export const FRESH_MFA_WINDOW_SECONDS = 5 * 60;

const ALLOWED_ORIGINS = new Set([
  'https://counsel.day',
  'https://www.counsel.day',
]);

/**
 * For state-changing methods (POST/PATCH/PUT/DELETE), verify the
 * Origin or Referer matches our own domain. Defence-in-depth on top
 * of SameSite=Lax. Per docs/SECURITY_PENTEST_2026-05-20.md 5.3.
 *
 * Returns true if the request is safe to mutate state. GET/HEAD are
 * always allowed through (read-only).
 */
function originAllowed(req: Request): boolean {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
  const origin = req.headers.get('origin');
  if (origin && ALLOWED_ORIGINS.has(origin)) return true;
  // Some clients (curl, server-to-server) omit Origin · fall back to
  // Referer prefix-match.
  const referer = req.headers.get('referer');
  if (referer) {
    try {
      const u = new URL(referer);
      if (ALLOWED_ORIGINS.has(`${u.protocol}//${u.host}`)) return true;
    } catch { /* malformed referer */ }
  }
  return false;
}

export async function requireAdmin(req: Request): Promise<{ userId: string } | NextResponse> {
  if (!originAllowed(req)) {
    return NextResponse.json(
      { ok: false, message: 'Request rejected (origin mismatch).' },
      { status: 403 }
    );
  }

  const session = await readSession(readSessionCookie(req.headers));
  if (!session) {
    return NextResponse.json({ ok: false, message: 'You must be signed in.' }, { status: 401 });
  }

  const rows = await db
    .select({ isAdmin: schema.users.isAdmin, deletedAt: schema.users.deletedAt })
    .from(schema.users)
    .where(eq(schema.users.id, session.userId))
    .limit(1);

  if (rows.length === 0 || rows[0].deletedAt !== null) {
    return NextResponse.json({ ok: false, message: 'Account not found.' }, { status: 401 });
  }
  if (!rows[0].isAdmin) {
    return NextResponse.json({ ok: false, message: 'Not authorised.' }, { status: 403 });
  }

  return { userId: session.userId };
}

/**
 * Step-up gate · enforces that the admin has presented a fresh TOTP
 * code in the last FRESH_MFA_WINDOW_SECONDS. Apply this on top of
 * requireAdmin() for destructive operations.
 *
 * Returns { userId, sessionId } if fresh, NextResponse(401/403) otherwise.
 *
 * Policy nuance:
 *   · If the user has NO MFA enrolled, the gate falls through · MFA
 *     is optional at the user level (per the locked-settings memory)
 *     so we can't require what doesn't exist. The /admin-users page
 *     should nudge admins to enable MFA for the benefit to kick in.
 *   · If the user HAS MFA enrolled and the session's mfa_verified_at
 *     is missing or older than the window, return 401 with
 *     mfa_step_up_required so the UI can prompt for re-verification.
 */
export async function requireFreshMfa(req: Request): Promise<{ userId: string; sessionId: string } | NextResponse> {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const sessionId = readSessionCookie(req.headers);
  if (!sessionId) {
    return NextResponse.json({ ok: false, message: 'Session missing.' }, { status: 401 });
  }

  // Check whether this user has MFA enrolled at all. No enrolment =
  // step-up has nothing to gate against · let the action through.
  const mfaRows = await db
    .select({ enabledAt: schema.mfaSecrets.enabledAt })
    .from(schema.mfaSecrets)
    .where(eq(schema.mfaSecrets.userId, gate.userId))
    .limit(1);
  const mfaEnrolled = mfaRows.length > 0 && mfaRows[0].enabledAt !== null;
  if (!mfaEnrolled) {
    return { userId: gate.userId, sessionId };
  }

  // MFA enrolled · check freshness.
  const stampRows = await db.execute<{ mfa_verified_at: string | null }>(sql`
    SELECT mfa_verified_at::text FROM sessions WHERE id = ${sessionId} LIMIT 1
  `);
  const stamp = (stampRows[0] as { mfa_verified_at: string | null })?.mfa_verified_at;
  if (stamp) {
    const ageSec = (Date.now() - new Date(stamp).getTime()) / 1000;
    if (ageSec >= 0 && ageSec < FRESH_MFA_WINDOW_SECONDS) {
      return { userId: gate.userId, sessionId };
    }
  }

  return NextResponse.json(
    {
      ok: false,
      message: 'Re-verify with your authenticator app to continue.',
      mfa_step_up_required: true,
      window_seconds: FRESH_MFA_WINDOW_SECONDS,
    },
    { status: 401 }
  );
}
