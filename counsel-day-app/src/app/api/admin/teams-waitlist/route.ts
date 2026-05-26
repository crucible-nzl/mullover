/**
 * GET   /api/admin/teams-waitlist          · list all signups
 * PATCH /api/admin/teams-waitlist          · update status / contacted_at
 *
 * Admin-only. Lets the operator triage the Counsel · Teams waitlist
 * collected by POST /api/teams/waitlist. Sort: newest first by default.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@/lib/db';
import { desc, eq } from 'drizzle-orm';
import { requireAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const rows = await db
    .select()
    .from(schema.teamsWaitlist)
    .orderBy(desc(schema.teamsWaitlist.createdAt))
    .limit(500);

  return NextResponse.json(
    {
      ok: true,
      generated_at: new Date().toISOString(),
      total: rows.length,
      signups: rows.map((r) => ({
        id: r.id,
        email: r.email,
        full_name: r.fullName,
        company: r.company,
        role: r.role,
        team_size: r.teamSize,
        country: r.country,
        source: r.source,
        notes: r.notes,
        contacted_at: r.contactedAt,
        status: r.status,
        created_at: r.createdAt,
      })),
    },
    { headers: { 'cache-control': 'private, no-store' } }
  );
}

const patchSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['pending', 'contacted', 'qualified', 'not_a_fit', 'piloted']).optional(),
  notes: z.string().trim().max(2000).optional(),
  mark_contacted: z.boolean().optional(),
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
    return NextResponse.json({ ok: false, message: 'id is required (uuid).' }, { status: 422 });
  }
  const { id, status, notes, mark_contacted } = parsed.data;
  const update: Record<string, unknown> = {};
  if (status !== undefined) update.status = status;
  if (notes !== undefined) update.notes = notes;
  if (mark_contacted) update.contactedAt = new Date();
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: false, message: 'Nothing to update.' }, { status: 422 });
  }

  await db.update(schema.teamsWaitlist).set(update).where(eq(schema.teamsWaitlist.id, id));
  await db.insert(schema.auditLog).values({
    actorUserId: gate.userId,
    action: 'admin.teams_waitlist.updated',
    targetType: 'teams_waitlist',
    targetId: id,
    metadata: { status: status ?? null, mark_contacted: !!mark_contacted },
  }).catch(() => {});

  return NextResponse.json({ ok: true, message: 'Updated.' });
}
