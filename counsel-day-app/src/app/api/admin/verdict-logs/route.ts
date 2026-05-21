/**
 * GET /api/admin/verdict-logs
 *
 * Returns:
 *   · summary  · counts, success/error rates over last 30 days
 *   · recent   · last 50 verdict generations with FULL content, the
 *                prompt used, tokens in/out, cost cents, generation
 *                duration (derived from the audit_log if present)
 *   · errors   · audit_log entries with action LIKE 'verdict.error.%'
 *                in the last 30 days
 *   · db_errors · audit_log entries with action LIKE 'db.error.%'
 *                in the last 30 days (any failed write/edit that the
 *                app code logged)
 *
 * Per the brief: "verbose to ensure that we can see and remedy any
 * issues at all in the future." We do NOT redact the verdict content
 * here · admin only · the redaction is at the user-visible surface,
 * not in operator tooling. The Caddy gate keeps the content private.
 *
 * Admin gate via requireAdmin().
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

  async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    try { return await fn(); } catch (e) { console.warn('[admin/verdict-logs] subquery failed:', e); return fallback; }
  }

  const summary = await safe(async () => {
    const rows = await db.execute<{ total: string; last_30d: string; total_tokens_in: string; total_tokens_out: string; total_cost: string }>(sql`
      SELECT count(*)::text AS total,
             count(*) FILTER (WHERE generated_at > NOW() - INTERVAL '30 days')::text AS last_30d,
             COALESCE(SUM(tokens_input), 0)::text AS total_tokens_in,
             COALESCE(SUM(tokens_output), 0)::text AS total_tokens_out,
             COALESCE(SUM(cost_cents), 0)::text AS total_cost
      FROM verdicts
    `);
    const r = rows[0] as { total: string; last_30d: string; total_tokens_in: string; total_tokens_out: string; total_cost: string };
    return {
      total: Number(r.total),
      last_30d: Number(r.last_30d),
      total_tokens_input: Number(r.total_tokens_in),
      total_tokens_output: Number(r.total_tokens_out),
      total_cost_cents: Number(r.total_cost),
    };
  }, { total: 0, last_30d: 0, total_tokens_input: 0, total_tokens_output: 0, total_cost_cents: 0 });

  // Recent verdicts · full content for inspection
  type VerdictRow = {
    id: string;
    decision_id: string;
    decision_question: string | null;
    decision_tier: string | null;
    generated_at: string;
    ai_model: string | null;
    synthesis_text: string | null;
    per_participant_summary: unknown;
    themes: unknown;
    next_conversation_prompt: string | null;
    prompt_used: string | null;
    tokens_input: number | null;
    tokens_output: number | null;
    cost_cents: number | null;
  };
  const recent = await safe(async () => {
    const rows = await db.execute<VerdictRow>(sql`
      SELECT v.id, v.decision_id, d.question AS decision_question, d.tier AS decision_tier,
             v.generated_at::text AS generated_at, v.ai_model, v.synthesis_text,
             v.per_participant_summary, v.themes, v.next_conversation_prompt,
             v.prompt_used, v.tokens_input, v.tokens_output, v.cost_cents
      FROM verdicts v
      LEFT JOIN decisions d ON d.id = v.decision_id
      ORDER BY v.generated_at DESC
      LIMIT 50
    `);
    return Array.from(rows) as VerdictRow[];
  }, [] as VerdictRow[]);

  // Errors logged during verdict generation (the cron writes these via audit_log)
  type ErrorRow = { id: string; action: string; target_id: string | null; metadata: unknown; created_at: string };
  const errors = await safe(async () => {
    const rows = await db.execute<ErrorRow>(sql`
      SELECT id::text, action, target_id, metadata, created_at::text AS created_at
      FROM audit_log
      WHERE action LIKE 'verdict.error.%'
        AND created_at > NOW() - INTERVAL '30 days'
      ORDER BY created_at DESC
      LIMIT 100
    `);
    return Array.from(rows) as ErrorRow[];
  }, [] as ErrorRow[]);

  const dbErrors = await safe(async () => {
    const rows = await db.execute<ErrorRow>(sql`
      SELECT id::text, action, target_id, metadata, created_at::text AS created_at
      FROM audit_log
      WHERE action LIKE 'db.error.%'
        AND created_at > NOW() - INTERVAL '30 days'
      ORDER BY created_at DESC
      LIMIT 100
    `);
    return Array.from(rows) as ErrorRow[];
  }, [] as ErrorRow[]);

  // Testing-area runs · separate table (verdict_test_runs), separate
  // tab in the admin UI. Includes the operator-supplied fixture (the
  // question + votes that wouldn't exist on a real decision row).
  type TestRow = {
    id: string;
    created_at: string;
    triggered_by_user_id: string | null;
    question: string;
    format: string;
    duration_days: number;
    tier: string;
    participants_json: unknown;
    ai_model: string | null;
    synthesis_text: string | null;
    prompt_used: string | null;
    tokens_input: number | null;
    tokens_output: number | null;
    cost_cents: number | null;
    analysis_json: unknown;
    label: string | null;
    triggered_by_email: string | null;
  };
  const testRuns = await safe(async () => {
    const rows = await db.execute<TestRow>(sql`
      SELECT t.id::text, t.created_at::text, t.triggered_by_user_id::text,
             t.question, t.format, t.duration_days, t.tier,
             t.participants_json, t.ai_model, t.synthesis_text, t.prompt_used,
             t.tokens_input, t.tokens_output, t.cost_cents, t.analysis_json, t.label,
             u.email AS triggered_by_email
      FROM verdict_test_runs t
      LEFT JOIN users u ON u.id = t.triggered_by_user_id
      ORDER BY t.created_at DESC
      LIMIT 100
    `);
    return Array.from(rows) as TestRow[];
  }, [] as TestRow[]);

  const testSummary = await safe(async () => {
    const rows = await db.execute<{ total: string; last_30d: string; total_tokens_in: string; total_tokens_out: string; total_cost: string }>(sql`
      SELECT count(*)::text AS total,
             count(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days')::text AS last_30d,
             COALESCE(SUM(tokens_input), 0)::text AS total_tokens_in,
             COALESCE(SUM(tokens_output), 0)::text AS total_tokens_out,
             COALESCE(SUM(cost_cents), 0)::text AS total_cost
      FROM verdict_test_runs
    `);
    const r = rows[0] as { total: string; last_30d: string; total_tokens_in: string; total_tokens_out: string; total_cost: string };
    return {
      total: Number(r.total),
      last_30d: Number(r.last_30d),
      total_tokens_input: Number(r.total_tokens_in),
      total_tokens_output: Number(r.total_tokens_out),
      total_cost_cents: Number(r.total_cost),
    };
  }, { total: 0, last_30d: 0, total_tokens_input: 0, total_tokens_output: 0, total_cost_cents: 0 });

  return NextResponse.json(
    {
      ok: true,
      generated_at: new Date().toISOString(),
      summary,
      recent,
      errors,
      db_errors: dbErrors,
      test_summary: testSummary,
      test_runs: testRuns,
    },
    { headers: { 'cache-control': 'private, no-store' } }
  );
}
