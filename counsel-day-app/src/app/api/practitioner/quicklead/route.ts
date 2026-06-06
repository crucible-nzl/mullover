/**
 * POST /api/practitioner/quicklead
 *
 * Lightweight lead-capture endpoint for the inline form on
 * /counsellors.html. Five fields only · the operator gets enough to
 * follow up; the practitioner doesn't get scared off by the full
 * /apply-practitioner.html form on first contact.
 *
 * Creates a practitioner_applications row with status='pending',
 * outreach_stage='new', source='counsellors_page'. Required follow-up
 * routes (admin pipeline UI) handle the rest of the qualification.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@/lib/db';
import { checkRateLimit, getClientIp, rateLimitResponse } from '@/lib/rate-limit';
import { sendTransactional } from '@/lib/email';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const bodySchema = z.object({
  // Required minimal fields
  first_name:    z.string().trim().min(1).max(80),
  last_name:     z.string().trim().min(1).max(80),
  email:         z.string().trim().toLowerCase().email().max(200),
  practice_kind: z.enum(['counsellor', 'therapist', 'coach', 'mediator', 'other']),
  // The "what's interesting to you" free-text · drives admin triage
  message:       z.string().trim().min(1).max(2000),
  // Honeypot · bots tend to fill all visible fields including 'company_url'
  company_url:   z.string().max(500).optional(),
});

export async function POST(req: Request) {
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
  const body = parsed.data;

  // Honeypot · if filled, return 200 silently so the bot stops retrying.
  if (body.company_url && body.company_url.length > 0) {
    return NextResponse.json({ ok: true, message: 'Thanks · we will be in touch.' }, { status: 200 });
  }

  // Rate-limit · 5 quicklead submissions per IP per hour.
  const ip = getClientIp(req);
  const rl = await checkRateLimit(`practitioner-quicklead:${ip || 'unknown'}`, 5, 3600);
  if (!rl.allowed) return rateLimitResponse(rl, 'Too many submissions from this address.');

  // Insert · maps the lightweight quicklead form onto the existing
  // practitioner_applications table. Most "long" fields stay null and
  // are filled in by the admin during the qualification call.
  try {
    const isTherapist = body.practice_kind === 'therapist';
    const inserted = await db.insert(schema.practitionerApplications).values({
      kind: isTherapist ? 'therapist' : 'counsellor',
      firstName: body.first_name,
      lastName: body.last_name,
      email: body.email,
      practiceName: body.first_name + ' ' + body.last_name,  // placeholder · operator updates during qualification
      role: body.practice_kind,
      country: 'unknown',                                    // placeholder · operator updates
      expectedReferralsPerMonth: 'unknown',
      payoutMethod: 'tbd',
      notes: body.message,
      status: 'pending',
      outreachStage: 'new',
      source: 'counsellors_page',
      ip: ip ?? undefined,
      userAgent: req.headers.get('user-agent') ?? undefined,
    }).returning({ id: schema.practitionerApplications.id });

    // Fire-and-forget the ops notification email · failure here does
    // not block the lead from being captured.
    try {
      const opsText =
        'New practitioner quicklead from /counsellors.\n\n' +
        'Name:     ' + body.first_name + ' ' + body.last_name + '\n' +
        'Email:    ' + body.email + '\n' +
        'Practice: ' + body.practice_kind + '\n' +
        'Message:  ' + body.message + '\n\n' +
        'Review at https://counsel.day/admin-practitioner-pipeline.html';
      await sendTransactional({
        to: { email: process.env.PRACTITIONER_LEADS_TO ?? 'partner@counsel.day' },
        subject: 'Quicklead · ' + body.first_name + ' ' + body.last_name + ' · ' + body.practice_kind,
        textContent: opsText,
        htmlContent: opsText.replace(/\n/g, '<br>'),
      });
    } catch (e) {
      console.warn('[practitioner/quicklead] notify email failed:', (e as Error).message);
    }

    return NextResponse.json(
      { ok: true, message: 'Thanks · we will be in touch in the next business day.', application_id: inserted[0]?.id ?? null },
      { status: 200 },
    );
  } catch (e) {
    console.warn('[practitioner/quicklead] insert failed', e);
    return NextResponse.json({ ok: false, message: 'Could not save · email partner@counsel.day instead.' }, { status: 500 });
  }
}
