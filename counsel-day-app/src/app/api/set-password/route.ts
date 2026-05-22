/**
 * POST /api/set-password
 *   password         (required · 8-1024 chars)
 *   current_password (required only if the user already has one set)
 *
 * Requires an active session. Used:
 *   - first time, from /account, to add a password to a magic-link account
 *   - subsequent times, to rotate the password (current_password required)
 *
 * On success: invalidates all OTHER sessions for the user (defence: if the
 * password was changed because of compromise, every other device is kicked).
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@/lib/db';
import { hashPassword, verifyPassword } from '@/lib/auth';
import { readSession, readSessionCookie } from '@/lib/sessions';
import { eq, ne, and } from 'drizzle-orm';
import { notifySecurityEvent } from '@/lib/security-notify';
import { getClientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const bodySchema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters').max(1024),
  current_password: z.string().max(1024).optional(),
});

export async function POST(req: Request) {
  // ---- auth ----
  const sessionId = readSessionCookie(req.headers);
  const session = await readSession(sessionId);
  if (!session) {
    return NextResponse.json({ ok: false, message: 'You must be signed in.' }, { status: 401 });
  }
  const userId = session.userId;

  // ---- parse ----
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
    const msg = parsed.error.issues[0]?.message ?? 'Invalid password.';
    return NextResponse.json({ ok: false, message: msg }, { status: 422 });
  }
  const { password, current_password } = parsed.data;

  // ---- if user has an existing password, verify it before rotation ----
  const userRows = await db
    .select({ passwordHash: schema.users.passwordHash })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (userRows.length === 0) {
    return NextResponse.json({ ok: false, message: 'Account not found.' }, { status: 404 });
  }
  const existingHash = userRows[0].passwordHash;
  if (existingHash) {
    if (!current_password) {
      return NextResponse.json({ ok: false, message: 'Current password is required to change it.' }, { status: 422 });
    }
    const ok = await verifyPassword(existingHash, current_password);
    if (!ok) {
      return NextResponse.json({ ok: false, message: 'Current password did not match.' }, { status: 401 });
    }
  }

  // ---- hash + store ----
  const newHash = await hashPassword(password);
  await db
    .update(schema.users)
    .set({ passwordHash: newHash, updatedAt: new Date() })
    .where(eq(schema.users.id, userId));

  // ---- security · invalidate every OTHER session for this user ----
  if (sessionId) {
    await db
      .delete(schema.sessions)
      .where(and(eq(schema.sessions.userId, userId), ne(schema.sessions.id, sessionId)));
  }

  // ---- security notification email · catches takeover in real time ----
  void notifySecurityEvent({
    userId,
    event: existingHash ? 'password.changed' : 'password.set_first_time',
    ip: getClientIp(req),
    userAgent: req.headers.get('user-agent'),
  });

  return NextResponse.json({ ok: true, message: 'Password updated.' }, { status: 200 });
}
