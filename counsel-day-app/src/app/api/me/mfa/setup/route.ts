/**
 * POST /api/me/mfa/setup
 *
 * Begin TOTP enrolment. Generates (or overwrites) the user's
 * mfa_secrets row with a fresh secret + fresh recovery codes.
 * is_enabled stays false until /api/me/mfa/verify-setup confirms
 * the user can produce a valid TOTP code · this gates against
 * locking yourself out by losing your authenticator app.
 *
 * Returns:
 *   { ok, secret, otpauth_url, recovery_codes }
 *
 * The plaintext recovery codes are shown to the user ONCE here.
 * Subsequent requests return the same secret/otpauth_url (so the
 * user can re-scan if they lost their first attempt) but recovery
 * codes are NEVER returned again · only their hashes are stored.
 *
 * The client should display the secret + QR (rendered from
 * otpauth_url) + the recovery codes, then prompt the user for a
 * TOTP code, then POST it to /api/me/mfa/verify-setup.
 *
 * If MFA is already enabled, this endpoint returns 409 · the user
 * must disable first.
 */

import { NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { readSession, readSessionCookie } from '@/lib/sessions';
import { generateMfaSecret, otpauthUrl, generateRecoveryCodes } from '@/lib/mfa';
import { eq, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const session = await readSession(readSessionCookie(req.headers));
  if (!session) {
    return NextResponse.json({ ok: false, message: 'You must be signed in.' }, { status: 401 });
  }

  const userRows = await db
    .select({ email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.id, session.userId))
    .limit(1);
  if (userRows.length === 0) {
    return NextResponse.json({ ok: false, message: 'Account not found.' }, { status: 404 });
  }
  const email = userRows[0].email;

  const existing = await db
    .select({ enabledAt: schema.mfaSecrets.enabledAt })
    .from(schema.mfaSecrets)
    .where(eq(schema.mfaSecrets.userId, session.userId))
    .limit(1);
  if (existing.length > 0 && existing[0].enabledAt !== null) {
    return NextResponse.json(
      { ok: false, message: 'Two-factor authentication is already enabled. Disable it first to re-enrol.' },
      { status: 409 }
    );
  }

  const secret = generateMfaSecret();
  const { plaintext: recoveryCodes, hashes: recoveryHashes } = await generateRecoveryCodes();

  await db.execute(sql`
    INSERT INTO mfa_secrets (user_id, secret, recovery_codes, enabled_at, updated_at)
    VALUES (${session.userId}, ${secret}, ${JSON.stringify(recoveryHashes)}::jsonb, NULL, NOW())
    ON CONFLICT (user_id) DO UPDATE
       SET secret = EXCLUDED.secret,
           recovery_codes = EXCLUDED.recovery_codes,
           enabled_at = NULL,
           updated_at = NOW()
  `);

  return NextResponse.json(
    {
      ok: true,
      secret,
      otpauth_url: otpauthUrl(secret, email),
      recovery_codes: recoveryCodes,
      message: 'Scan the QR code in your authenticator app, then enter a 6-digit code to confirm.',
    },
    { headers: { 'cache-control': 'private, no-store' } }
  );
}
