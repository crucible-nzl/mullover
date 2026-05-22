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
import { checkRateLimit, getClientIp, rateLimitResponse } from '@/lib/rate-limit';
import { trackAuthFailure } from '@/lib/security-alerts';
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
  // FIXME(dev-bypass · re-enable before launch · ticket pending):
  // DEV_BYPASS_AUTH_EMAIL is a TEMPORARY testing affordance · when set
  // in env.local to a single lowercased email, that address skips:
  //   (a) IP + email rate limits on /api/signin
  //   (b) the magic-link round-trip · sign-in without a password
  //       creates a session immediately
  // It does NOT skip password verification or MFA. To re-enable
  // production behaviour, remove the env var and `sudo systemctl
  // restart counsel-day-app`. Every bypass invocation is audit-logged
  // (action='auth.dev_bypass.signin') so we can see it was used.
  const bypassEmail = (process.env.DEV_BYPASS_AUTH_EMAIL ?? '').trim().toLowerCase();

  // Rate-limit by IP BEFORE we parse anything · cheapest possible
  // bail-out for abuse traffic. Per docs/SECURITY_PENTEST_2026-05-20
  // recommendation: 10 attempts per IP per hour catches email-bomb
  // flooding without trapping NATed households on a bad day.
  // Bypass: we don't know the email yet, so we can't skip IP-limit
  // based on it. We defer the IP check until after we parse, then
  // skip both checks if the bypass email matches.
  const ip = getClientIp(req);

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
  const isBypass = bypassEmail && email === bypassEmail;

  if (!isBypass) {
    const ipCheck = await checkRateLimit(`signin-ip:${ip}`, 10, 3600);
    if (!ipCheck.allowed) {
      void trackAuthFailure('signin-rate-limit', ip, { reason: 'ip_bucket', limit: 10 });
      return rateLimitResponse(ipCheck, 'Too many sign-in attempts from this network. Please wait and try again.');
    }

    // Per-email rate limit · 5/hour. Catches a targeted attack where
    // the abuser rotates IPs but always uses the same victim email.
    // Keyed by the lowercased email so all variants of capitalisation
    // share the bucket.
    const emailCheck = await checkRateLimit(`signin-email:${email}`, 5, 3600);
    if (!emailCheck.allowed) {
      void trackAuthFailure('signin-rate-limit', `email:${email}`, { reason: 'email_bucket', limit: 5 });
      // Return the same generic message · don't disclose that this is
      // an email-specific limit (which would confirm the email exists
      // or is being targeted).
      return rateLimitResponse(emailCheck, 'Too many sign-in attempts. Please wait and try again.');
    }
  }

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
      // Track for burst alerting · keyed by ip+email so a single
      // attacker hitting one account fires faster than one IP
      // probing many accounts.
      void trackAuthFailure('signin-password', `${ip}|${email}`, { reason: 'wrong_password' });
      // Generic message · no enumeration
      return NextResponse.json({ ok: false, message: 'That email and password did not match.' }, { status: 401 });
    }

    // MFA check · if the user has MFA enabled, mint a challenge token
    // and return mfa_required so the client prompts for a TOTP code.
    // The session is NOT created here · /api/signin/mfa-verify does
    // that after the second factor passes.
    const mfaRows = await db
      .select({ enabledAt: schema.mfaSecrets.enabledAt })
      .from(schema.mfaSecrets)
      .where(eq(schema.mfaSecrets.userId, user.id))
      .limit(1);
    if (mfaRows[0]?.enabledAt) {
      const { newChallengeId } = await import('@/lib/mfa');
      const challengeId = newChallengeId();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
      await db.insert(schema.mfaChallenges).values({ id: challengeId, userId: user.id, expiresAt });
      return NextResponse.json(
        { ok: true, mfa_required: true, challenge: challengeId, message: 'Enter the 6-digit code from your authenticator app.' },
        { status: 200, headers: { 'cache-control': 'private, no-store' } }
      );
    }

    const ctx = ctxFromHeaders(req.headers);
    const session = await createSession(user.id, ctx);
    await db.insert(schema.auditLog).values({
      actorUserId: user.id,
      action: 'auth.signin.password',
      targetType: 'user',
      targetId: user.id,
      metadata: { ip, user_agent: ctx.userAgent ?? null },
    }).catch(() => {});
    const res = NextResponse.json({ ok: true, redirect: '/account' }, { status: 200 });
    res.headers.set('set-cookie', buildSessionCookie(session.id, session.expiresAt));
    return res;
  }

  // ---- Path B · Magic link (no password supplied, or user has no password set) ----
  // We always return the same "check your inbox" response, regardless of
  // whether the user exists. No enumeration.
  //
  // FIXME(dev-bypass): when DEV_BYPASS_AUTH_EMAIL matches, skip the
  // magic-link round-trip and create a session immediately. ONLY
  // applies to the single bypass email; every other address still
  // goes through the inbox check. Remove the env var to restore
  // production behaviour.
  if (isBypass && user) {
    const ctx = ctxFromHeaders(req.headers);
    const session = await createSession(user.id, ctx);
    await db.insert(schema.auditLog).values({
      actorUserId: user.id,
      action: 'auth.dev_bypass.signin',
      targetType: 'user',
      targetId: user.id,
      metadata: { ip, user_agent: ctx.userAgent ?? null, note: 'DEV_BYPASS_AUTH_EMAIL active · magic-link skipped' },
    }).catch(() => {});
    const res = NextResponse.json({ ok: true, redirect: '/account', dev_bypass: true }, { status: 200 });
    res.headers.set('set-cookie', buildSessionCookie(session.id, session.expiresAt));
    return res;
  }

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
  return NextResponse.json({ ok: true, message: 'Your sign-in link has been sent to your inbox.' }, { status: 200 });
}
