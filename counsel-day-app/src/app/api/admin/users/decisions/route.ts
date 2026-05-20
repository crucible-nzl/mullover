/**
 * GET /api/admin/users/decisions?user_id=<uuid>
 *
 * Returns the list of decisions owned by the target user, with
 * status, tier, duration, vote count, and verdict-exists flag. Used
 * by the admin-users drill-down · operators can see "what has this
 * person been doing" without scraping the audit_log.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';
import { requireAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const querySchema = z.object({ user_id: z.string().uuid() });

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const url = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: 'user_id (uuid) is required.' }, { status: 422 });
  }
  const { user_id } = parsed.data;

  type Row = {
    id: string;
    question: string;
    status: string;
    tier: string;
    duration_days: number | null;
    starts_at: string | null;
    unseals_at: string | null;
    created_at: string;
    vote_count: string;
    has_verdict: boolean;
  };
  const rows = await db.execute<Row>(sql`
    SELECT d.id::text, d.question, d.status, d.tier, d.duration_days,
           d.starts_at::text, d.unseals_at::text, d.created_at::text,
           (SELECT count(*)::text FROM votes v
              JOIN participants p ON p.id = v.participant_id
              WHERE v.decision_id = d.id AND p.user_id = ${user_id}::uuid) AS vote_count,
           EXISTS(SELECT 1 FROM verdicts v WHERE v.decision_id = d.id) AS has_verdict
    FROM decisions d
    WHERE d.owner_user_id = ${user_id}::uuid
    ORDER BY d.created_at DESC
    LIMIT 100
  `);

  return NextResponse.json(
    { ok: true, user_id, count: Array.from(rows).length, decisions: Array.from(rows).map((r) => ({ ...r, vote_count: Number(r.vote_count) })) },
    { headers: { 'cache-control': 'private, no-store' } }
  );
}
