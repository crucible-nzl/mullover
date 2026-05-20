/**
 * POST /api/me/mfa/step-up
 * Body: { code: '123456' }
 *
 * Re-verifies the signed-in user's TOTP without going through full
 * sign-in. On success, sets sessions.mfa_verified_at = NOW(), which
 * extends the fresh-MFA window for the current session by 5 minutes
 * (per FRESH_MFA_WINDOW_SECONDS in lib/admin-auth.ts).
 *
 * Triggered by the admin UI when a destructive action returns
 * { mfa_step_up_required: true }. After a successful step-up, the
 * admin UI replays the original action.
 *
 * Accepts a TOTP from the authenticator app OR a recovery code.
 * Recovery codes are consumed on use just like during sign-in.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@/lib/db';
import { readSession, readSessionCookie } from '@/lib/sessions';
import { verifyTotpCode, verifyRecoveryCode } from '@/lib/mfa';
import { trackAuthFailure } from '@/lib/security-alerts';
import { getClientIp } from '@/lib/rate-limit';
import { eq, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const bodySchema = z.object({ code: z.string().trim().min(6).max(20) });

export async function POST(req: Request) {
  const sessionId = readSessionCookie(req.headers);
  const session = await readSession(sessionId);
  if (!session || !sessionId) {
    return NextResponse.json({ ok: false, message: 'You must be signed in.' }, { status: 401 });
  }

  let raw: unknown;
  try { raw = await req.json(); } catch {
    return NextResponse.json({ ok: false, message: 'Body must be JSON.' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: 'Provide a 6-digit code.' }, { status: 422 });
  }

  const mfaRows = await db
    .select({ secret: schema.mfaSecrets.secret, recoveryCodes: schema.mfaSecrets.recoveryCodes, enabledAt: schema.mfaSecrets.enabledAt })
    .from(schema.mfaSecrets)
    .where(eq(schema.mfaSecrets.userId, session.userId))
    .limit(1);
  if (mfaRows.length === 0 || mfaRows[0].enabledAt === null) {
    return NextResponse.json({ ok: false, message: 'MFA is not enabled on your account.' }, { status: 409 });
  }
  const mfa = mfaRows[0];

  let verified = verifyTotpCode(mfa.secret, parsed.data.code);
  let recoveryIdx = -1;
  if (!verified) {
    const arr = Array.isArray(mfa.recoveryCodes) ? (mfa.recoveryCodes as string[]) : [];
    recoveryIdx = await verifyRecoveryCode(parsed.data.code, arr);
    verified = recoveryIdx !== -1;
  }

  if (!verified) {
    void trackAuthFailure('mfa-step-up', `${getClientIp(req)}|${session.userId}`, { reason: 'wrong_code' });
    return NextResponse.json({ ok: false, message: 'Code not accepted.' }, { status: 401 });
  }

  await db.execute(sql`UPDATE sessions SET mfa_verified_at = NOW() WHERE id = ${sessionId}`);
  await db.execute(sql`UPDATE mfa_secrets SET last_used_at = NOW() WHERE user_id = ${session.userId}`).catch(() => {});

  if (recoveryIdx !== -1) {
    const arr = (mfa.recoveryCodes as string[]).slice();
    arr.splice(recoveryIdx, 1);
    await db.execute(sql`UPDATE mfa_secrets SET recovery_codes = ${JSON.stringify(arr)}::jsonb, updated_at = NOW() WHERE user_id = ${session.userId}`);
    await db.insert(schema.auditLog).values({
      actorUserId: session.userId,
      action: 'mfa.recovery_code_used',
      targetType: 'user',
      targetId: session.userId,
      metadata: { context: 'step_up', remaining_codes: arr.length },
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true, message: 'Step-up verified.' });
}
