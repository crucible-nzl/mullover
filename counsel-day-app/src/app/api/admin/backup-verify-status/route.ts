/**
 * GET /api/admin/backup-verify-status
 *
 * Reads /var/log/counsel-day/backup-verify-status.json (written by
 * scripts/backup-verify.sh after every weekly run) and returns its
 * contents. Admin overview surfaces a red banner when status !== "PASS"
 * or the file is older than 8 days (means the cron didn't fire).
 *
 * Returns 200 with `{ ok: true, present: false }` when the file is
 * absent (first-deploy / fresh box) so callers don't have to special-
 * case 404s.
 */

import { NextResponse } from 'next/server';
import { readFileSync, statSync } from 'node:fs';
import { requireAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const STATUS_PATH = process.env.BACKUP_VERIFY_STATUS_FILE
  ?? '/var/log/counsel-day/backup-verify-status.json';

type ParsedStatus = {
  status?: string;
  checked_at?: string;
  backup_file?: string;
  rows?: { users?: number | null; decisions?: number | null; sessions?: number | null };
  reason?: string;
};

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  let raw: string;
  let mtimeMs: number;
  try {
    raw = readFileSync(STATUS_PATH, 'utf8');
    mtimeMs = statSync(STATUS_PATH).mtimeMs;
  } catch {
    return NextResponse.json(
      {
        ok: true,
        present: false,
        message: 'No backup-verify run recorded yet. The first verify runs Sunday 04:15 UTC after install.',
      },
      { headers: { 'cache-control': 'private, no-store' } }
    );
  }

  let parsed: ParsedStatus = {};
  try {
    parsed = JSON.parse(raw) as ParsedStatus;
  } catch {
    return NextResponse.json(
      { ok: false, present: true, message: 'Status file is not valid JSON · re-run scripts/backup-verify.sh.' },
      { status: 500 }
    );
  }

  // Stale check · the verify timer fires weekly, so anything older
  // than 8 days means the timer is broken (or the box was offline
  // through a full Sunday). Surface as a degraded state.
  const ageMs = Date.now() - mtimeMs;
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  const stale = ageDays > 8;

  const healthy = parsed.status === 'PASS' && !stale;

  return NextResponse.json(
    {
      ok: true,
      present: true,
      healthy,
      stale,
      age_days: Math.round(ageDays * 10) / 10,
      ...parsed,
    },
    { headers: { 'cache-control': 'private, no-store' } }
  );
}
