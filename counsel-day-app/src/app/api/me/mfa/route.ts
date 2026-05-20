/**
 * GET /api/me/mfa
 *
 * Returns the current MFA state for the signed-in user:
 *   { ok, enrolled, enabled, recovery_codes_remaining }
 *
 *   · enrolled · row exists in mfa_secrets (setup started)
 *   · enabled  · enrolled AND enabled_at IS NOT NULL (setup confirmed)
 *
 * Used by /account.html to decide whether to show "Enable" or
 * "Disable" buttons.
 */

import { NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { readSession, readSessionCookie } from '@/lib/sessions';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const session = await readSession(readSessionCookie(req.headers));
  if (!session) {
    return NextResponse.json({ ok: false, message: 'You must be signed in.' }, { status: 401 });
  }
  const rows = await db
    .select({
      enabledAt: schema.mfaSecrets.enabledAt,
      recoveryCodes: schema.mfaSecrets.recoveryCodes,
    })
    .from(schema.mfaSecrets)
    .where(eq(schema.mfaSecrets.userId, session.userId))
    .limit(1);

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, enrolled: false, enabled: false, recovery_codes_remaining: 0 }, {
      headers: { 'cache-control': 'private, no-store' },
    });
  }
  const r = rows[0];
  const recoveryArr = Array.isArray(r.recoveryCodes) ? (r.recoveryCodes as unknown[]) : [];
  return NextResponse.json(
    {
      ok: true,
      enrolled: true,
      enabled: !!r.enabledAt,
      recovery_codes_remaining: recoveryArr.length,
    },
    { headers: { 'cache-control': 'private, no-store' } }
  );
}
