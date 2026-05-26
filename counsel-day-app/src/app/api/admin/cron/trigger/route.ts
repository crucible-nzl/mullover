/**
 * POST /api/admin/cron/trigger
 * Body: { job: 'evening-prompt' | 'verdict-generate' | 'session-purge' | 'invite-expiry' | 'invite-reminder' | 'pg-dump' | 'sitemap' }
 *
 * Triggers the named cron immediately by spawning the corresponding
 * tsx subprocess (for app crons) or systemctl unit (for ops crons).
 * Audit-logs the trigger with actor_user_id so admin-initiated runs
 * are distinguishable from timer-initiated runs.
 *
 * Limitations:
 *   · child_process.spawn happens in the Node runtime; it'll inherit
 *     the systemd service's environment which already has all env
 *     vars needed.
 *   · systemctl start requires passwordless sudo · the deploy user
 *     has it for these specific unit names.
 *   · Output streaming · we don't stream stdout; admin sees only
 *     success/fail. Detailed output is in journalctl.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@/lib/db';
import { requireAdmin } from '@/lib/admin-auth';
import { spawn } from 'child_process';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const jobSchema = z.object({
  job: z.enum([
    'evening-prompt',
    'verdict-generate',
    'session-purge',
    'invite-expiry',
    'invite-reminder',
    'hard-delete-purge',
    'audit-prune',
    'pg-dump',
    'sitemap',
    'weekly-digest',
    'security-audit',
    'journal-digest',
  ]),
});

// Map every job to the EXACT command to run. App crons go through
// `npx tsx src/jobs/cron.ts <name>`. Ops crons (sitemap, pg-dump) used
// to shell to `sudo systemctl start` but the counsel-day-app systemd
// unit has NoNewPrivileges=true (security hardening) which forbids sudo
// from inside the running app process. Both ops crons are now in-process
// tsx scripts that write to deploy-owned paths.
const jobCommand: Record<string, { cmd: string; args: string[]; cwd?: string }> = {
  'evening-prompt':    { cmd: 'npx', args: ['tsx', 'src/jobs/cron.ts', 'evening-prompt'],    cwd: '/opt/counsel-day-app' },
  'verdict-generate':  { cmd: 'npx', args: ['tsx', 'src/jobs/cron.ts', 'verdict-generate'],  cwd: '/opt/counsel-day-app' },
  'session-purge':     { cmd: 'npx', args: ['tsx', 'src/jobs/cron.ts', 'session-purge'],     cwd: '/opt/counsel-day-app' },
  'invite-expiry':     { cmd: 'npx', args: ['tsx', 'src/jobs/cron.ts', 'invite-expiry'],     cwd: '/opt/counsel-day-app' },
  'invite-reminder':   { cmd: 'npx', args: ['tsx', 'src/jobs/cron.ts', 'invite-reminder'],   cwd: '/opt/counsel-day-app' },
  'hard-delete-purge': { cmd: 'npx', args: ['tsx', 'src/jobs/cron.ts', 'hard-delete-purge'], cwd: '/opt/counsel-day-app' },
  'audit-prune':       { cmd: 'npx', args: ['tsx', 'src/jobs/cron.ts', 'audit-prune'],       cwd: '/opt/counsel-day-app' },
  'sitemap':           { cmd: 'npx', args: ['tsx', 'src/jobs/sitemap.ts'],                   cwd: '/opt/counsel-day-app' },
  'pg-dump':           { cmd: 'npx', args: ['tsx', 'src/jobs/pg-dump.ts'],                   cwd: '/opt/counsel-day-app' },
  'weekly-digest':     { cmd: 'npx', args: ['tsx', 'src/jobs/cron.ts', 'weekly-digest'],     cwd: '/opt/counsel-day-app' },
  'security-audit':    { cmd: 'npx', args: ['tsx', 'src/jobs/cron.ts', 'security-audit'],    cwd: '/opt/counsel-day-app' },
  'journal-digest':    { cmd: 'npx', args: ['tsx', 'src/jobs/cron.ts', 'journal-digest'],    cwd: '/opt/counsel-day-app' },
};

function runOnce(cmd: string, args: string[], cwd: string | undefined, timeoutMs: number): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env: process.env });
    let stdout = '';
    let stderr = '';
    let killed = false;
    const to = setTimeout(() => { killed = true; child.kill('SIGTERM'); }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d.toString(); if (stdout.length > 10000) stdout = stdout.slice(-10000); });
    child.stderr.on('data', (d) => { stderr += d.toString(); if (stderr.length > 10000) stderr = stderr.slice(-10000); });
    child.on('close', (code) => {
      clearTimeout(to);
      resolve({ exitCode: killed ? -1 : (code ?? 0), stdout: stdout.trim(), stderr: stderr.trim() });
    });
    child.on('error', (err) => {
      clearTimeout(to);
      resolve({ exitCode: -2, stdout, stderr: stderr + '\n' + String(err) });
    });
  });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  let raw: Record<string, unknown>;
  try {
    raw = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, message: 'Body must be JSON.' }, { status: 400 });
  }
  const parsed = jobSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: 'Invalid job name.' }, { status: 422 });
  }
  const { job } = parsed.data;
  const spec = jobCommand[job];

  // Audit BEFORE running so a hang is still traceable
  await db.insert(schema.auditLog).values({
    actorUserId: gate.userId,
    action: 'admin.cron.trigger',
    targetType: 'cron',
    metadata: { job },
  }).catch(() => {});

  const startedAt = Date.now();
  const result = await runOnce(spec.cmd, spec.args, spec.cwd, 5 * 60 * 1000); // 5 min cap
  const durationMs = Date.now() - startedAt;

  await db.insert(schema.auditLog).values({
    actorUserId: gate.userId,
    action: 'admin.cron.completed',
    targetType: 'cron',
    metadata: { job, exit_code: result.exitCode, duration_ms: durationMs },
  }).catch(() => {});

  return NextResponse.json({
    ok: result.exitCode === 0,
    job,
    exit_code: result.exitCode,
    duration_ms: durationMs,
    stdout: result.stdout.slice(-2000),
    stderr: result.stderr.slice(-2000),
  }, { status: result.exitCode === 0 ? 200 : 500 });
}
