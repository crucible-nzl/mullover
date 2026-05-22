/**
 * POST /api/password-reset/consume   body: { token: string, password: string }
 *
 * Verifies the token, hashes the new password with argon2id, stores it, and
 * INVALIDATES all existing sessions for the user (defence: if the reset was
 * triggered because of compromise, every other device is kicked).
 *
 * Token is single-use · marked consumed on success.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import { eq, and, isNull } from 'drizzle-orm';
import { notifySecurityEvent } from '@/lib/security-notify';
import { getClientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const bodySchema = z.object({
  token: z.string().min(16).max(64),
  password: z.string().min(8, 'Password must be at least 8 characters').max(1024),
});

export async function POST(req: Request) {
  let raw: Record<string, unknown>;
  try {
    const ct = req.headers.get('content-type') ?? '';
    raw = ct.includes('application/json')
      ? ((await req.json()) as Record<string, unknown>)
      : Object.fromEntries((await req.formData()).entries());
  } catch {
    return NextResponse.json({ ok: false, message: 'Could not read request body.' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'Invalid request.';
    return NextResponse.json({ ok: false, message: msg }, { status: 422 });
  }
  const { token, password } = parsed.data;

  // Find an unconsumed, unexpired token
  const tokenRows = await db
    .select({
      token: schema.passwordResetTokens.token,
      userId: schema.passwordResetTokens.userId,
      expiresAt: schema.passwordResetTokens.expiresAt,
    })
    .from(schema.passwordResetTokens)
    .where(and(eq(schema.passwordResetTokens.token, token), isNull(schema.passwordResetTokens.consumedAt)))
    .limit(1);
  if (tokenRows.length === 0) {
    return NextResponse.json({ ok: false, message: 'This reset link is no longer valid.' }, { status: 404 });
  }
  const tk = tokenRows[0];
  if (tk.expiresAt.getTime() < Date.now()) {
    return NextResponse.json({ ok: false, message: 'This reset link has expired. Request a new one.' }, { status: 410 });
  }

  // Mark consumed BEFORE setting the password · safer
  await db
    .update(schema.passwordResetTokens)
    .set({ consumedAt: new Date() })
    .where(eq(schema.passwordResetTokens.token, token));

  const newHash = await hashPassword(password);
  await db
    .update(schema.users)
    .set({ passwordHash: newHash, updatedAt: new Date() })
    .where(eq(schema.users.id, tk.userId));

  // Wipe all sessions for the user. They will need to sign in again.
  await db.delete(schema.sessions).where(eq(schema.sessions.userId, tk.userId));

  await db.insert(schema.auditLog).values({
    actorUserId: tk.userId,
    action: 'auth.password_reset_consumed',
    targetType: 'user',
    targetId: tk.userId,
    metadata: {
      ip: req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? null,
      user_agent: req.headers.get('user-agent') ?? null,
    },
  }).catch(() => {});

  void notifySecurityEvent({
    userId: tk.userId,
    event: 'password.changed',
    ip: getClientIp(req),
    userAgent: req.headers.get('user-agent'),
  });

  return NextResponse.json(
    { ok: true, message: 'Password updated. Please sign in with the new password.' },
    { status: 200 }
  );
}
