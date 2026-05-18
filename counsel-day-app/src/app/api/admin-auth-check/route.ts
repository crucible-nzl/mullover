/**
 * GET /api/admin-auth-check
 *
 * Called by Caddy's `forward_auth` on every request to /admin*.
 * Returns 200 only for authenticated admins. Caddy interprets
 * 401/403 as "block" and redirects to /signin.
 *
 * Identical contract to /api/auth-check but with the extra
 * is_admin gate on top.
 */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({ ok: true }, { status: 200 });
}
