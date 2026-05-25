/**
 * POST /api/practitioner/apply
 *
 * Public endpoint · no auth. Replaces the legacy `mailto:counsellors@`
 * link on /counsellors.html + /therapists.html with a structured form.
 *
 * Stores the application in `practitioner_applications` and emails
 * the ops team. Returns 200 with `{ ok: true }` on success.
 *
 * Defenses:
 *   · honeypot field (company_url) · drop if filled
 *   · rate-limit · 5/hour per IP
 *   · zod validation on every field
 *   · email format check
 *   · audit log entry on every accepted submission
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@/lib/db';
import { checkRateLimit, getClientIp, rateLimitResponse } from '@/lib/rate-limit';
import { sendTransactional } from '@/lib/email';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const optStr = (max: number) => z.string().trim().max(max).optional().transform((v) => (v === '' ? undefined : v));
const reqStr = (max: number) => z.string().trim().min(1).max(max);

const bodySchema = z.object({
  kind: z.enum(['counsellor', 'therapist']),
  first_name: reqStr(80),
  last_name: reqStr(80),
  email: z.string().trim().toLowerCase().email().max(200),
  phone: optStr(40),
  practice_name: reqStr(120),
  role: reqStr(80),
  professional_body: optStr(200),
  country: reqStr(80),
  city: optStr(80),
  years_in_practice: optStr(20),
  active_clients: optStr(20),
  expected_referrals_per_month: reqStr(20),
  payout_method: reqStr(80),
  client_focus: optStr(800),
  website: optStr(240),
  notes: optStr(2000),
  // Honeypot · must be empty
  company_url: z.string().max(0).optional().or(z.literal('').optional()),
});

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const userAgent = (req.headers.get('user-agent') ?? '').slice(0, 240);

  // Rate-limit early
  const rate = await checkRateLimit(`practitioner-apply:${ip}`, 5, 3600);
  if (!rate.allowed) {
    return rateLimitResponse(rate, 'Too many applications from this network. Try again in an hour or email hello@counsel.day.');
  }

  // Parse
  let raw: Record<string, unknown>;
  try {
    raw = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, message: 'Could not read the form.' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) {
      const k = i.path[0]?.toString() ?? 'form';
      if (!fieldErrors[k]) fieldErrors[k] = i.message;
    }
    return NextResponse.json({ ok: false, field_errors: fieldErrors, message: 'Please check the highlighted fields.' }, { status: 422 });
  }
  const v = parsed.data;

  // Honeypot trip · log and pretend success so the bot moves on
  if (typeof v.company_url === 'string' && v.company_url.length > 0) {
    await db.insert(schema.auditLog).values({
      action: 'practitioner.apply.honeypot',
      targetType: 'practitioner_application',
      metadata: { ip, ua: userAgent },
    }).catch(() => {});
    return NextResponse.json({ ok: true, message: 'Application received.' }, { status: 200 });
  }

  // Insert
  const inserted = await db.insert(schema.practitionerApplications).values({
    kind: v.kind,
    firstName: v.first_name,
    lastName: v.last_name,
    email: v.email,
    phone: v.phone ?? null,
    practiceName: v.practice_name,
    role: v.role,
    professionalBody: v.professional_body ?? null,
    country: v.country,
    city: v.city ?? null,
    yearsInPractice: v.years_in_practice ?? null,
    activeClients: v.active_clients ?? null,
    expectedReferralsPerMonth: v.expected_referrals_per_month,
    payoutMethod: v.payout_method,
    clientFocus: v.client_focus ?? null,
    website: v.website ?? null,
    notes: v.notes ?? null,
    ip,
    userAgent,
  }).returning({ id: schema.practitionerApplications.id });
  const id = inserted[0]?.id ?? null;

  // Audit log
  await db.insert(schema.auditLog).values({
    action: 'practitioner.apply.submitted',
    targetType: 'practitioner_application',
    targetId: id,
    metadata: { kind: v.kind, country: v.country, role: v.role, expected: v.expected_referrals_per_month },
  }).catch(() => { /* never fail submission on audit error */ });

  // Notify ops via email (best-effort · the row is already persisted)
  const opsEmail = process.env.OPS_DIGEST_EMAIL ?? 'admin@counsel.day';
  const subject = `[Counsel.day] New ${v.kind} application · ${v.first_name} ${v.last_name} · ${v.country}`;
  const summary =
`New practitioner application received.

Kind:                 ${v.kind}
Name:                 ${v.first_name} ${v.last_name}
Email:                ${v.email}
Phone:                ${v.phone ?? '(not given)'}
Practice:             ${v.practice_name}
Role:                 ${v.role}
Professional body:    ${v.professional_body ?? '(not given)'}
Country:              ${v.country}
City:                 ${v.city ?? '(not given)'}
Years in practice:    ${v.years_in_practice ?? '(not given)'}
Active clients:       ${v.active_clients ?? '(not given)'}
Expected referrals:   ${v.expected_referrals_per_month}
Payout method:        ${v.payout_method}
Website:              ${v.website ?? '(not given)'}

Client focus:
${v.client_focus ?? '(not given)'}

Notes:
${v.notes ?? '(not given)'}

Review at /admin-practitioners (once the dashboard ships) · row id ${id}.`;

  void sendTransactional({
    to: { email: opsEmail, name: 'Counsel.day ops' },
    subject,
    textContent: summary,
    htmlContent: '<pre style="font-family: ui-monospace, monospace; white-space: pre-wrap;">' + escapeHtml(summary) + '</pre>',
  }).catch((err) => console.warn('[practitioner.apply] ops email failed', (err as Error).message));

  // Confirmation email to the applicant (best-effort)
  void sendTransactional({
    to: { email: v.email, name: `${v.first_name} ${v.last_name}` },
    subject: 'Application received · Counsel.day referral program',
    textContent:
`Hi ${v.first_name},

Thanks for applying to the Counsel.day referral program. We've received your application and will reply within one business day. If the fit looks right we'll send a one-page program agreement; once signed, your referral code is issued and the discount + share start on the next billing cycle.

If you need to add anything in the meantime, reply to this email.

· Counsel.day
`,
    htmlContent:
`<p>Hi ${escapeHtml(v.first_name)},</p>
<p>Thanks for applying to the Counsel.day referral program. We've received your application and will reply within one business day. If the fit looks right we'll send a one-page program agreement; once signed, your referral code is issued and the discount + share start on the next billing cycle.</p>
<p>If you need to add anything in the meantime, reply to this email.</p>
<p>&middot; Counsel.day</p>`,
  }).catch((err) => console.warn('[practitioner.apply] applicant email failed', (err as Error).message));

  return NextResponse.json({ ok: true, message: 'Application received.' }, { status: 200 });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}
