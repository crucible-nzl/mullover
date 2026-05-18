/**
 * GET /api/health
 *
 * Liveness + readiness check. Used by:
 *   - the systemd unit's basic health probe
 *   - manual `curl https://counsel.day/api/health` after deploy
 *   - future external uptime monitor (e.g. UptimeRobot)
 *
 * Returns 200 with JSON if the process is up AND the DB responds to a
 * trivial query. 503 if the DB is unreachable. Cheap: one round-trip.
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const started = Date.now();
  try {
    const result = await db.execute(sql`SELECT 1 AS ok`);
    const dbMs = Date.now() - started;
    return NextResponse.json(
      {
        ok: true,
        db: 'ok',
        db_ms: dbMs,
        version: process.env.npm_package_version ?? 'unknown',
        node: process.version,
        started_at: new Date().toISOString(),
      },
      {
        status: 200,
        headers: {
          'cache-control': 'no-store',
        },
      }
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        db: 'fail',
        reason: (err as Error).message.slice(0, 200),
      },
      { status: 503, headers: { 'cache-control': 'no-store' } }
    );
  }
}
