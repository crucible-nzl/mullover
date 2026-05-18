/**
 * POST /api/signin  (form-encoded or JSON)
 *   email          (required)
 *   password       (optional · if absent we email a magic-link instead)
 *
 * Two paths:
 *   1. PASSWORD: argon2-verify against users.password_hash. If pass, create
 *      session, set cookie, return { ok:true, redirect:'/account' }.
 *   2. MAGIC LINK: if no password supplied OR user has no password_hash,
 *      issue a verification token (same shape as signup) and email it.
 *      Returns { ok:true, message:'Check your inbox.' } either way · we do
 *      not disclose whether the email exists.
 *
 * All failures return a single generic message to avoid user-enumeration.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@/lib/db';
import { verifyPassword } from '@/lib/auth';
import { createSession, ctxFromHeaders, buildSessionCookie } from '@/lib/sessions';
import { sendTransactional, buildVerificationEmail } from '@/lib/email';
import { newToken } from '@/lib/tokens';
import { eq, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const VERIFICATION_TTL_MS = 60 * 60 * 1000; // 1 hour
const BASE = process.env.APP_BASE_URL ?? 'https://counsel.day';

const signinSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(1024).optional(),
});

export async function POST(req: Request) {
  // Parse body (multipart, urlencoded, or JSON)
  let raw: Record<string, unknown>;
  try {
    const ct = req.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      raw = (await req.json()) as Record<string, unknown>;
    } else {
      const fd = await req.formData();
      raw = Object.fromEntries(fd.entries());
    }
  } catch {
    return NextResponse.json({ ok: false, message: 'Could not read request body.' }, { status: 400 });
  }

  const parsed = signinSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: 'Please enter a valid email address.' }, { status: 422 });
  }
  const { email, password } = parsed.data;

  // Look up user · case-insensitive. Soft-deleted accounts cannot sign in
  // (GDPR Article 17 · deleted_at IS NULL filter); the grace window keeps
  // the row in case the user emails to restore.
  const rows = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      firstName: schema.users.firstName,
      passwordHash: schema.users.passwordHash,
      deletedAt: schema.users.deletedAt,
    })
    .from(schema.users)
    .where(eq(sql`LOWER(${schema.users.email})`, email))
    .limit(1);
  const user = rows[0] && rows[0].deletedAt === null ? rows[0] : undefined;

  // ---- Path A · Password sign-in ----
  if (password && user?.passwordHash) {
    const ok = await verifyPassword(user.passwordHash, password);
    if (!ok) {
      // Generic message · no enumeration
      return NextResponse.json({ ok: false, message: 'That email and password did not match.' }, { status: 401 });
    }
    const ctx = ctxFromHeaders(req.headers);
    const session = await createSession(user.id, ctx);
    const res = NextResponse.json({ ok: true, redirect: '/account' }, { status: 200 });
    res.headers.set('set-cookie', buildSessionCookie(session.id, session.expiresAt));
    return res;
  }

  // ---- Path B · Magic link (no password supplied, or user has no password set) ----
  // We always return the same "check your inbox" response, regardless of
  // whether the user exists. No enumeration.
  if (user) {
    const token = newToken();
    const expiresAt = new Date(Date.now() + VERIFICATION_TTL_MS);
    await db.insert(schema.emailVerificationTokens).values({
      token,
      userId: user.id,
      email: user.email,
      expiresAt,
    });
    const verifyUrl = `${BASE}/api/verify?token=${encodeURIComponent(token)}`;
    const { text, html } = buildVerificationEmail({
      firstName: user.firstName ?? '',
      verifyUrl,
    });
    await sendTransactional({
      to: { email: user.email, name: user.firstName ?? undefined },
      subject: 'Sign in to Counsel.day',
      textContent: text,
      htmlContent: html,
    });
  }
  return NextResponse.json({ ok: true, message: 'Check your inbox.' }, { status: 200 });
}
