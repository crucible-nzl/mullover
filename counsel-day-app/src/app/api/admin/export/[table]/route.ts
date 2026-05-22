/**
 * GET /api/admin/export/[table]?since=YYYY-MM-DD&until=YYYY-MM-DD&limit=N
 *
 * Admin-only CSV export. Whitelisted table -> SQL query -> CSV file
 * download. Operator runs from /admin.html links or curl-with-cookie.
 *
 * Supported tables today (extend the registry below to add more):
 *   users       · everyone in the users table
 *   decisions   · all decisions with status / tier / dates
 *   verdicts    · verdict rows joined to their decision question
 *   audit_log   · full audit trail with metadata serialised
 *
 * Date filters operate on each table's natural timestamp · users.created_at,
 * decisions.created_at, verdicts.generated_at, audit_log.created_at.
 *
 * Row cap default 10,000 to avoid accidentally downloading the universe.
 * Pass `limit=0` to opt into unlimited (useful for full-DB snapshots ·
 * still bounded by available memory at this scale).
 *
 * Every export writes an audit_log row (action='admin.export.csv') with
 * the table + filters + row count so the operator history is queryable.
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/admin-auth';
import { sql } from 'drizzle-orm';
import { toCsv } from '@/lib/csv';
import { schema } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type ExportSpec = {
  // ORDER of headers in the output (also the keys we look up on each row)
  headers: string[];
  // SQL builder · receives (since, until, limit) and returns the rows.
  query: (since: string | null, until: string | null, limit: number) => Promise<Array<Record<string, unknown>>>;
};

const REGISTRY: Record<string, ExportSpec> = {
  users: {
    headers: ['id','email','first_name','is_admin','email_verified_at','current_plan','marketing_consent','created_at','deleted_at'],
    query: async (since, until, limit) => {
      const limClause = limit > 0 ? sql`LIMIT ${limit}` : sql``;
      const rows = await db.execute<Record<string, unknown>>(sql`
        SELECT id, email, first_name, is_admin, email_verified_at,
               current_plan, marketing_consent, created_at, deleted_at
        FROM users
        WHERE (${since}::timestamptz IS NULL OR created_at >= ${since}::timestamptz)
          AND (${until}::timestamptz IS NULL OR created_at <= ${until}::timestamptz)
        ORDER BY created_at DESC
        ${limClause}
      `);
      return Array.from(rows) as Array<Record<string, unknown>>;
    },
  },
  decisions: {
    headers: ['id','owner_user_id','question','format','duration_days','tier','status','starts_at','unseals_at','created_at','updated_at'],
    query: async (since, until, limit) => {
      const limClause = limit > 0 ? sql`LIMIT ${limit}` : sql``;
      const rows = await db.execute<Record<string, unknown>>(sql`
        SELECT id, owner_user_id, question, format, duration_days, tier, status,
               starts_at, unseals_at, created_at, updated_at
        FROM decisions
        WHERE (${since}::timestamptz IS NULL OR created_at >= ${since}::timestamptz)
          AND (${until}::timestamptz IS NULL OR created_at <= ${until}::timestamptz)
        ORDER BY created_at DESC
        ${limClause}
      `);
      return Array.from(rows) as Array<Record<string, unknown>>;
    },
  },
  verdicts: {
    headers: ['id','decision_id','question','ai_model','tokens_input','tokens_output','cost_cents','generated_at'],
    query: async (since, until, limit) => {
      const limClause = limit > 0 ? sql`LIMIT ${limit}` : sql``;
      const rows = await db.execute<Record<string, unknown>>(sql`
        SELECT v.id, v.decision_id, d.question, v.ai_model,
               v.tokens_input, v.tokens_output, v.cost_cents, v.generated_at
        FROM verdicts v
        JOIN decisions d ON d.id = v.decision_id
        WHERE (${since}::timestamptz IS NULL OR v.generated_at >= ${since}::timestamptz)
          AND (${until}::timestamptz IS NULL OR v.generated_at <= ${until}::timestamptz)
        ORDER BY v.generated_at DESC
        ${limClause}
      `);
      return Array.from(rows) as Array<Record<string, unknown>>;
    },
  },
  audit_log: {
    headers: ['id','created_at','actor_user_id','action','target_type','target_id','metadata'],
    query: async (since, until, limit) => {
      const limClause = limit > 0 ? sql`LIMIT ${limit}` : sql``;
      const rows = await db.execute<Record<string, unknown>>(sql`
        SELECT id, created_at, actor_user_id, action, target_type, target_id, metadata
        FROM audit_log
        WHERE (${since}::timestamptz IS NULL OR created_at >= ${since}::timestamptz)
          AND (${until}::timestamptz IS NULL OR created_at <= ${until}::timestamptz)
        ORDER BY created_at DESC
        ${limClause}
      `);
      return Array.from(rows) as Array<Record<string, unknown>>;
    },
  },
};

export async function GET(req: Request, ctx: { params: Promise<{ table: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { table } = await ctx.params;

  const spec = REGISTRY[table];
  if (!spec) {
    return NextResponse.json(
      { ok: false, message: 'Unknown table. Valid: ' + Object.keys(REGISTRY).join(', ') },
      { status: 400 }
    );
  }

  const url = new URL(req.url);
  const since = url.searchParams.get('since');
  const until = url.searchParams.get('until');
  // Validate date format if supplied · YYYY-MM-DD or full ISO. Reject
  // anything that can't be parsed so we don't pass garbage into the
  // ::timestamptz cast.
  for (const [name, v] of [['since', since], ['until', until]] as Array<[string, string | null]>) {
    if (v && Number.isNaN(new Date(v).getTime())) {
      return NextResponse.json({ ok: false, message: `Invalid ${name} date.` }, { status: 400 });
    }
  }

  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw != null ? Math.max(0, Math.min(100_000, Number(limitRaw) || 0)) : 10_000;

  const rows = await spec.query(since, until, limit);
  const csv = toCsv(spec.headers, rows);

  // Audit-log the export so operator history is queryable.
  await db.insert(schema.auditLog).values({
    actorUserId: gate.userId,
    action: 'admin.export.csv',
    targetType: 'table',
    targetId: table,
    metadata: { since, until, limit, row_count: rows.length },
  }).catch(() => {});

  const filename = `counsel-day-${table}-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'private, no-store',
    },
  });
}
