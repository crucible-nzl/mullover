/**
 * POST /api/me/mfa/verify-setup
 *
 * Body: { code: '123456' }
 *
 * Confirms the user can produce a valid TOTP code from the secret
 * created by /api/me/mfa/setup. On success, flips enabled_at to
 * NOW() · MFA is now active for sign-in.
 *
 * Lock-out protection: this endpoint is the only way to enable
 * MFA. If the user can't produce a valid code (lost their phone
 * before confirming), they simply never enable it.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@/lib/db';
import { readSession, readSessionCookie } from '@/lib/sessions';
import { verifyTotpCode } from '@/lib/mfa';
import { eq, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const bodySchema = z.object({ code: z.string().trim().min(6).max(8) });

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
    return NextResponse.json({ ok: false, message: 'Provide a 6-digit code.' }, { status: 422 });
  }

  const rows = await db
    .select({ secret: schema.mfaSecrets.secret, enabledAt: schema.mfaSecrets.enabledAt })
    .from(schema.mfaSecrets)
    .where(eq(schema.mfaSecrets.userId, session.userId))
    .limit(1);
  if (rows.length === 0) {
    return NextResponse.json(
      { ok: false, message: 'No pending MFA setup. Call /api/me/mfa/setup first.' },
      { status: 409 }
    );
  }
  if (rows[0].enabledAt !== null) {
    return NextResponse.json({ ok: false, message: 'MFA is already enabled.' }, { status: 409 });
  }

  if (!verifyTotpCode(rows[0].secret, parsed.data.code)) {
    return NextResponse.json({ ok: false, message: 'That code did not match. Try the next one your app shows.' }, { status: 401 });
  }

  await db.execute(sql`
    UPDATE mfa_secrets SET enabled_at = NOW(), last_used_at = NOW(), updated_at = NOW()
    WHERE user_id = ${session.userId}
  `);
  await db.insert(schema.auditLog).values({
    actorUserId: session.userId,
    action: 'mfa.enabled',
    targetType: 'user',
    targetId: session.userId,
  }).catch(() => {});

  return NextResponse.json({ ok: true, message: 'Two-factor authentication is now enabled.' });
}
