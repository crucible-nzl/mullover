/**
 * POST /api/compose/guest · "Sign up by composing one"
 *
 * Strategic 3/3 · the pre-paid Solo signup flow. A visitor who hasn't
 * signed up can land on /start-with-question.html, type a question +
 * email, and submit. We create the user account, sign them in via a
 * fresh session cookie, create the decision in pending_payment (or
 * active for solo_free), issue an email-verification token, and send
 * the magic-link. They never have to "verify before doing".
 *
 * Feature-flag gated · ENABLE_COMPOSE_FIRST_SIGNUP. Returns 404 when off.
 *
 * Body:
 *   {
 *     email: string,
 *     first_name: string,
 *     question: string,
 *     tier: 'solo_free' | 'solo_paid',  // only Solo on the guest path
 *     format: 'yes_no' | 'strong_lean' | 'a_b',
 *     duration_days: number             // 7-90
 *   }
 *
 * Response:
 *   { ok: true, decision_id, user_id, status, requires_payment, redirect }
 *
 * Limitations vs the normal /api/compose:
 *   · Solo only · no partner_email, no Couple/Family tiers (those need email-
 *     verified invitees, which can't happen on the guest path)
 *   · No attached-decision picker · the guest has no prior decisions
 *   · No pulse_mode · keep the surface area small for the experiment
 *
 * Persisted side-effects:
 *   1. users · new row, currentPlan='free', emailVerifiedAt=null
 *   2. sessions · new row + cookie set
 *   3. decisions · status='active' (solo_free) or 'pending_payment' (solo_paid)
 *   4. participants · self as owner
 *   5. email_verification_tokens · so the user can confirm email later
 *   6. transactional email · magic-link verification
 *   7. audit_log · 'guest.compose.created'
 *
 * Existing /api/signup remains the canonical signup path; this is a
 * parallel surface for the experiment.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@/lib/db';
import { isFeatureEnabled } from '@/lib/feature-flags';
import { createSession, ctxFromHeaders, buildSessionCookie } from '@/lib/sessions';
import { sendTransactional, buildVerificationEmail } from '@/lib/email';
import { newToken } from '@/lib/tokens';
import { checkRateLimit, getClientIp, rateLimitResponse } from '@/lib/rate-limit';
import { eq, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const VERIFICATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;  // 7 days

const bodySchema = z.object({
  email:         z.string().trim().toLowerCase().email().max(200),
  first_name:    z.string().trim().min(1).max(80),
  question:      z.string().trim().min(10).max(240),
  tier:          z.enum(['solo_free', 'solo_paid']),
  format:        z.enum(['yes_no', 'strong_lean', 'a_b']),
  duration_days: z.coerce.number().int().min(7).max(90),
});

export async function POST(req: Request) {
  // 1. Gate · feature flag off → not found.
  if (!isFeatureEnabled('COMPOSE_FIRST_SIGNUP')) {
    return NextResponse.json({ ok: false, message: 'Not found.' }, { status: 404 });
  }

  // 2. Rate-limit · same window as /api/signup (5/hr/IP) to deter abuse.
  const ip = getClientIp(req);
  const rl = await checkRateLimit(`guest-compose:${ip || 'unknown'}`, 5, 3600);
  if (!rl.allowed) return rateLimitResponse(rl, 'Too many submissions from this address.');

  // 3. Parse + validate
  let raw: unknown;
  try { raw = await req.json(); } catch {
    return NextResponse.json({ ok: false, message: 'Body must be JSON.' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: 'Some fields need a second look.', field_errors: parsed.error.flatten().fieldErrors },
      { status: 422 },
    );
  }
  const input = parsed.data;

  // 4. Find or create user. If the email already exists, abort with a
  //    sensible message rather than silently merging · the guest path
  //    is for first-time visitors. The existing /api/signup handles
  //    returning-user resends.
  let userId: string;
  let isFirstTime: boolean;
  let solo_free_already_used = false;
  try {
    const existing = await db
      .select({ id: schema.users.id, emailVerifiedAt: schema.users.emailVerifiedAt })
      .from(schema.users)
      .where(eq(schema.users.email, input.email))
      .limit(1);
    if (existing.length > 0) {
      // Returning user · don't create a duplicate. Tell them to use the
      // normal sign-in path. The flag-gated path doesn't try to merge.
      return NextResponse.json(
        { ok: false, message: 'That email already has an account. Sign in to open the decision from there.', redirect: '/signin?next=/compose.html' },
        { status: 409 },
      );
    }
    const inserted = await db.insert(schema.users).values({
      email: input.email,
      firstName: input.first_name,
      currentPlan: 'free',
    }).returning({ id: schema.users.id });
    userId = inserted[0].id;
    isFirstTime = true;
  } catch (e) {
    console.error('[guest-compose] user insert failed', e);
    return NextResponse.json({ ok: false, message: 'We could not create your account.' }, { status: 500 });
  }

  // 5. Decide the decision status. Solo Free is active immediately;
  //    Solo Paid waits for the Stripe webhook (status='pending_payment').
  //    Mirror the contract on /api/compose.
  const status = input.tier === 'solo_free' ? 'active' : 'pending_payment';
  let decisionId: string;
  try {
    const inserted = await db.insert(schema.decisions).values({
      ownerUserId: userId,
      question: input.question,
      tier: input.tier,
      format: input.format,
      durationDays: input.duration_days,
      status,
      startsAt: new Date(),
      unsealsAt: new Date(Date.now() + input.duration_days * 86_400_000),
    }).returning({ id: schema.decisions.id });
    decisionId = inserted[0].id;
  } catch (e) {
    console.error('[guest-compose] decision insert failed', e);
    return NextResponse.json({ ok: false, message: 'We could not create the decision.' }, { status: 500 });
  }

  // 6. Owner participant row · same pattern as /api/compose. Position
  //    1 is owner-by-convention; invite columns stay null for the
  //    owner row.
  try {
    await db.insert(schema.participants).values({
      decisionId,
      userId,
      displayName: input.first_name,
      position: 1,
    });
  } catch (e) {
    console.warn('[guest-compose] participant insert failed', e);
  }

  // 7. Email-verification token + send magic-link email. Verification
  //    is not a gate for using the product · the user is auto-signed-in
  //    via the session cookie below · but they need to verify before we
  //    let them invite anyone or charge their card.
  const token = newToken();
  try {
    await db.insert(schema.emailVerificationTokens).values({
      token,
      userId,
      email: input.email,
      expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS),
    });
    const baseUrl = process.env.APP_BASE_URL ?? 'https://counsel.day';
    const verifyUrl = `${baseUrl}/api/verify?token=${encodeURIComponent(token)}`;
    const { text, html } = buildVerificationEmail({ firstName: input.first_name, verifyUrl });
    await sendTransactional({
      to: { email: input.email, name: input.first_name },
      subject: 'Welcome · verify your Counsel.day account',
      textContent: text,
      htmlContent: html,
    });
  } catch (e) {
    console.warn('[guest-compose] verification email failed', e);
    // Non-fatal · the user can request a new verification link later.
  }

  // 8. Create session + cookie · auto-sign-in.
  const ctx = ctxFromHeaders(req.headers);
  const session = await createSession(userId, ctx);
  const cookie = buildSessionCookie(session.id, session.expiresAt);

  // 9. Audit
  try {
    await db.execute(sql`
      INSERT INTO audit_log (action, target_type, target_id, actor_user_id, metadata)
      VALUES ('guest.compose.created', 'decision', ${decisionId}, ${userId},
        ${JSON.stringify({ tier: input.tier, format: input.format, duration_days: input.duration_days })}::jsonb)
    `);
  } catch (e) {
    console.warn('[guest-compose] audit failed', (e as Error).message);
  }

  // 10. Response · redirect to /decision.html or to checkout if paid.
  const requiresPayment = input.tier === 'solo_paid';
  const redirect = requiresPayment
    ? `/decision.html?id=${decisionId}&checkout=1`
    : `/decision.html?id=${decisionId}&welcome=1`;

  const res = NextResponse.json(
    {
      ok: true,
      decision_id: decisionId,
      user_id: userId,
      status,
      requires_payment: requiresPayment,
      redirect,
      first_time: isFirstTime,
      solo_free_already_used,
    },
    { status: 201, headers: { 'cache-control': 'private, no-store' } },
  );
  res.headers.set('set-cookie', cookie);
  return res;
}
