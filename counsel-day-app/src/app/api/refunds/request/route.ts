/**
 * POST /api/refunds/request
 *
 * Files a refund request against a decision the requesting user owns.
 * The request goes into the audit_log; admin reviews it in the admin
 * panel and clicks "Refund" which triggers the Stripe refund via
 * /api/admin/refunds/process (not yet built · v1 is "we'll email you
 * once it's processed", done manually by admin from Stripe Dashboard).
 *
 * Per docs/INTEGRATION_BACKLOG.md, refunds are defects-only · no
 * change-of-mind, no partial-completion. The form on /refunds.html
 * presents that policy clearly before the user submits.
 *
 * Inputs:
 *   decision_id  · uuid · MUST belong to the requesting user
 *   reason       · text 30-2000 · what went wrong
 *   contact      · email · where the user wants the reply (default: their account email)
 *
 * Behaviour:
 *   1. Verify ownership of the decision
 *   2. Append a 'refund.requested' row to audit_log with the reason
 *   3. Email admin@counsel.day with the request details
 *   4. Email the user confirming receipt
 *
 * Does NOT mutate decisions.status · admin does that explicitly after review.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@/lib/db';
import { readSession, readSessionCookie } from '@/lib/sessions';
import { sendTransactional } from '@/lib/email';
import { and, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const OPS_INBOX = process.env.OPS_INBOX_EMAIL ?? 'admin@counsel.day';

const bodySchema = z.object({
  decision_id: z.string().uuid(),
  reason: z.string().trim().min(30).max(2000),
  contact: z.string().trim().toLowerCase().email().max(200).optional(),
  // Comprehensive context · all optional so direct API users aren't broken.
  // The web form requires category + preferred_resolution; everything else
  // is genuinely optional to keep the friction reasonable.
  category: z.enum(['technical', 'billing', 'statutory', 'other']).optional(),
  decision_outcome: z.enum(['sealed_not_started', 'in_progress', 'completed_no_verdict', 'verdict_received', 'unsure']).optional(),
  reproducible: z.enum(['yes', 'no', 'not_sure']).optional(),
  steps_to_reproduce: z.string().trim().max(2000).optional(),
  browser_device: z.string().trim().max(300).optional(),
  preferred_resolution: z.enum(['full_refund', 'credit', 'reattempt', 'no_preference']).optional(),
  date_of_issue: z.string().trim().max(20).optional(),
  phone: z.string().trim().max(40).optional(),
});

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export async function POST(req: Request) {
  const session = await readSession(readSessionCookie(req.headers));
  if (!session) {
    return NextResponse.json({ ok: false, message: 'You must be signed in.' }, { status: 401 });
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
    return NextResponse.json({ ok: false, message: 'Please complete every field. The reason must be at least 30 characters.' }, { status: 422 });
  }
  const {
    decision_id,
    reason,
    category,
    decision_outcome,
    reproducible,
    steps_to_reproduce,
    browser_device,
    preferred_resolution,
    date_of_issue,
    phone,
  } = parsed.data;

  // Ownership check · the decision must belong to the requesting user.
  // Don't reveal "wrong owner" vs "no such decision" · both 404.
  const decisionRows = await db
    .select({
      id: schema.decisions.id,
      ownerUserId: schema.decisions.ownerUserId,
      question: schema.decisions.question,
      tier: schema.decisions.tier,
      stripePaymentIntentId: schema.decisions.stripePaymentIntentId,
      amountPaidCents: schema.decisions.amountPaidCents,
      status: schema.decisions.status,
    })
    .from(schema.decisions)
    .where(and(eq(schema.decisions.id, decision_id), eq(schema.decisions.ownerUserId, session.userId)))
    .limit(1);
  if (decisionRows.length === 0) {
    return NextResponse.json({ ok: false, message: 'That decision was not found on your account.' }, { status: 404 });
  }
  const decision = decisionRows[0];

  // User details for the contact email
  const userRows = await db
    .select({ email: schema.users.email, firstName: schema.users.firstName })
    .from(schema.users)
    .where(eq(schema.users.id, session.userId))
    .limit(1);
  const user = userRows[0];
  const contact = parsed.data.contact ?? user.email;

  // Append to audit_log (the canonical refund-request record)
  await db.insert(schema.auditLog).values({
    actorUserId: session.userId,
    action: 'refund.requested',
    targetType: 'decision',
    targetId: decision.id,
    metadata: {
      reason,
      contact,
      tier: decision.tier,
      amount_paid_cents: decision.amountPaidCents,
      stripe_payment_intent_id: decision.stripePaymentIntentId,
      decision_status_at_request: decision.status,
      category: category ?? null,
      decision_outcome: decision_outcome ?? null,
      reproducible: reproducible ?? null,
      steps_to_reproduce: steps_to_reproduce ?? null,
      browser_device: browser_device ?? null,
      preferred_resolution: preferred_resolution ?? null,
      date_of_issue: date_of_issue ?? null,
      phone: phone ?? null,
    },
  });

  // Notify admin
  const adminSubject = `[refund · ${decision.tier}] ${user.firstName ?? 'User'} requested a refund · decision ${decision.id.slice(0, 8)}`;
  const adminText = [
    `User: ${user.firstName ?? '(no name)'} <${user.email}>`,
    `Reply-to: ${contact}`,
    phone ? `Phone: ${phone}` : null,
    `Decision: ${decision.id}`,
    `Tier: ${decision.tier} · paid ${(decision.amountPaidCents / 100).toFixed(2)} USD`,
    `Stripe payment intent: ${decision.stripePaymentIntentId ?? '(none)'}`,
    `Decision status: ${decision.status}`,
    `Question: ${decision.question}`,
    '',
    '--- CONTEXT ---',
    category ? `Category: ${category}` : null,
    decision_outcome ? `Decision outcome at time of issue: ${decision_outcome}` : null,
    date_of_issue ? `Date issue occurred: ${date_of_issue}` : null,
    reproducible ? `Reproducible: ${reproducible}` : null,
    browser_device ? `Browser/device: ${browser_device}` : null,
    preferred_resolution ? `Preferred resolution: ${preferred_resolution}` : null,
    '',
    '--- REASON ---',
    reason,
    steps_to_reproduce ? '\n--- STEPS TO REPRODUCE ---\n' + steps_to_reproduce : null,
    '',
    'Process via Stripe Dashboard → Payments → find this PaymentIntent → Refund.',
    'Then admin must update decisions.status to "refunded" and set refunded_at.',
    '',
    '· Counsel.day refund request',
  ].filter(Boolean).join('\n');
  await sendTransactional({
    to: { email: OPS_INBOX, name: 'Counsel.day refunds' },
    subject: adminSubject,
    textContent: adminText,
    htmlContent: '<pre style="font-family: monospace; white-space: pre-wrap;">' + escapeHtml(adminText) + '</pre>',
  });

  // Acknowledge to the user
  const ackSubject = 'We received your refund request · Counsel.day';
  const ackText = [
    `Hi ${user.firstName ?? ''},`.trim(),
    '',
    'We received your refund request for decision ' + decision.id.slice(0, 8) + ' and will review it within two business days.',
    '',
    'Reminder: our refund policy is defects-only. We refund where our tool failed to work as described or where local consumer-protection law requires it. We do not refund change-of-mind or partial completion. The full policy is at https://counsel.day/refunds.',
    '',
    'For reference, the reason you submitted:',
    '',
    reason.split('\n').map((l) => '> ' + l).join('\n'),
    '',
    'A human will reply to ' + contact + '.',
    '',
    '· Counsel.day',
  ].join('\n');
  await sendTransactional({
    to: { email: contact, name: user.firstName ?? undefined },
    subject: ackSubject,
    textContent: ackText,
    htmlContent: '<pre style="font-family: -apple-system, sans-serif; white-space: pre-wrap;">' + escapeHtml(ackText) + '</pre>',
  });

  return NextResponse.json(
    { ok: true, message: 'Refund request received. A human will reply within two business days.' },
    { status: 200 }
  );
}
