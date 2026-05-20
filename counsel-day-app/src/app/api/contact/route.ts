/**
 * POST /api/contact
 *
 * Public contact form. Anyone (signed in or not) can post; we forward to
 * admin@counsel.day via Brevo and send a confirmation autoreply to the
 * submitter. Rate-limited by the middleware (10/min/IP via /api/* default).
 *
 * Inputs:
 *   name      (1-80)
 *   email     (valid email)
 *   topic     (one of a fixed enum)
 *   message   (10-4000)
 *   honeypot  (must be empty · spambots fill every field)
 *
 * No reCAPTCHA here · the IP rate limit + honeypot + Brevo's own anti-abuse
 * is sufficient for the contact-form volume we expect. If spam becomes a
 * problem, add the reCAPTCHA v3 verify call (same pattern as /api/signup).
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { sendTransactional } from '@/lib/email';
import { checkRateLimit, getClientIp, rateLimitResponse } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const OPS_INBOX = process.env.OPS_INBOX_EMAIL ?? 'admin@counsel.day';

const bodySchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email().max(200),
  topic: z.enum(['hello', 'press', 'corrections', 'therapists', 'security', 'privacy', 'founder', 'other']),
  message: z.string().trim().min(10).max(4000),
  honeypot: z.string().max(0).optional(),
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function POST(req: Request) {
  // Rate limit · 3 contact submissions per IP per hour. Per
  // docs/SECURITY_PENTEST_2026-05-20.md item 8.2. The form's
  // honeypot field below catches naive bots; this catches everyone
  // else.
  const ip = getClientIp(req);
  const ipCheck = await checkRateLimit(`contact-ip:${ip}`, 3, 3600);
  if (!ipCheck.allowed) {
    return rateLimitResponse(ipCheck, 'Too many messages from this network. Please wait and try again.');
  }

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
    // Honeypot trip · pretend success so the bot doesn't iterate
    if (raw.honeypot && String(raw.honeypot).length > 0) {
      return NextResponse.json({ ok: true, message: 'Thanks · we have your message.' }, { status: 200 });
    }
    return NextResponse.json({ ok: false, message: 'Please complete every field.' }, { status: 422 });
  }
  const { name, email, topic, message } = parsed.data;

  // Build the ops inbox email (the real one). The topic determines BOTH
  // the human-readable label in the subject line AND the routing inbox
  // (until the per-topic Zoho aliases exist, everything funnels to admin@).
  const topicLabel = {
    hello: 'General hello',
    press: 'Press / media',
    corrections: 'Correction to the site',
    therapists: 'Therapists & counsellors program',
    security: 'Security disclosure',
    privacy: 'Privacy question or request',
    founder: 'Founder direct',
    other: 'Other / uncategorised',
  }[topic];

  const opsSubject = `[contact · ${topic}] ${name} · ${topicLabel}`;
  const opsText = [
    `From: ${name} <${email}>`,
    `Topic: ${topicLabel}`,
    '',
    message,
    '',
    '· Counsel.day contact form',
  ].join('\n');
  const opsHtml = `
    <p><strong>From:</strong> ${escapeHtml(name)} &lt;${escapeHtml(email)}&gt;<br>
       <strong>Topic:</strong> ${escapeHtml(topicLabel)}</p>
    <hr>
    <p style="white-space: pre-wrap;">${escapeHtml(message)}</p>
    <hr>
    <p>· Counsel.day contact form</p>
  `.trim();

  await sendTransactional({
    to: { email: OPS_INBOX, name: 'Counsel.day support' },
    subject: opsSubject,
    textContent: opsText,
    htmlContent: opsHtml,
  });

  // Autoreply to the submitter
  const ackSubject = 'We have your message · Counsel.day';
  const ackText = [
    `Hi ${name},`,
    '',
    'Thanks for getting in touch. Your message reached admin@counsel.day and we will reply within two business days.',
    '',
    'For reference, the message you sent:',
    '',
    message.split('\n').map((l) => '> ' + l).join('\n'),
    '',
    '· Counsel.day',
  ].join('\n');
  const ackHtml = `
    <p>Hi ${escapeHtml(name)},</p>
    <p>Thanks for getting in touch. Your message reached <strong>admin@counsel.day</strong> and we will reply within two business days.</p>
    <p>For reference, the message you sent:</p>
    <blockquote style="border-left: 3px solid #722F37; padding-left: 14px; margin: 16px 0; color: #444; white-space: pre-wrap;">${escapeHtml(message)}</blockquote>
    <p>· Counsel.day</p>
  `.trim();

  await sendTransactional({
    to: { email, name },
    subject: ackSubject,
    textContent: ackText,
    htmlContent: ackHtml,
  });

  return NextResponse.json(
    { ok: true, message: 'Thanks. We have your message and will reply within two business days.' },
    { status: 200 }
  );
}
