/**
 * GET    /api/admin/users?q=&limit=&offset=&sort=
 * PATCH  /api/admin/users · body { user_id, action: 'promote' | 'demote' | 'soft_delete' | 'restore' }
 *
 * Admin-only listing + management. Returns one row per user with the
 * fields the operator actually needs to act on:
 *   id, email, first_name, current_plan, is_admin, email_verified_at,
 *   created_at, deleted_at, decision_count, last_session_at
 *
 * PATCH actions:
 *   · promote     · sets is_admin = true (audit-logged)
 *   · demote      · sets is_admin = false (BLOCKED for self · prevents lockout)
 *   · soft_delete · sets deleted_at = NOW(), revokes sessions
 *   · restore     · clears deleted_at (user can sign in again)
 *
 * All actions audit-logged with actor + target.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@/lib/db';
import { sql, eq } from 'drizzle-orm';
import { requireAdmin, requireFreshMfa } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const querySchema = z.object({
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  sort: z.enum(['created_at', 'email', 'last_active_at', 'decisions']).default('created_at'),
});

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const url = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: 'Invalid query.' }, { status: 422 });
  }
  const { q, limit, offset, sort } = parsed.data;

  // Build the order-by safely. We never interpolate user-supplied values
  // into SQL directly · the sort key is validated by the zod enum above.
  const orderBy =
    sort === 'email'           ? sql`u.email ASC` :
    sort === 'last_active_at'  ? sql`last_active_at DESC NULLS LAST` :
    sort === 'decisions'       ? sql`decision_count DESC` :
                                 sql`u.created_at DESC`;

  // Search · ILIKE on email + first_name, parameterised. Empty q = no filter.
  const search = q && q.length > 0 ? sql`AND (u.email ILIKE ${'%' + q + '%'} OR u.first_name ILIKE ${'%' + q + '%'})` : sql``;

  type Row = {
    id: string;
    email: string;
    first_name: string | null;
    current_plan: string | null;
    is_admin: boolean;
    email_verified: boolean;
    created_at: string;
    deleted_at: string | null;
    decision_count: string;
    last_active_at: string | null;
    comp_unlimited: boolean;
    comp_reason: string | null;
    comp_granted_at: string | null;
    mfa_enabled: boolean;
    mfa_last_used_at: string | null;
    stripe_customer_id: string | null;
    spend_cents: string;
  };
  const rows = await db.execute<Row>(sql`
    SELECT u.id::text AS id,
           u.email,
           u.first_name,
           u.current_plan,
           u.is_admin,
           (u.email_verified_at IS NOT NULL) AS email_verified,
           u.created_at::text AS created_at,
           u.deleted_at::text AS deleted_at,
           u.comp_unlimited,
           u.comp_reason,
           u.comp_granted_at::text AS comp_granted_at,
           u.stripe_customer_id,
           (SELECT enabled_at IS NOT NULL FROM mfa_secrets m WHERE m.user_id = u.id) AS mfa_enabled,
           (SELECT last_used_at::text FROM mfa_secrets m WHERE m.user_id = u.id) AS mfa_last_used_at,
           COALESCE((SELECT count(*) FROM decisions d WHERE d.owner_user_id = u.id), 0)::text AS decision_count,
           COALESCE((SELECT SUM(amount_paid_cents) FROM decisions d WHERE d.owner_user_id = u.id AND d.amount_paid_cents > 0), 0)::text AS spend_cents,
           (SELECT MAX(s.last_active_at)::text FROM sessions s WHERE s.user_id = u.id) AS last_active_at
    FROM users u
    WHERE 1 = 1 ${search}
    ORDER BY ${orderBy}
    LIMIT ${limit} OFFSET ${offset}
  `);

  const totalRows = await db.execute<{ total: string }>(sql`
    SELECT count(*)::text AS total FROM users u WHERE 1 = 1 ${search}
  `);
  const total = Number((totalRows[0] as { total: string }).total);

  return NextResponse.json(
    {
      ok: true,
      generated_at: new Date().toISOString(),
      total,
      limit,
      offset,
      sort,
      q: q ?? null,
      users: Array.from(rows).map((r) => ({
        id: r.id,
        email: r.email,
        first_name: r.first_name,
        current_plan: r.current_plan,
        is_admin: r.is_admin,
        email_verified: r.email_verified,
        created_at: r.created_at,
        deleted_at: r.deleted_at,
        decision_count: Number(r.decision_count),
        last_active_at: r.last_active_at,
        comp_unlimited: r.comp_unlimited,
        comp_reason: r.comp_reason,
        comp_granted_at: r.comp_granted_at,
        mfa_enabled: !!r.mfa_enabled,
        mfa_last_used_at: r.mfa_last_used_at,
        stripe_customer_id: r.stripe_customer_id,
        spend_cents: Number(r.spend_cents),
      })),
    },
    { headers: { 'cache-control': 'private, no-store' } }
  );
}

const patchSchema = z.object({
  user_id: z.string().uuid(),
  action: z.enum(['promote', 'demote', 'soft_delete', 'restore', 'reset_password', 'force_signout', 'comp_grant', 'comp_revoke']),
  reason: z.string().trim().min(1).max(500).optional(), // required for comp_grant
});

export async function PATCH(req: Request) {
  // Step-up MFA · every user-management PATCH (promote/demote/
  // soft_delete/restore) is destructive · require a fresh TOTP code
  // in the last 5 minutes. If the admin has no MFA enrolled the gate
  // falls through (MFA is optional at the user level).
  const gate = await requireFreshMfa(req);
  if (gate instanceof NextResponse) return gate;

  let raw: unknown;
  try { raw = await req.json(); } catch {
    return NextResponse.json({ ok: false, message: 'Body must be JSON.' }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: 'user_id (uuid) and action are required.' }, { status: 422 });
  }
  const { user_id, action, reason } = parsed.data;

  // Lockout protection · the acting admin cannot demote or soft-delete
  // themselves. They can still promote others and restore others; if
  // they really want to step down they can ask a peer to demote them.
  if ((action === 'demote' || action === 'soft_delete') && user_id === gate.userId) {
    return NextResponse.json({ ok: false, message: 'You cannot ' + action + ' yourself.' }, { status: 409 });
  }

  // Verify the target exists
  const target = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      firstName: schema.users.firstName,
      isAdmin: schema.users.isAdmin,
      deletedAt: schema.users.deletedAt,
      compUnlimited: schema.users.compUnlimited,
    })
    .from(schema.users)
    .where(eq(schema.users.id, user_id))
    .limit(1);
  if (target.length === 0) {
    return NextResponse.json({ ok: false, message: 'User not found.' }, { status: 404 });
  }
  const t = target[0];

  if (action === 'promote') {
    await db.update(schema.users).set({ isAdmin: true, updatedAt: new Date() }).where(eq(schema.users.id, user_id));
  } else if (action === 'demote') {
    await db.update(schema.users).set({ isAdmin: false, updatedAt: new Date() }).where(eq(schema.users.id, user_id));
  } else if (action === 'soft_delete') {
    await db.update(schema.users).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(schema.users.id, user_id));
    // Revoke every session so the user is signed out everywhere
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, user_id)).catch(() => {});
  } else if (action === 'restore') {
    await db.update(schema.users).set({ deletedAt: null, updatedAt: new Date() }).where(eq(schema.users.id, user_id));
  } else if (action === 'force_signout') {
    // Revoke every session for the target user. They get logged out
    // on next page load (auth-check returns 401).
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, user_id));
  } else if (action === 'reset_password') {
    // Mint a one-hour password-reset token, email the user. The
    // existing /api/password-reset/consume route handles the redeem.
    const { newToken } = await import('@/lib/tokens');
    const { sendTransactional } = await import('@/lib/email');
    const token = newToken();
    await db.insert(schema.passwordResetTokens).values({
      token,
      userId: user_id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    const BASE = process.env.APP_BASE_URL ?? 'https://counsel.day';
    const resetUrl = `${BASE}/reset-password.html?token=${encodeURIComponent(token)}`;
    await sendTransactional({
      to: { email: t.email },
      subject: 'Reset your Counsel.day password',
      textContent: `An admin triggered a password reset on your Counsel.day account.\n\nFollow this link within one hour to set a new password:\n${resetUrl}\n\nIf you did not expect this, reply to this email · we will investigate.\n\n· Counsel.day`,
      htmlContent: `<p>An admin triggered a password reset on your Counsel.day account.</p><p><a href="${resetUrl}" style="color: #722F37;">Set a new password (link valid for one hour)</a></p><p style="color: #6b7a90; font-size: 13px;">If you did not expect this, reply to this email · we will investigate.</p>`,
    }).catch(() => { /* email send failure is non-fatal; audit-log captures the trigger */ });
  } else if (action === 'comp_grant') {
    if (!reason) {
      return NextResponse.json({ ok: false, message: 'reason is required when granting a comp.' }, { status: 422 });
    }
    if (t.compUnlimited) {
      return NextResponse.json({ ok: false, message: `${t.email} already has comp_unlimited.` }, { status: 409 });
    }
    await db.update(schema.users)
      .set({
        compUnlimited: true,
        compReason: reason,
        compGrantedAt: new Date(),
        compGrantedBy: gate.userId,
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, user_id));
    // Notify the user that the operator has flipped the flag.
    const { sendTransactional } = await import('@/lib/email');
    const greeting = t.firstName ? `Hi ${t.firstName},` : 'Hi,';
    await sendTransactional({
      to: { email: t.email, name: t.firstName ?? undefined },
      subject: 'Counsel.day · all your decisions are on the house',
      textContent:
`${greeting}

The Counsel.day team has comped your account · every decision you file from now on (Solo, Couple, Family · any tier, any duration) is included at no charge. You will not see a Stripe checkout page.

Reason: ${reason}

This continues until we revoke it. If you have questions, reply to this email.

· Counsel.day`,
      htmlContent:
`<p>${greeting}</p>
<p>The Counsel.day team has comped your account &middot; every decision you file from now on (Solo, Couple, Family &middot; any tier, any duration) is included at no charge. You will not see a Stripe checkout page.</p>
<p style="font-family: ui-monospace, monospace; font-size: 13px; padding: 12px 14px; background: #f4e6e8; border-left: 3px solid #722F37;">Reason: ${reason}</p>
<p>This continues until we revoke it. If you have questions, reply to this email.</p>
<p>&middot; Counsel.day</p>`,
    }).catch(() => { /* audit captures the grant; email failure is non-fatal */ });
  } else if (action === 'comp_revoke') {
    if (!t.compUnlimited) {
      return NextResponse.json({ ok: false, message: `${t.email} does not have comp_unlimited.` }, { status: 409 });
    }
    await db.update(schema.users)
      .set({
        compUnlimited: false,
        compReason: null,
        compGrantedAt: null,
        compGrantedBy: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, user_id));
    // No revoke email · the user can see plan state in /account.
  }

  await db.insert(schema.auditLog).values({
    actorUserId: gate.userId,
    action: 'admin.user.' + action,
    targetType: 'user',
    targetId: user_id,
    metadata: {
      target_email: t.email,
      prior_is_admin: t.isAdmin,
      prior_deleted_at: t.deletedAt,
      prior_comp_unlimited: t.compUnlimited,
      ...(action === 'comp_grant' || action === 'comp_revoke' ? { reason: reason ?? null } : {}),
    },
  }).catch(() => {});

  return NextResponse.json({ ok: true, message: 'Action applied: ' + action }, { status: 200 });
}
