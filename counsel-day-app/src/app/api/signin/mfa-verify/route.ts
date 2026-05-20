/**
 * POST /api/signin/mfa-verify
 * Body: { challenge: 'xxx', code: '123456' }
 *
 * Completes a two-step sign-in. Called after /api/signin returned
 * { mfa_required: true, challenge }. Verifies the TOTP (or recovery
 * code) against the user that owns the challenge, then creates the
 * session cookie.
 *
 * Challenges:
 *   · TTL 5 minutes (rows older than that are ignored)
 *   · single-use (deleted on success)
 *   · 5-attempt cap (deleted on exhaustion · attacker has to re-do
 *     password verify to get a fresh challenge)
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@/lib/db';
import { createSession, ctxFromHeaders, buildSessionCookie } from '@/lib/sessions';
import { verifyTotpCode, verifyRecoveryCode } from '@/lib/mfa';
import { trackAuthFailure } from '@/lib/security-alerts';
import { getClientIp } from '@/lib/rate-limit';
import { and, eq, gt, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const bodySchema = z.object({
  challenge: z.string().min(16).max(64),
  code: z.string().trim().min(6).max(20),
});

export async function POST(req: Request) {
  const ip = getClientIp(req);

  let raw: unknown;
  try { raw = await req.json(); } catch {
    return NextResponse.json({ ok: false, message: 'Body must be JSON.' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: 'Provide challenge and code.' }, { status: 422 });
  }
  const { challenge, code } = parsed.data;

  // Look up the challenge · must exist and not be expired.
  const chRows = await db
    .select({ id: schema.mfaChallenges.id, userId: schema.mfaChallenges.userId, attempts: schema.mfaChallenges.attempts })
    .from(schema.mfaChallenges)
    .where(and(eq(schema.mfaChallenges.id, challenge), gt(schema.mfaChallenges.expiresAt, new Date())))
    .limit(1);
  if (chRows.length === 0) {
    void trackAuthFailure('signin-mfa', ip, { reason: 'challenge_invalid_or_expired' });
    return NextResponse.json({ ok: false, message: 'That sign-in session has expired. Start sign-in again.' }, { status: 401 });
  }
  const ch = chRows[0];

  if (ch.attempts >= 5) {
    await db.delete(schema.mfaChallenges).where(eq(schema.mfaChallenges.id, challenge));
    void trackAuthFailure('signin-mfa', ip, { reason: 'attempts_exhausted', user_id: ch.userId });
    return NextResponse.json({ ok: false, message: 'Too many code attempts. Start sign-in again.' }, { status: 401 });
  }

  // Look up the secret + recovery codes
  const mfaRows = await db
    .select({ secret: schema.mfaSecrets.secret, recoveryCodes: schema.mfaSecrets.recoveryCodes })
    .from(schema.mfaSecrets)
    .where(eq(schema.mfaSecrets.userId, ch.userId))
    .limit(1);
  if (mfaRows.length === 0) {
    // Shouldn't happen · challenge implies MFA enrolment · scrub & bail
    await db.delete(schema.mfaChallenges).where(eq(schema.mfaChallenges.id, challenge));
    return NextResponse.json({ ok: false, message: 'MFA misconfiguration. Contact help@counsel.day.' }, { status: 500 });
  }
  const mfa = mfaRows[0];

  let verified = verifyTotpCode(mfa.secret, code);
  let recoveryIdx = -1;
  if (!verified) {
    const arr = Array.isArray(mfa.recoveryCodes) ? (mfa.recoveryCodes as string[]) : [];
    recoveryIdx = await verifyRecoveryCode(code, arr);
    verified = recoveryIdx !== -1;
  }

  if (!verified) {
    // Increment attempts counter
    await db.execute(sql`UPDATE mfa_challenges SET attempts = attempts + 1 WHERE id = ${challenge}`);
    void trackAuthFailure('signin-mfa', ip, { reason: 'wrong_code', user_id: ch.userId });
    return NextResponse.json({ ok: false, message: 'Code not accepted. Try the next one your app shows.' }, { status: 401 });
  }

  // Code accepted · consume the challenge, consume the recovery
  // code if used, create the session.
  await db.delete(schema.mfaChallenges).where(eq(schema.mfaChallenges.id, challenge));
  await db.execute(sql`UPDATE mfa_secrets SET last_used_at = NOW() WHERE user_id = ${ch.userId}`);

  if (recoveryIdx !== -1) {
    // Remove the consumed code from the array · single use
    const arr = (mfa.recoveryCodes as string[]).slice();
    arr.splice(recoveryIdx, 1);
    await db.execute(sql`UPDATE mfa_secrets SET recovery_codes = ${JSON.stringify(arr)}::jsonb, updated_at = NOW() WHERE user_id = ${ch.userId}`);
    await db.insert(schema.auditLog).values({
      actorUserId: ch.userId,
      action: 'mfa.recovery_code_used',
      targetType: 'user',
      targetId: ch.userId,
      metadata: { remaining_codes: arr.length },
    }).catch(() => {});
  }

  const ctx = ctxFromHeaders(req.headers);
  const session = await createSession(ch.userId, ctx);
  const res = NextResponse.json({ ok: true, redirect: '/account' }, { status: 200 });
  res.headers.set('set-cookie', buildSessionCookie(session.id, session.expiresAt));
  return res;
}
