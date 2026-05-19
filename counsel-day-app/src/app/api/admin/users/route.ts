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
import { requireAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const querySchema = z.object({
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  sort: z.enum(['created_at', 'email', 'last_session_at', 'decisions']).default('created_at'),
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
    sort === 'email'             ? sql`u.email ASC` :
    sort === 'last_session_at'   ? sql`last_session_at DESC NULLS LAST` :
    sort === 'decisions'         ? sql`decision_count DESC` :
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
    last_session_at: string | null;
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
           COALESCE((SELECT count(*) FROM decisions d WHERE d.owner_user_id = u.id), 0)::text AS decision_count,
           (SELECT MAX(s.created_at)::text FROM sessions s WHERE s.user_id = u.id) AS last_session_at
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
        last_session_at: r.last_session_at,
      })),
    },
    { headers: { 'cache-control': 'private, no-store' } }
  );
}

const patchSchema = z.object({
  user_id: z.string().uuid(),
  action: z.enum(['promote', 'demote', 'soft_delete', 'restore']),
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
    return NextResponse.json({ ok: false, message: 'user_id (uuid) and action are required.' }, { status: 422 });
  }
  const { user_id, action } = parsed.data;

  // Lockout protection · the acting admin cannot demote or soft-delete
  // themselves. They can still promote others and restore others; if
  // they really want to step down they can ask a peer to demote them.
  if ((action === 'demote' || action === 'soft_delete') && user_id === gate.userId) {
    return NextResponse.json({ ok: false, message: 'You cannot ' + action + ' yourself.' }, { status: 409 });
  }

  // Verify the target exists
  const target = await db
    .select({ id: schema.users.id, email: schema.users.email, isAdmin: schema.users.isAdmin, deletedAt: schema.users.deletedAt })
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
  }

  await db.insert(schema.auditLog).values({
    actorUserId: gate.userId,
    action: 'admin.user.' + action,
    targetType: 'user',
    targetId: user_id,
    metadata: { target_email: t.email, prior_is_admin: t.isAdmin, prior_deleted_at: t.deletedAt },
  }).catch(() => {});

  return NextResponse.json({ ok: true, message: 'Action applied: ' + action }, { status: 200 });
}
