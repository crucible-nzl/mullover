/**
 * POST /api/password-reset/request   body: { email: string }
 *
 * Mints a 30-minute reset token and sends it to the supplied email via Brevo.
 * Returns the SAME success response whether the email is on file or not, to
 * avoid user-enumeration. The actual presence of the user is only revealed
 * by whether an email is delivered.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@/lib/db';
import { sendTransactional } from '@/lib/email';
import { newToken } from '@/lib/tokens';
import { eq, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const RESET_TTL_MS = 30 * 60 * 1000; // 30 minutes
const BASE = process.env.APP_BASE_URL ?? 'https://counsel.day';

const schemaIn = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
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
  const parsed = schemaIn.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: 'Please enter a valid email address.' }, { status: 422 });
  }
  const { email } = parsed.data;

  // Look up the user (do not reveal whether they exist)
  const userRows = await db
    .select({ id: schema.users.id, firstName: schema.users.firstName, email: schema.users.email })
    .from(schema.users)
    .where(eq(sql`LOWER(${schema.users.email})`, email))
    .limit(1);

  if (userRows.length > 0) {
    const user = userRows[0];
    const token = newToken();
    const expiresAt = new Date(Date.now() + RESET_TTL_MS);
    await db.insert(schema.passwordResetTokens).values({ token, userId: user.id, expiresAt });

    const resetUrl = `${BASE}/reset-password?token=${encodeURIComponent(token)}`;
    const greeting = user.firstName ? `Hi ${user.firstName},` : 'Hi,';
    const text = [
      greeting,
      '',
      'You asked to reset your Counsel.day password. Open the link below to choose a new one. The link is good for 30 minutes.',
      '',
      resetUrl,
      '',
      'If you did not ask for a password reset, you can ignore this message. Your current password (if you have one) is unchanged.',
      '',
      '· Counsel.day',
    ].join('\n');
    const html = `
      <p>${greeting}</p>
      <p>You asked to reset your Counsel.day password. Open the link below to choose a new one. The link is good for 30 minutes.</p>
      <p><a href="${resetUrl}" style="color: #722F37;">${resetUrl}</a></p>
      <p>If you did not ask for a password reset, you can ignore this message. Your current password (if you have one) is unchanged.</p>
      <p>· Counsel.day</p>
    `.trim();
    await sendTransactional({
      to: { email: user.email, name: user.firstName ?? undefined },
      subject: 'Reset your Counsel.day password',
      textContent: text,
      htmlContent: html,
    });

    await db.insert(schema.auditLog).values({
      actorUserId: user.id,
      action: 'auth.password_reset_requested',
      targetType: 'user',
      targetId: user.id,
      metadata: {
        ip: req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? null,
        user_agent: req.headers.get('user-agent') ?? null,
      },
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true, message: 'If that email is on file, a reset link is on its way.' }, { status: 200 });
}
