/**
 * GET /api/feature-flags · returns the public-safe flag snapshot.
 *
 * Used by the static marketing site to branch on flags without server
 * rendering. Only flags in PUBLIC_FLAGS are returned · server-only
 * flags stay hidden. Cached briefly at the CDN edge so a flag flip
 * propagates within a minute.
 */

import { NextResponse } from 'next/server';
import { publicFlagsSnapshot } from '@/lib/feature-flags';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json(
    { ok: true, flags: publicFlagsSnapshot() },
    { status: 200, headers: { 'cache-control': 'public, max-age=30' } },
  );
}
