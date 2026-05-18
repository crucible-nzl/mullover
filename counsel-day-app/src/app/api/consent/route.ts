/**
 * POST /api/consent
 *
 * GDPR Article 7(1) audit trail. Records every consent decision the user
 * makes against the cookie banner, so we can prove (years later, in a
 * GDPR data-subject access request or an ICO complaint) what the user
 * was asked, what they answered, when, and from where.
 *
 * The cookie banner POSTs here on every accept/decline. Body:
 *   {
 *     consent_type: 'analytics' | 'marketing' | 'all' | 'essential_only',
 *     granted: boolean,
 *     anon_id: string (the localStorage cd_consent_anon_id; used to
 *       link pre-signup consent rows to a user later)
 *   }
 *
 * No auth required · this fires before signup. If the user IS signed in,
 * we link the row to their user_id. Otherwise we keep the anon_id.
 *
 * The endpoint is intentionally rate-limited by the middleware (60/min/IP
 * default) · a malicious page could try to flood the table.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@/lib/db';
import { readSession, readSessionCookie } from '@/lib/sessions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const bodySchema = z.object({
  consent_type: z.enum(['analytics', 'marketing', 'all', 'essential_only']),
  granted: z.union([z.boolean(), z.literal('true'), z.literal('false')]).transform((v) => v === true || v === 'true'),
  anon_id: z.string().trim().min(8).max(64).optional(),
});

function clientIp(req: Request): string | null {
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp;
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return null;
}

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
    return NextResponse.json({ ok: false, message: 'Invalid consent payload.' }, { status: 422 });
  }
  const { consent_type, granted, anon_id } = parsed.data;

  // Link to user if signed in, otherwise keep anonymous
  const session = await readSession(readSessionCookie(req.headers));

  await db.insert(schema.consentLog).values({
    userId: session?.userId ?? null,
    anonId: anon_id ?? null,
    consentType: consent_type,
    granted,
    source: 'cookie_banner',
    ipAddress: clientIp(req),
    userAgent: req.headers.get('user-agent')?.slice(0, 500) ?? null,
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}
