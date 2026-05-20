/**
 * GET /api/admin/users/activity?user_id=<uuid>&limit=50
 *
 * Returns the last N audit_log rows where the target user was either
 * the actor or the target. Used by the admin-users page to drill
 * into a specific account's history.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';
import { requireAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const querySchema = z.object({
  user_id: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const url = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: 'user_id (uuid) is required.' }, { status: 422 });
  }
  const { user_id, limit } = parsed.data;

  type Row = { id: string; actor_user_id: string | null; action: string; target_type: string | null; target_id: string | null; metadata: unknown; created_at: string };
  const rows = await db.execute<Row>(sql`
    SELECT id::text, actor_user_id::text, action, target_type, target_id::text, metadata, created_at::text
    FROM audit_log
    WHERE actor_user_id = ${user_id}::uuid OR target_id = ${user_id}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `);

  return NextResponse.json(
    { ok: true, user_id, count: Array.from(rows).length, events: Array.from(rows) },
    { headers: { 'cache-control': 'private, no-store' } }
  );
}
