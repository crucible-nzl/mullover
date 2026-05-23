/**
 * GET /api/admin/security-audit
 *
 * Returns the latest npm-audit snapshot persisted by the daily
 * security-audit cron. Snapshot lives at
 * /var/log/counsel-day/security-audit-latest.json · the cron job
 * writes it after every run.
 *
 * Admin-only. No auth-logging on read (purely informational); the
 * cron writes its own audit_log entry on every alert.
 *
 * Returns:
 *   200 { ok: true, snapshot }   when a snapshot exists
 *   200 { ok: true, snapshot: null, message } when no run has happened yet
 */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { readLatestSnapshot } from '@/lib/security-audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const snapshot = await readLatestSnapshot();
  if (!snapshot) {
    return NextResponse.json(
      {
        ok: true,
        snapshot: null,
        message: 'No security-audit run yet. Trigger one from /admin.html · Cron controls · security-audit.',
      },
      { status: 200, headers: { 'cache-control': 'private, no-store' } }
    );
  }

  return NextResponse.json(
    { ok: true, snapshot },
    { status: 200, headers: { 'cache-control': 'private, no-store' } }
  );
}
