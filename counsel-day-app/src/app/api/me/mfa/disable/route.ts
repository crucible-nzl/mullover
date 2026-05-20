/**
 * POST /api/me/mfa/disable
 *
 * Body: { code: '123456' }     (a current TOTP or recovery code)
 *
 * Disables MFA for the signed-in user. Requires a valid TOTP code
 * (or recovery code) · prevents an attacker who has hijacked an
 * active session from silently turning off the second factor.
 *
 * On success, the entire mfa_secrets row is deleted. Re-enrolling
 * requires going through /api/me/mfa/setup again from scratch.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@/lib/db';
import { readSession, readSessionCookie } from '@/lib/sessions';
import { verifyTotpCode, verifyRecoveryCode } from '@/lib/mfa';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const bodySchema = z.object({ code: z.string().trim().min(6).max(20) });

export async function POST(req: Request) {
  const session = await readSession(readSessionCookie(req.headers));
  if (!session) {
    return NextResponse.json({ ok: false, message: 'You must be signed in.' }, { status: 401 });
  }

  let raw: unknown;
  try { raw = await req.json(); } catch {
    return NextResponse.json({ ok: false, message: 'Body must be JSON.' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: 'Provide your current code.' }, { status: 422 });
  }

  const rows = await db
    .select({ secret: schema.mfaSecrets.secret, recoveryCodes: schema.mfaSecrets.recoveryCodes, enabledAt: schema.mfaSecrets.enabledAt })
    .from(schema.mfaSecrets)
    .where(eq(schema.mfaSecrets.userId, session.userId))
    .limit(1);
  if (rows.length === 0 || rows[0].enabledAt === null) {
    return NextResponse.json({ ok: false, message: 'MFA is not enabled.' }, { status: 409 });
  }
  const row = rows[0];

  let verified = verifyTotpCode(row.secret, parsed.data.code);
  let recoveryConsumedIdx = -1;
  if (!verified) {
    const arr = Array.isArray(row.recoveryCodes) ? (row.recoveryCodes as string[]) : [];
    recoveryConsumedIdx = await verifyRecoveryCode(parsed.data.code, arr);
    verified = recoveryConsumedIdx !== -1;
  }
  if (!verified) {
    return NextResponse.json({ ok: false, message: 'Code not accepted.' }, { status: 401 });
  }

  await db.delete(schema.mfaSecrets).where(eq(schema.mfaSecrets.userId, session.userId));
  await db.insert(schema.auditLog).values({
    actorUserId: session.userId,
    action: 'mfa.disabled',
    targetType: 'user',
    targetId: session.userId,
    metadata: { used_recovery_code: recoveryConsumedIdx !== -1 },
  }).catch(() => {});

  return NextResponse.json({ ok: true, message: 'Two-factor authentication has been disabled.' });
}
