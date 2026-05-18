/**
 * GET /api/admin/audit-log?action=<filter>&limit=<n>&before=<iso>
 *
 * Paginated viewer over the audit_log table. Sorted newest first.
 * Query params:
 *   action  · optional · exact match on the action column (e.g. 'refund.requested')
 *   limit   · default 50, max 200
 *   before  · ISO timestamp · cursor for older pages (created_at < before)
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/admin-auth';
import { sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const url = new URL(req.url);
  const action = url.searchParams.get('action');
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 50)));
  const before = url.searchParams.get('before');

  // Build the WHERE clause safely with sql template
  const conditions: ReturnType<typeof sql>[] = [];
  if (action) conditions.push(sql`action = ${action}`);
  if (before) conditions.push(sql`created_at < ${before}::timestamptz`);
  const whereClause = conditions.length === 0
    ? sql``
    : sql`WHERE ${sql.join(conditions, sql` AND `)}`;

  const rows = await db.execute(sql`
    SELECT id, actor_user_id, action, target_type, target_id, metadata, ip_address, created_at
    FROM audit_log
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `);

  return NextResponse.json(
    {
      ok: true,
      rows,
      next_before: rows.length > 0 ? (rows[rows.length - 1] as Record<string, unknown>).created_at : null,
    },
    { status: 200, headers: { 'cache-control': 'private, no-store' } }
  );
}
