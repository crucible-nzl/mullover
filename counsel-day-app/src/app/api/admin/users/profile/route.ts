/**
 * GET /api/admin/users/profile?id=<uuid>
 *
 * Admin-only single-user profile drilldown. Returns the full record an
 * operator needs to triage a support request, billing dispute, or
 * security incident · in one fetch · without leaking anything sensitive
 * (no password hash, no MFA secret, no session tokens).
 *
 * Returns:
 *   · profile · the user row + comp + MFA + Stripe customer id
 *   · stats   · lifetime decision_count + spend_cents + last_active_at
 *   · decisions · the last 25 decisions (status, tier, dates, amount)
 *   · sessions  · the last 10 sessions (ip-hash, ua, last_active_at)
 *   · audit     · the last 20 audit-log entries where this user is the
 *                 actor OR the target (so the operator sees both
 *                 admin-on-user actions and user-self actions)
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';
import { requireAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ ok: false, message: 'Invalid user id.' }, { status: 400 });
  }

  type ProfileRow = {
    id: string;
    email: string;
    first_name: string | null;
    decision_kind_intent: string | null;
    current_plan: string;
    stripe_customer_id: string | null;
    is_admin: boolean;
    email_verified_at: string | null;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
    comp_unlimited: boolean;
    comp_reason: string | null;
    comp_granted_at: string | null;
    comp_granted_by_email: string | null;
    mfa_enabled: boolean;
    mfa_enabled_at: string | null;
    mfa_last_used_at: string | null;
    decision_count: string;
    spend_cents: string;
    last_active_at: string | null;
  };

  const profileRows = await db.execute<ProfileRow>(sql`
    SELECT u.id::text AS id,
           u.email,
           u.first_name,
           u.decision_kind_intent,
           u.current_plan,
           u.stripe_customer_id,
           u.is_admin,
           u.email_verified_at::text AS email_verified_at,
           u.created_at::text AS created_at,
           u.updated_at::text AS updated_at,
           u.deleted_at::text AS deleted_at,
           u.comp_unlimited,
           u.comp_reason,
           u.comp_granted_at::text AS comp_granted_at,
           (SELECT email FROM users WHERE id = u.comp_granted_by) AS comp_granted_by_email,
           (SELECT enabled_at IS NOT NULL FROM mfa_secrets m WHERE m.user_id = u.id) AS mfa_enabled,
           (SELECT enabled_at::text FROM mfa_secrets m WHERE m.user_id = u.id) AS mfa_enabled_at,
           (SELECT last_used_at::text FROM mfa_secrets m WHERE m.user_id = u.id) AS mfa_last_used_at,
           COALESCE((SELECT count(*) FROM decisions d WHERE d.owner_user_id = u.id), 0)::text AS decision_count,
           COALESCE((SELECT SUM(amount_paid_cents) FROM decisions d WHERE d.owner_user_id = u.id AND amount_paid_cents > 0), 0)::text AS spend_cents,
           (SELECT MAX(s.last_active_at)::text FROM sessions s WHERE s.user_id = u.id) AS last_active_at
    FROM users u
    WHERE u.id = ${id}::uuid
    LIMIT 1
  `);
  if (profileRows.length === 0) {
    return NextResponse.json({ ok: false, message: 'User not found.' }, { status: 404 });
  }
  const p = profileRows[0];

  type DecisionRow = {
    id: string;
    question: string;
    tier: string;
    status: string;
    duration_days: number;
    amount_paid_cents: number;
    created_at: string;
    starts_at: string | null;
    unseals_at: string | null;
    cancelled_at: string | null;
  };
  const decisions = await db.execute<DecisionRow>(sql`
    SELECT id::text AS id, question, tier, status, duration_days, amount_paid_cents,
           created_at::text AS created_at, starts_at::text AS starts_at,
           unseals_at::text AS unseals_at, cancelled_at::text AS cancelled_at
    FROM decisions
    WHERE owner_user_id = ${id}::uuid
    ORDER BY created_at DESC
    LIMIT 25
  `);

  type SessionRow = {
    id: string;
    user_agent: string | null;
    ip_hash: string | null;
    created_at: string;
    last_active_at: string | null;
    expires_at: string | null;
    mfa_verified_at: string | null;
  };
  const sessions = await db.execute<SessionRow>(sql`
    SELECT id::text AS id, user_agent, ip_hash,
           created_at::text AS created_at, last_active_at::text AS last_active_at,
           expires_at::text AS expires_at, mfa_verified_at::text AS mfa_verified_at
    FROM sessions
    WHERE user_id = ${id}::uuid
    ORDER BY last_active_at DESC NULLS LAST
    LIMIT 10
  `);

  type AuditRow = {
    id: string;
    actor_email: string | null;
    action: string;
    target_type: string | null;
    target_id: string | null;
    metadata: unknown;
    created_at: string;
    direction: 'actor' | 'target';
  };
  const audit = await db.execute<AuditRow>(sql`
    SELECT a.id::text AS id,
           (SELECT email FROM users WHERE id = a.actor_user_id) AS actor_email,
           a.action, a.target_type, a.target_id::text AS target_id, a.metadata,
           a.created_at::text AS created_at,
           CASE WHEN a.actor_user_id = ${id}::uuid THEN 'actor' ELSE 'target' END AS direction
    FROM audit_log a
    WHERE a.actor_user_id = ${id}::uuid
       OR (a.target_type = 'user' AND a.target_id = ${id}::uuid)
    ORDER BY a.created_at DESC
    LIMIT 20
  `);

  return NextResponse.json(
    {
      ok: true,
      generated_at: new Date().toISOString(),
      profile: {
        id: p.id,
        email: p.email,
        first_name: p.first_name,
        decision_kind_intent: p.decision_kind_intent,
        current_plan: p.current_plan,
        stripe_customer_id: p.stripe_customer_id,
        is_admin: p.is_admin,
        email_verified_at: p.email_verified_at,
        created_at: p.created_at,
        updated_at: p.updated_at,
        deleted_at: p.deleted_at,
        comp_unlimited: p.comp_unlimited,
        comp_reason: p.comp_reason,
        comp_granted_at: p.comp_granted_at,
        comp_granted_by_email: p.comp_granted_by_email,
        mfa_enabled: !!p.mfa_enabled,
        mfa_enabled_at: p.mfa_enabled_at,
        mfa_last_used_at: p.mfa_last_used_at,
      },
      stats: {
        decision_count: Number(p.decision_count),
        spend_cents: Number(p.spend_cents),
        last_active_at: p.last_active_at,
      },
      decisions: Array.from(decisions),
      sessions: Array.from(sessions),
      audit: Array.from(audit),
    },
    { headers: { 'cache-control': 'private, no-store' } }
  );
}
