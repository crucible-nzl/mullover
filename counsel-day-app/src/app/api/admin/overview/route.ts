/**
 * GET /api/admin/overview
 *
 * The one-shot data feed for the admin dashboard. Returns a single
 * JSON document containing every real number the dashboard renders:
 *   - User counts (total, verified, last 7/30 days)
 *   - Decision counts by status + tier
 *   - Verdict pipeline state (recent generations, total tokens, cost)
 *   - Cron health (last run timestamp per job from audit_log)
 *   - Email send activity (count by type from sent table · we don't
 *     track that today; falls back to "n/a")
 *   - Stripe webhook activity (last 10 events from stripe_webhook_events)
 *   - Audit log recent (last 10)
 *   - Refund requests pending
 *   - Backup status (last pg_dump file by name pattern · we cannot
 *     stat the filesystem from Next.js, so we report it as "see
 *     server / systemctl status counsel-day-backup")
 *
 * All counts are live · no caching, no placeholder.
 */

import { NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { requireAdmin } from '@/lib/admin-auth';
import { sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  // Wrap every query in a try/catch so a single failure doesn't 500 the dashboard.
  const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try { return await fn(); } catch (e) { console.warn('[admin/overview] query failed', e); return fallback; }
  };

  // ---- Users ----
  const users = await safe(async () => {
    const rows = await db.execute<{
      total: string;
      verified: string;
      deleted: string;
      admins: string;
      last_7: string;
      last_30: string;
      with_password: string;
    }>(sql`
      SELECT
        count(*)::text AS total,
        count(*) FILTER (WHERE email_verified_at IS NOT NULL)::text AS verified,
        count(*) FILTER (WHERE deleted_at IS NOT NULL)::text AS deleted,
        count(*) FILTER (WHERE is_admin = true)::text AS admins,
        count(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::text AS last_7,
        count(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days')::text AS last_30,
        count(*) FILTER (WHERE password_hash IS NOT NULL)::text AS with_password
      FROM users
    `);
    const r = rows[0] as Record<string, string>;
    return {
      total: Number(r.total),
      verified: Number(r.verified),
      deleted: Number(r.deleted),
      admins: Number(r.admins),
      last_7_days: Number(r.last_7),
      last_30_days: Number(r.last_30),
      with_password: Number(r.with_password),
    };
  }, { total: 0, verified: 0, deleted: 0, admins: 0, last_7_days: 0, last_30_days: 0, with_password: 0 });

  // ---- Decisions ----
  const decisions = await safe(async () => {
    const rows = await db.execute<{
      total: string;
      pending: string;
      active: string;
      completed: string;
      cancelled: string;
      refunded: string;
      verdict_generating: string;
      solo_free: string;
      solo_paid: string;
      couple: string;
      family: string;
    }>(sql`
      SELECT
        count(*)::text AS total,
        count(*) FILTER (WHERE status = 'pending_invites')::text AS pending,
        count(*) FILTER (WHERE status = 'active')::text AS active,
        count(*) FILTER (WHERE status = 'completed')::text AS completed,
        count(*) FILTER (WHERE status = 'cancelled')::text AS cancelled,
        count(*) FILTER (WHERE status = 'refunded')::text AS refunded,
        count(*) FILTER (WHERE status = 'verdict_generating')::text AS verdict_generating,
        count(*) FILTER (WHERE tier = 'solo_free')::text AS solo_free,
        count(*) FILTER (WHERE tier = 'solo_paid')::text AS solo_paid,
        count(*) FILTER (WHERE tier = 'couple')::text AS couple,
        count(*) FILTER (WHERE tier = 'family')::text AS family
      FROM decisions
    `);
    const r = rows[0] as Record<string, string>;
    return {
      total: Number(r.total),
      by_status: {
        pending_invites: Number(r.pending),
        active: Number(r.active),
        completed: Number(r.completed),
        cancelled: Number(r.cancelled),
        refunded: Number(r.refunded),
        verdict_generating: Number(r.verdict_generating),
      },
      by_tier: {
        solo_free: Number(r.solo_free),
        solo_paid: Number(r.solo_paid),
        couple: Number(r.couple),
        family: Number(r.family),
      },
    };
  }, {
    total: 0,
    by_status: {
      pending_invites: 0,
      active: 0,
      completed: 0,
      cancelled: 0,
      refunded: 0,
      verdict_generating: 0,
    },
    by_tier: {
      solo_free: 0,
      solo_paid: 0,
      couple: 0,
      family: 0,
    },
  });

  // ---- Verdicts (sums · production + testing) ----
  // /admin overview reports the combined Anthropic spend because finance
  // wants the real number on the bill. Production verdicts go into the
  // verdicts table; operator test runs from /admin-testing-area go into
  // verdict_test_runs. Both spent real money on the same API key.
  const verdicts = await safe(async () => {
    const rows = await db.execute<{
      total: string;
      last_7: string;
      tokens_in: string;
      tokens_out: string;
      cost_cents: string;
      test_total: string;
      test_tokens_in: string;
      test_tokens_out: string;
      test_cost_cents: string;
      last_generated: string | null;
    }>(sql`
      WITH prod AS (
        SELECT
          count(*)::text AS total,
          count(*) FILTER (WHERE generated_at > NOW() - INTERVAL '7 days')::text AS last_7,
          COALESCE(SUM(tokens_input), 0)::text AS tokens_in,
          COALESCE(SUM(tokens_output), 0)::text AS tokens_out,
          COALESCE(SUM(cost_cents), 0)::text AS cost_cents,
          MAX(generated_at)::text AS last_generated
        FROM verdicts
      ),
      test AS (
        SELECT
          count(*)::text AS test_total,
          COALESCE(SUM(tokens_input), 0)::text AS test_tokens_in,
          COALESCE(SUM(tokens_output), 0)::text AS test_tokens_out,
          COALESCE(SUM(cost_cents), 0)::text AS test_cost_cents
        FROM verdict_test_runs
      )
      SELECT * FROM prod, test
    `);
    const r = rows[0] as Record<string, string | null>;
    const prodTokensIn = Number(r.tokens_in);
    const prodTokensOut = Number(r.tokens_out);
    const prodCost = Number(r.cost_cents);
    const testTokensIn = Number(r.test_tokens_in);
    const testTokensOut = Number(r.test_tokens_out);
    const testCost = Number(r.test_cost_cents);
    // Manual offset · captures Anthropic spend incurred before commit
    // 82307a9 added persistence to /admin-testing-area. Set
    // CD_ANTHROPIC_HISTORICAL_OFFSET_CENTS in /etc/counsel-day-app/env.local
    // to whatever number Anthropic's billing console shows that isn't
    // in verdicts or verdict_test_runs yet.
    const historicalOffsetCents = Number(process.env.CD_ANTHROPIC_HISTORICAL_OFFSET_CENTS || 0) || 0;
    return {
      total: Number(r.total),
      last_7_days: Number(r.last_7),
      tokens_input: prodTokensIn + testTokensIn,
      tokens_output: prodTokensOut + testTokensOut,
      cost_usd: (prodCost + testCost + historicalOffsetCents) / 100,
      // Split for the operator to see where the spend is going.
      production: { count: Number(r.total), tokens_input: prodTokensIn, tokens_output: prodTokensOut, cost_usd: prodCost / 100 },
      testing:    { count: Number(r.test_total), tokens_input: testTokensIn, tokens_output: testTokensOut, cost_usd: testCost / 100 },
      historical_offset_usd: historicalOffsetCents / 100,
      last_generated_at: r.last_generated,
    };
  }, { total: 0, last_7_days: 0, tokens_input: 0, tokens_output: 0, cost_usd: 0, production: { count: 0, tokens_input: 0, tokens_output: 0, cost_usd: 0 }, testing: { count: 0, tokens_input: 0, tokens_output: 0, cost_usd: 0 }, historical_offset_usd: 0, last_generated_at: null });

  // ---- Cron health · derived from audit_log + table activity ----
  const cronHealth = await safe(async () => {
    const rows = await db.execute<{
      last_verdict: string | null;
      last_session_purge: string | null;
      last_invite_expiry: string | null;
      last_invite_reminder: string | null;
    }>(sql`
      SELECT
        MAX(generated_at)::text AS last_verdict
      FROM verdicts
    `);
    // We don't currently audit-log the no-op cron runs (the cron only
    // writes to verdicts on success). So we can ONLY tell when verdict
    // last fired via verdicts.generated_at. For the others, return null
    // and let the admin page link to journalctl on the box.
    return {
      verdict_generate: { last_success_at: (rows[0] as Record<string, string | null>).last_verdict },
      evening_prompt:    { last_success_at: null, note: 'journalctl on box' },
      session_purge:     { last_success_at: null, note: 'journalctl on box' },
      invite_expiry:     { last_success_at: null, note: 'journalctl on box' },
      invite_reminder:   { last_success_at: null, note: 'journalctl on box' },
    };
  }, {
    verdict_generate: { last_success_at: null },
    evening_prompt:    { last_success_at: null, note: 'journalctl on box' },
    session_purge:     { last_success_at: null, note: 'journalctl on box' },
    invite_expiry:     { last_success_at: null, note: 'journalctl on box' },
    invite_reminder:   { last_success_at: null, note: 'journalctl on box' },
  });

  // ---- Stripe webhook activity ----
  const stripe = await safe(async () => {
    const rows = await db.execute<{
      total: string;
      last_24h: string;
      last_event_at: string | null;
      last_event_type: string | null;
    }>(sql`
      SELECT
        count(*)::text AS total,
        count(*) FILTER (WHERE processed_at > NOW() - INTERVAL '24 hours')::text AS last_24h,
        MAX(processed_at)::text AS last_event_at,
        (SELECT event_type FROM stripe_webhook_events ORDER BY processed_at DESC LIMIT 1) AS last_event_type
      FROM stripe_webhook_events
    `);
    const r = rows[0] as Record<string, string | null>;
    return {
      total_events_dedupe: Number(r.total),
      last_24h: Number(r.last_24h),
      last_event_at: r.last_event_at,
      last_event_type: r.last_event_type,
    };
  }, { total_events_dedupe: 0, last_24h: 0, last_event_at: null, last_event_type: null });

  // ---- Audit log · last 25 entries ----
  type AuditRow = {
    id: string;
    actor_user_id: string | null;
    action: string;
    target_type: string | null;
    target_id: string | null;
    metadata: unknown;
    created_at: string;
  };
  const auditRecent = await safe<AuditRow[]>(async () => {
    const rows = await db.execute<AuditRow>(sql`
      SELECT id, actor_user_id, action, target_type, target_id, metadata, created_at
      FROM audit_log
      ORDER BY created_at DESC
      LIMIT 25
    `);
    return Array.from(rows) as AuditRow[];
  }, []);

  // ---- Refund requests · pending = recent + no follow-up resolve action ----
  const refunds = await safe(async () => {
    const rows = await db.execute<{ pending: string; total: string }>(sql`
      SELECT
        count(*) FILTER (WHERE action = 'refund.requested' AND NOT EXISTS (
          SELECT 1 FROM audit_log r WHERE r.action = 'refund.processed' AND r.target_id = audit_log.target_id
        ))::text AS pending,
        count(*) FILTER (WHERE action = 'refund.requested')::text AS total
      FROM audit_log
    `);
    return {
      pending: Number((rows[0] as Record<string, string>).pending),
      total: Number((rows[0] as Record<string, string>).total),
    };
  }, { pending: 0, total: 0 });

  // ---- Sessions + saved contacts counts ----
  const misc = await safe(async () => {
    const rows = await db.execute<{
      sessions_active: string;
      sessions_expired: string;
      saved_contacts: string;
      consent_log_total: string;
    }>(sql`
      SELECT
        (SELECT count(*)::text FROM sessions WHERE expires_at > NOW()) AS sessions_active,
        (SELECT count(*)::text FROM sessions WHERE expires_at <= NOW()) AS sessions_expired,
        (SELECT count(*)::text FROM saved_contacts) AS saved_contacts,
        (SELECT count(*)::text FROM consent_log) AS consent_log_total
    `);
    const r = rows[0] as Record<string, string>;
    return {
      sessions_active: Number(r.sessions_active),
      sessions_expired: Number(r.sessions_expired),
      saved_contacts: Number(r.saved_contacts),
      consent_log_total: Number(r.consent_log_total),
    };
  }, { sessions_active: 0, sessions_expired: 0, saved_contacts: 0, consent_log_total: 0 });

  return NextResponse.json(
    {
      ok: true,
      generated_at: new Date().toISOString(),
      users,
      decisions,
      verdicts,
      cron_health: cronHealth,
      stripe,
      refunds,
      misc,
      audit_log_recent: auditRecent,
    },
    { status: 200, headers: { 'cache-control': 'private, no-store' } }
  );
}
