/**
 * GET /api/admin/practitioner-pipeline · returns all applications grouped
 * by outreach_stage. Used by /admin-practitioner-pipeline.html to render
 * a kanban-style board.
 *
 * PATCH /api/admin/practitioner-pipeline · update a single application's
 * outreach_stage, outreach_notes, last_contacted_at, or tags. Audit-logs
 * the change.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@/lib/db';
import { requireAdmin } from '@/lib/admin-auth';
import { sql, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const STAGES = ['new', 'contacted', 'replied', 'meeting_set', 'converted', 'declined', 'dormant'] as const;

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  // One query returns all rows · the page is small enough (<1000 leads
  // for a long time) that pagination isn't needed yet. Order by recency
  // within each stage so the freshest leads bubble to the top.
  type Row = {
    id: string;
    kind: string;
    first_name: string;
    last_name: string;
    email: string;
    practice_name: string;
    role: string;
    country: string;
    status: string;
    outreach_stage: string;
    outreach_notes: string | null;
    last_contacted_at: string | null;
    source: string;
    tags: unknown;
    notes: string | null;
    created_at: string;
    referral_code: string | null;
  };
  const rows = await db.execute<Row>(sql`
    SELECT id::text, kind, first_name, last_name, email, practice_name, role, country,
           status, outreach_stage, outreach_notes,
           last_contacted_at::text AS last_contacted_at,
           source, tags, notes,
           created_at::text AS created_at,
           referral_code
    FROM practitioner_applications
    ORDER BY outreach_stage, last_contacted_at DESC NULLS LAST, created_at DESC
  `);

  // Group by outreach_stage so the kanban can render directly.
  const byStage: Record<string, Row[]> = {};
  STAGES.forEach((s) => { byStage[s] = []; });
  const arr = Array.from(rows) as Row[];
  arr.forEach((r) => {
    const s = STAGES.includes(r.outreach_stage as typeof STAGES[number]) ? r.outreach_stage : 'new';
    byStage[s].push(r);
  });

  // Stage totals for the header summary.
  const counts = Object.fromEntries(STAGES.map((s) => [s, byStage[s].length]));

  return NextResponse.json(
    { ok: true, stages: STAGES, by_stage: byStage, counts, total: arr.length },
    { status: 200, headers: { 'cache-control': 'private, no-store' } },
  );
}

const patchSchema = z.object({
  id: z.string().uuid(),
  outreach_stage: z.enum(STAGES).optional(),
  outreach_notes: z.string().trim().max(8000).optional(),
  bump_last_contacted: z.boolean().optional(),
  tags: z.array(z.string().trim().max(40)).max(20).optional(),
});

export async function PATCH(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  let raw: unknown;
  try { raw = await req.json(); } catch {
    return NextResponse.json({ ok: false, message: 'Body must be JSON.' }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: 'Invalid body.', field_errors: parsed.error.flatten().fieldErrors }, { status: 422 });
  }
  const body = parsed.data;

  // Build the SET clause from the fields supplied.
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.outreach_stage !== undefined) updates.outreachStage = body.outreach_stage;
  if (body.outreach_notes !== undefined) updates.outreachNotes = body.outreach_notes;
  if (body.bump_last_contacted === true) updates.lastContactedAt = new Date();
  if (body.tags !== undefined) updates.tags = body.tags;

  if (Object.keys(updates).length === 1) {
    return NextResponse.json({ ok: false, message: 'Nothing to update.' }, { status: 400 });
  }

  try {
    await db.update(schema.practitionerApplications)
      .set(updates)
      .where(eq(schema.practitionerApplications.id, body.id));

    // Audit-log the change so we can see who moved a lead where.
    try {
      await db.execute(sql`
        INSERT INTO audit_log (action, target_type, target_id, actor_user_id, metadata)
        VALUES ('practitioner.pipeline.updated', 'practitioner_application', ${body.id}, ${gate.userId}, ${JSON.stringify({ updates: Object.keys(updates) })}::jsonb)
      `);
    } catch (e) {
      console.warn('[pipeline] audit insert failed:', (e as Error).message);
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e) {
    console.warn('[pipeline] update failed', e);
    return NextResponse.json({ ok: false, message: 'Update failed.' }, { status: 500 });
  }
}
