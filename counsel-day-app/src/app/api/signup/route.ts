/**
 * POST /api/signup
 *
 * Wires the form at /signup.html to the database. Creates a user row in
 * the unverified state, issues a 1-hour email verification token, and
 * (when BREVO_API_KEY is set) sends the verification email.
 *
 * The form fires this endpoint with multipart/form-data:
 *   - first_name        (required)
 *   - email             (required)
 *   - decision_kind     (optional: solo|couple|family|exploring)
 *   - marketing_consent (optional: 'yes' or unchecked)
 *   - g_recaptcha_token (optional today; will be verified server-side
 *                        once RECAPTCHA_V3_SECRET_KEY is set)
 *
 * Response shape:
 *   { ok: true, message: 'Check your inbox.' }                      · success
 *   { ok: false, field_errors: { email: '...' } }                   · validation
 *   { ok: false, message: '...' }                                   · server error
 */

import { NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { signupSchema } from '@/lib/validators';
import { sendTransactional, buildVerificationEmail } from '@/lib/email';
import { newToken } from '@/lib/tokens';
import { checkRateLimit, getClientIp, rateLimitResponse } from '@/lib/rate-limit';
import { eq, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const VERIFICATION_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function POST(req: Request) {
  // --- Rate limit by IP · 5 signups per hour per IP ---
  // Per docs/SECURITY_PENTEST_2026-05-20.md item 8.2. Cheap bail-out
  // for abuse traffic; runs before body parse + reCAPTCHA + DB lookup.
  const ip = getClientIp(req);
  const ipCheck = await checkRateLimit(`signup-ip:${ip}`, 5, 3600);
  if (!ipCheck.allowed) {
    return rateLimitResponse(ipCheck, 'Too many signup attempts from this network. Please wait and try again.');
  }

  // --- Parse the form ---
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

  // --- Validate ---
  const parsed = signupSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0]?.toString() ?? 'form';
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return NextResponse.json({ ok: false, field_errors: fieldErrors }, { status: 422 });
  }
  const input = parsed.data;

  // --- reCAPTCHA verification (signup) ---
  // When RECAPTCHA_V3_SECRET_KEY is set the token is REQUIRED. Previous
  // behaviour silently bypassed verification when the token was absent,
  // which a bot could exploit by simply omitting the field.
  // Fail-open policy: if Google's verify API itself is unreachable, we
  // allow the signup through but write an audit_log row flagged for
  // operator review. Per docs/SECURITY_PENTEST_2026-05-20.md.
  let recaptchaFlag: string | null = null;
  const recaptchaSecret = process.env.RECAPTCHA_V3_SECRET_KEY;
  if (recaptchaSecret) {
    if (!input.g_recaptcha_token) {
      return NextResponse.json(
        { ok: false, message: 'Verification challenge missing. Please reload the page and try again.' },
        { status: 422 }
      );
    }
    try {
      const v = await fetch('https://www.google.com/recaptcha/api/siteverify', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          secret: recaptchaSecret,
          response: input.g_recaptcha_token,
        }),
      }).then((r) => r.json() as Promise<{ success: boolean; score?: number; action?: string; 'error-codes'?: string[] }>);
      if (!v.success) {
        return NextResponse.json(
          { ok: false, message: 'Verification challenge could not be validated. Please reload and try again.' },
          { status: 403 }
        );
      }
      const score = v.score ?? 0;
      if (score < 0.5) {
        // Hard reject below 0.5 · likely bot
        return NextResponse.json(
          { ok: false, message: 'Verification challenge failed. If this keeps happening please contact help@counsel.day.' },
          { status: 403 }
        );
      }
      // Mid-confidence scores get audit-logged but the signup proceeds.
      if (score < 0.7) recaptchaFlag = `low_confidence_score_${score.toFixed(2)}`;
    } catch (err) {
      // Google API unreachable · fail-open with audit (operator review).
      recaptchaFlag = 'recaptcha_unavailable';
      console.warn('[signup] reCAPTCHA verify unreachable; allowing through', err);
    }
  }

  // --- Insert (or short-circuit if email already exists) ---
  // Important: we do NOT reveal whether the email already exists.
  // The user sees the same success message either way.
  let userId: string;
  try {
    const existing = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(sql`LOWER(${schema.users.email})`, input.email.toLowerCase()))
      .limit(1);

    if (existing.length > 0) {
      // Resend a fresh verification token instead of returning an error.
      userId = existing[0].id;
    } else {
      const inserted = await db
        .insert(schema.users)
        .values({
          email: input.email,
          firstName: input.first_name,
          marketingConsent: input.marketing_consent,
          decisionKindIntent: input.decision_kind ?? null,
          currentPlan: 'free',
        })
        .returning({ id: schema.users.id });
      userId = inserted[0].id;
    }
  } catch (err) {
    console.error('[signup] db insert failed', err);
    return NextResponse.json(
      { ok: false, message: 'We could not create your account. Please try again.' },
      { status: 500 }
    );
  }

  // --- Issue verification token + send email ---
  const token = newToken();
  const expiresAt = new Date(Date.now() + VERIFICATION_TTL_MS);
  try {
    await db.insert(schema.emailVerificationTokens).values({
      token,
      userId,
      email: input.email,
      expiresAt,
    });
  } catch (err) {
    console.error('[signup] token insert failed', err);
    return NextResponse.json(
      { ok: false, message: 'We could not issue a verification link. Please try again.' },
      { status: 500 }
    );
  }

  const baseUrl = process.env.APP_BASE_URL ?? 'https://counsel.day';
  const verifyUrl = `${baseUrl}/api/verify?token=${encodeURIComponent(token)}`;
  const { text, html } = buildVerificationEmail({ firstName: input.first_name, verifyUrl });

  await sendTransactional({
    to: { email: input.email, name: input.first_name },
    subject: 'Verify your Counsel.day account',
    textContent: text,
    htmlContent: html,
  });

  // --- Audit consent decision (separate row from the user record) ---
  try {
    await db.insert(schema.consentLog).values([
      {
        userId,
        consentType: 'marketing',
        granted: input.marketing_consent,
        source: 'signup',
        ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? null,
        userAgent: req.headers.get('user-agent') ?? null,
      },
      {
        userId,
        consentType: 'tos',
        granted: true,
        source: 'signup',
        ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? null,
        userAgent: req.headers.get('user-agent') ?? null,
      },
    ]);
    if (recaptchaFlag) {
      await db.insert(schema.auditLog).values({
        actorUserId: userId,
        action: 'signup.recaptcha_flag',
        targetType: 'user',
        targetId: userId,
        metadata: { flag: recaptchaFlag },
      });
    }
  } catch (err) {
    console.warn('[signup] consent log insert failed (non-fatal)', err);
  }

  await db.insert(schema.auditLog).values({
    actorUserId: userId,
    action: 'auth.signup',
    targetType: 'user',
    targetId: userId,
    metadata: {
      ip: req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? null,
      user_agent: req.headers.get('user-agent') ?? null,
      marketing_consent: input.marketing_consent,
    },
  }).catch(() => {});

  return NextResponse.json({ ok: true, message: 'Your verification link has been sent to your inbox.' }, { status: 200 });
}
