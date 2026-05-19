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
import { eq, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const VERIFICATION_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function POST(req: Request) {
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

  // --- reCAPTCHA verification (skipped if secret not set; tracked in audit) ---
  const recaptchaSecret = process.env.RECAPTCHA_V3_SECRET_KEY;
  if (recaptchaSecret && input.g_recaptcha_token) {
    try {
      const v = await fetch('https://www.google.com/recaptcha/api/siteverify', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          secret: recaptchaSecret,
          response: input.g_recaptcha_token,
        }),
      }).then((r) => r.json() as Promise<{ success: boolean; score?: number }>);
      if (!v.success || (v.score ?? 0) < 0.5) {
        return NextResponse.json(
          { ok: false, message: 'reCAPTCHA failed. Please try again.' },
          { status: 403 }
        );
      }
    } catch {
      // If the verify endpoint itself fails, fail open with audit. We do
      // not block legitimate signups because Google is unreachable.
      console.warn('[signup] reCAPTCHA verify unreachable; allowing through');
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
  } catch (err) {
    console.warn('[signup] consent log insert failed (non-fatal)', err);
  }

  return NextResponse.json({ ok: true, message: 'Your verification link has been sent to your inbox.' }, { status: 200 });
}
