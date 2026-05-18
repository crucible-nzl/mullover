/**
 * requireAdmin · the canonical gate for every /api/admin/* route.
 *
 * Returns { userId } if the request carries a valid session AND the
 * user has users.is_admin = true. Otherwise returns a NextResponse
 * with the appropriate status (401 for no session, 403 for
 * authenticated-but-not-admin).
 *
 * Use:
 *   export async function GET(req: Request) {
 *     const gate = await requireAdmin(req);
 *     if (gate instanceof NextResponse) return gate;
 *     // ... gate.userId is the admin's user id
 *   }
 */

import { NextResponse } from 'next/server';
import { db, schema } from './db';
import { readSession, readSessionCookie } from './sessions';
import { eq } from 'drizzle-orm';

export async function requireAdmin(req: Request): Promise<{ userId: string } | NextResponse> {
  const session = await readSession(readSessionCookie(req.headers));
  if (!session) {
    return NextResponse.json({ ok: false, message: 'You must be signed in.' }, { status: 401 });
  }

  const rows = await db
    .select({ isAdmin: schema.users.isAdmin, deletedAt: schema.users.deletedAt })
    .from(schema.users)
    .where(eq(schema.users.id, session.userId))
    .limit(1);

  if (rows.length === 0 || rows[0].deletedAt !== null) {
    return NextResponse.json({ ok: false, message: 'Account not found.' }, { status: 401 });
  }
  if (!rows[0].isAdmin) {
    return NextResponse.json({ ok: false, message: 'Not authorised.' }, { status: 403 });
  }

  return { userId: session.userId };
}
