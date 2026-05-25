/**
 * GET    /api/admin/practitioners?status=&q=&limit=&offset=
 * PATCH  /api/admin/practitioners
 *          body { application_id, action: 'approve' | 'reject' | 'withdraw',
 *                 referral_code?, stripe_coupon_id?, reason? }
 *
 * Admin-only review of practitioner referral applications.
 *
 * Approval flow:
 *   1. Admin reviews the row, types/edits the referral code (auto-
 *      suggested as LASTNAME10), pastes the Stripe coupon id created
 *      manually in the Stripe Dashboard, clicks Approve.
 *   2. Row flips to status='approved'; applicant gets the welcome
 *      email with their code; audit-logged.
 *
 * Rejection / withdraw flow:
 *   · status flips, optional reason captured, applicant emailed
 *     (rejection only · withdraw is silent), audit-logged.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@/lib/db';
import { sql, eq, and } from 'drizzle-orm';
import { requireAdmin, requireFreshMfa } from '@/lib/admin-auth';
import { sendTransactional } from '@/lib/email';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const APP_BASE = process.env.APP_BASE_URL ?? 'https://counsel.day';

const listQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'withdrawn', 'all']).default('pending'),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const url = new URL(req.url);
  const parsed = listQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: 'Invalid query.' }, { status: 422 });
  }
  const { status, q, limit, offset } = parsed.data;

  const statusFilter = status === 'all' ? sql`` : sql`AND p.status = ${status}`;
  const search = q && q.length > 0
    ? sql`AND (
        p.email ILIKE ${'%' + q + '%'} OR
        p.first_name ILIKE ${'%' + q + '%'} OR
        p.last_name ILIKE ${'%' + q + '%'} OR
        p.practice_name ILIKE ${'%' + q + '%'} OR
        p.country ILIKE ${'%' + q + '%'}
      )`
    : sql``;

  type Row = {
    id: string;
    kind: string;
    first_name: string;
    last_name: string;
    email: string;
    phone: string | null;
    practice_name: string;
    role: string;
    professional_body: string | null;
    country: string;
    city: string | null;
    years_in_practice: string | null;
    active_clients: string | null;
    expected_referrals_per_month: string;
    payout_method: string;
    client_focus: string | null;
    website: string | null;
    notes: string | null;
    status: string;
    referral_code: string | null;
    stripe_coupon_id: string | null;
    reviewed_at: string | null;
    created_at: string;
  };
  const rows = await db.execute<Row>(sql`
    SELECT p.id::text AS id, p.kind, p.first_name, p.last_name, p.email, p.phone,
           p.practice_name, p.role, p.professional_body, p.country, p.city,
           p.years_in_practice, p.active_clients, p.expected_referrals_per_month,
           p.payout_method, p.client_focus, p.website, p.notes, p.status,
           p.referral_code, p.stripe_coupon_id,
           p.reviewed_at::text AS reviewed_at,
           p.created_at::text  AS created_at
    FROM practitioner_applications p
    WHERE 1 = 1 ${statusFilter} ${search}
    ORDER BY p.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `);

  const totalRows = await db.execute<{ total: string }>(sql`
    SELECT count(*)::text AS total
    FROM practitioner_applications p
    WHERE 1 = 1 ${statusFilter} ${search}
  `);
  const total = Number((totalRows[0] as { total: string }).total);

  // Status counts for the filter pills
  const counts = await db.execute<{ status: string; n: string }>(sql`
    SELECT status, count(*)::text AS n
    FROM practitioner_applications
    GROUP BY status
  `);
  const byStatus = Object.fromEntries(
    Array.from(counts).map((r) => [r.status, Number(r.n)])
  );

  return NextResponse.json(
    {
      ok: true,
      generated_at: new Date().toISOString(),
      total,
      limit,
      offset,
      status,
      counts: byStatus,
      applications: Array.from(rows),
    },
    { headers: { 'cache-control': 'private, no-store' } }
  );
}

const patchSchema = z.object({
  application_id: z.string().uuid(),
  action: z.enum(['approve', 'reject', 'withdraw']),
  referral_code: z.string().trim().min(3).max(40).regex(/^[A-Z0-9_-]+$/i).optional(),
  stripe_coupon_id: z.string().trim().min(3).max(80).optional(),
  reason: z.string().trim().max(800).optional(),
});

export async function PATCH(req: Request) {
  // Step-up MFA · approve/reject is the kind of action where the
  // operator is committing to spend on the practitioner side.
  const gate = await requireFreshMfa(req);
  if (gate instanceof NextResponse) return gate;

  let raw: unknown;
  try { raw = await req.json(); } catch {
    return NextResponse.json({ ok: false, message: 'Body must be JSON.' }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return NextResponse.json({ ok: false, message: `Invalid input: ${issues}` }, { status: 422 });
  }
  const { application_id, action, referral_code, stripe_coupon_id, reason } = parsed.data;

  // Fetch row
  const rows = await db
    .select()
    .from(schema.practitionerApplications)
    .where(eq(schema.practitionerApplications.id, application_id))
    .limit(1);
  if (rows.length === 0) {
    return NextResponse.json({ ok: false, message: 'Application not found.' }, { status: 404 });
  }
  const app = rows[0];

  if (action === 'approve') {
    if (!referral_code) {
      return NextResponse.json({ ok: false, message: 'referral_code is required to approve.' }, { status: 422 });
    }
    if (!stripe_coupon_id) {
      return NextResponse.json({ ok: false, message: 'stripe_coupon_id is required to approve. Create the coupon in the Stripe Dashboard first.' }, { status: 422 });
    }
    const code = referral_code.toUpperCase();

    // Uniqueness pre-check (the DB has a partial unique index so the
    // INSERT would fail anyway, but a clean 409 is friendlier than
    // a generic 500).
    const dupe = await db
      .select({ id: schema.practitionerApplications.id })
      .from(schema.practitionerApplications)
      .where(and(
        eq(schema.practitionerApplications.referralCode, code),
        eq(schema.practitionerApplications.status, 'approved')
      ))
      .limit(1);
    if (dupe.length > 0 && dupe[0].id !== application_id) {
      return NextResponse.json({ ok: false, message: `Code ${code} is already in use by another practitioner.` }, { status: 409 });
    }

    await db
      .update(schema.practitionerApplications)
      .set({
        status: 'approved',
        referralCode: code,
        stripeCouponId: stripe_coupon_id,
        reviewedBy: gate.userId,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.practitionerApplications.id, application_id));

    // Welcome email
    void sendTransactional({
      to: { email: app.email, name: `${app.firstName} ${app.lastName}` },
      subject: 'Approved · your Counsel.day referral code',
      textContent:
`Hi ${app.firstName},

Welcome to the Counsel.day referral program. Your application has been approved.

Your personal referral code: ${code}

Hand this code to any client who you think Counsel.day could help. When they enter it on the Stripe checkout page they get 10% off, and the account becomes bound to you for the lifetime of the account. You receive 15% of every paid decision they file, paid quarterly in USD by ${app.payoutMethod}.

The one-page program agreement is attached separately by reply to this email; once signed, you are live.

· Counsel.day
${APP_BASE}/counsellors
`,
      htmlContent:
`<p>Hi ${escapeHtml(app.firstName)},</p>
<p>Welcome to the Counsel.day referral program. Your application has been approved.</p>
<p style="font-family: ui-monospace, monospace; font-size: 18px; padding: 14px 18px; border-left: 3px solid #722F37; background: #f4e6e8;">Your personal referral code: <strong>${escapeHtml(code)}</strong></p>
<p>Hand this code to any client who you think Counsel.day could help. When they enter it on the Stripe checkout page they get 10% off, and the account becomes bound to you for the lifetime of the account. You receive 15% of every paid decision they file, paid quarterly in USD by ${escapeHtml(app.payoutMethod)}.</p>
<p>The one-page program agreement is attached separately by reply to this email; once signed, you are live.</p>
<p>&middot; <a href="${APP_BASE}/counsellors" style="color: #722F37;">Counsel.day</a></p>`,
    }).catch((err) => console.warn('[admin/practitioners] welcome email failed', (err as Error).message));

    await db.insert(schema.auditLog).values({
      action: 'practitioner.approved',
      actorUserId: gate.userId,
      targetType: 'practitioner_application',
      targetId: application_id,
      metadata: { kind: app.kind, code, stripe_coupon_id, country: app.country },
    }).catch(() => {});

    return NextResponse.json({ ok: true, message: 'Approved. Welcome email sent.' });
  }

  if (action === 'reject') {
    await db
      .update(schema.practitionerApplications)
      .set({
        status: 'rejected',
        reviewedBy: gate.userId,
        reviewedAt: new Date(),
        notes: app.notes ? `${app.notes}\n\n[REVIEW NOTE] ${reason ?? '(no reason)'}` : `[REVIEW NOTE] ${reason ?? '(no reason)'}`,
        updatedAt: new Date(),
      })
      .where(eq(schema.practitionerApplications.id, application_id));

    void sendTransactional({
      to: { email: app.email, name: `${app.firstName} ${app.lastName}` },
      subject: 'Your Counsel.day referral application',
      textContent:
`Hi ${app.firstName},

Thank you for applying to the Counsel.day referral program. After reviewing your application, we are not able to bring you into the program at this time.

${reason ? `${reason}\n\n` : ''}This is not a judgement on your practice; we keep the program small while the product is in its early life. You're welcome to re-apply in a future cohort.

· Counsel.day
`,
      htmlContent:
`<p>Hi ${escapeHtml(app.firstName)},</p>
<p>Thank you for applying to the Counsel.day referral program. After reviewing your application, we are not able to bring you into the program at this time.</p>
${reason ? `<p>${escapeHtml(reason)}</p>` : ''}
<p>This is not a judgement on your practice; we keep the program small while the product is in its early life. You're welcome to re-apply in a future cohort.</p>
<p>&middot; Counsel.day</p>`,
    }).catch((err) => console.warn('[admin/practitioners] rejection email failed', (err as Error).message));

    await db.insert(schema.auditLog).values({
      action: 'practitioner.rejected',
      actorUserId: gate.userId,
      targetType: 'practitioner_application',
      targetId: application_id,
      metadata: { kind: app.kind, reason: reason ?? null },
    }).catch(() => {});

    return NextResponse.json({ ok: true, message: 'Rejected. Notification email sent.' });
  }

  if (action === 'withdraw') {
    await db
      .update(schema.practitionerApplications)
      .set({
        status: 'withdrawn',
        reviewedBy: gate.userId,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.practitionerApplications.id, application_id));

    await db.insert(schema.auditLog).values({
      action: 'practitioner.withdrawn',
      actorUserId: gate.userId,
      targetType: 'practitioner_application',
      targetId: application_id,
      metadata: { kind: app.kind },
    }).catch(() => {});

    return NextResponse.json({ ok: true, message: 'Withdrawn.' });
  }

  return NextResponse.json({ ok: false, message: 'Unknown action.' }, { status: 422 });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}
