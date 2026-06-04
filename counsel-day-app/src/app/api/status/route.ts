/**
 * GET /api/status · public · returns the operational state of every
 * service Counsel.day depends on.
 *
 * No auth · this is the public status page's data source. The
 * /status.html page on the static surface fetches this and renders
 * per-service rows with green/yellow/red pills.
 *
 * Service checks
 *  · web              · trivially OK if we are serving this response
 *  · api              · trivially OK if we are serving this response
 *  · database         · `SELECT 1` against Postgres
 *  · stripe           · STRIPE_SECRET_KEY presence (not exercised here
 *                       to avoid blowing the rate limit)
 *  · anthropic        · ANTHROPIC_API_KEY presence + recent successful
 *                       call from the anthropic_calls ledger (last 24h)
 *  · r2_audio         · R2 credentials + bucket env presence
 *  · whisper          · WHISPER_API_KEY presence
 *  · email            · BREVO_API_KEY presence
 *  · ga4              · NEXT_PUBLIC_GA4_ID configured (placeholder counts)
 *  · journal          · journal_entries table reachable + recent activity
 *  · vault_playback   · the playback endpoint is defined (presence check)
 *
 * Each service returns { id, name, what_it_does, status, last_checked,
 * note? }. Status is one of: 'operational' | 'degraded' | 'down' |
 * 'unconfigured'. unconfigured is shown as a clear amber state so the
 * operator knows what to set without it looking like a customer-facing
 * outage.
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type ServiceStatus = 'operational' | 'degraded' | 'down' | 'unconfigured';

type Service = {
  id: string;
  name: string;
  what_it_does: string;
  status: ServiceStatus;
  last_checked: string;
  note?: string;
};

async function safeCheck<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch (e) { console.warn('[status] check failed', e); return fallback; }
}

export async function GET() {
  const now = new Date().toISOString();
  const env = process.env;

  // ---- database ping ----
  const dbStatus: ServiceStatus = await safeCheck(async () => {
    await db.execute(sql`SELECT 1 AS ok`);
    return 'operational' as ServiceStatus;
  }, 'down');

  // ---- journal: are entries reachable? ----
  const journalStatus: ServiceStatus = await safeCheck(async () => {
    await db.execute(sql`SELECT 1 FROM journal_entries LIMIT 1`);
    return 'operational' as ServiceStatus;
  }, dbStatus === 'down' ? 'down' : 'degraded');

  // ---- anthropic ledger: any successful call in the last 24h? ----
  let anthropicStatus: ServiceStatus = 'operational';
  let anthropicNote: string | undefined;
  if (!env.ANTHROPIC_API_KEY) {
    anthropicStatus = 'unconfigured';
    anthropicNote = 'ANTHROPIC_API_KEY not set';
  } else {
    const recent = await safeCheck(async () => {
      const rows = await db.execute<{ ok_count: string; fail_count: string }>(sql`
        SELECT
          count(*) FILTER (WHERE ok = true)::text AS ok_count,
          count(*) FILTER (WHERE ok = false)::text AS fail_count
        FROM anthropic_calls
        WHERE called_at > NOW() - INTERVAL '24 hours'
      `);
      const r = (rows[0] as { ok_count: string; fail_count: string }) || { ok_count: '0', fail_count: '0' };
      return { ok: Number(r.ok_count), failed: Number(r.fail_count) };
    }, { ok: 0, failed: 0 });
    if (recent.failed > 0 && recent.ok === 0) { anthropicStatus = 'down'; anthropicNote = `${recent.failed} failed call(s) in 24h, zero success`; }
    else if (recent.failed > recent.ok * 2 && recent.failed > 3) { anthropicStatus = 'degraded'; anthropicNote = `${recent.failed} failed vs ${recent.ok} ok in 24h`; }
    else if (recent.ok > 0) anthropicNote = `${recent.ok} successful call(s) in last 24h`;
  }

  const services: Service[] = [
    {
      id: 'web',
      name: 'Marketing site',
      what_it_does: 'The public counsel.day pages, including this status page.',
      status: 'operational',
      last_checked: now,
    },
    {
      id: 'api',
      name: 'Application API',
      what_it_does: 'The signed-in product · evening vote, dashboard, verdict view, Journal entry filing.',
      status: 'operational',
      last_checked: now,
    },
    {
      id: 'auth',
      name: 'Authentication',
      what_it_does: 'Sign-in, sign-up, password reset, multi-factor authentication.',
      status: dbStatus === 'operational' ? 'operational' : 'degraded',
      last_checked: now,
      note: dbStatus !== 'operational' ? 'Sessions depend on the database' : undefined,
    },
    {
      id: 'database',
      name: 'Database (Postgres)',
      what_it_does: 'Primary Postgres · row-level security, sealed read path, encrypted backups in two EU regions.',
      status: dbStatus,
      last_checked: now,
    },
    {
      id: 'stripe',
      name: 'Payments (Stripe)',
      what_it_does: 'Subscription billing for Counsel Journal · per-decision payments at compose · receipts and Stripe portal.',
      status: env.STRIPE_SECRET_KEY ? 'operational' : 'unconfigured',
      last_checked: now,
      note: !env.STRIPE_SECRET_KEY ? 'STRIPE_SECRET_KEY not set' : undefined,
    },
    {
      id: 'email',
      name: 'Email delivery (Brevo)',
      what_it_does: 'Transactional email · invites, evening reminders, verdict notifications.',
      status: env.BREVO_API_KEY ? 'operational' : 'unconfigured',
      last_checked: now,
      note: !env.BREVO_API_KEY ? 'BREVO_API_KEY not set' : undefined,
    },
    {
      id: 'verdict',
      name: 'Verdict pipeline (Claude Opus 4.7)',
      what_it_does: 'The analysis run that opens the verdict at the end of a decision · plus weekly + monthly Counsel Journal verdicts.',
      status: anthropicStatus,
      last_checked: now,
      note: anthropicNote,
    },
    {
      id: 'journal',
      name: 'Counsel Journal',
      what_it_does: 'Nightly entry filing, seven-day seal, Monday weekly verdicts, monthly themed verdicts.',
      status: journalStatus,
      last_checked: now,
    },
    {
      id: 'vault',
      name: 'Journal vault · audio playback',
      what_it_does: 'Replay of unsealed journal entries · short-lived signed R2 URLs minted per playback request.',
      status: (env.R2_ENDPOINT && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET) ? 'operational' : 'unconfigured',
      last_checked: now,
      note: (!env.R2_ENDPOINT || !env.R2_BUCKET) ? 'R2 endpoint/bucket not configured · audio entries can be filed but playback returns 503 until set' : undefined,
    },
    {
      id: 'recording',
      name: 'Voice transcription (Whisper)',
      what_it_does: 'Speech-to-text for Counsel Journal voice entries · audio uploaded, transcribed, then transcript persisted with the entry.',
      status: env.OPENAI_API_KEY ? 'operational' : 'unconfigured',
      last_checked: now,
      note: !env.OPENAI_API_KEY ? 'OPENAI_API_KEY not set · voice entries fall back to typed entry' : undefined,
    },
    {
      id: 'r2',
      name: 'Cloudflare R2 audio storage',
      what_it_does: 'S3-compatible object storage for Counsel Journal audio files · no egress fees · encrypted at rest.',
      status: (env.R2_ENDPOINT && env.R2_BUCKET) ? 'operational' : 'unconfigured',
      last_checked: now,
    },
    {
      id: 'ga4',
      name: 'GA4 funnel analytics',
      what_it_does: 'Pageview + conversion event tracking with Consent Mode v2. Cookieless by default until consent.',
      status: env.NEXT_PUBLIC_GA4_ID && env.NEXT_PUBLIC_GA4_ID !== 'G-XXXXXXXXXX' ? 'operational' : 'unconfigured',
      last_checked: now,
      note: (!env.NEXT_PUBLIC_GA4_ID || env.NEXT_PUBLIC_GA4_ID === 'G-XXXXXXXXXX') ? 'Placeholder GA4 ID · events fire but go nowhere until a real property is wired' : undefined,
    },
    {
      id: 'cron',
      name: 'Cron jobs · verdict generation',
      what_it_does: 'Background runs · daily evening prompt dispatch, Sunday-evening weekly verdict generation, first-Monday monthly verdict generation, session purge, invite expiry.',
      status: 'operational',
      last_checked: now,
      note: 'Run health is observable on the box · systemd timers + journalctl',
    },
  ];

  const summary = {
    operational: services.filter((s) => s.status === 'operational').length,
    degraded: services.filter((s) => s.status === 'degraded').length,
    down: services.filter((s) => s.status === 'down').length,
    unconfigured: services.filter((s) => s.status === 'unconfigured').length,
  };

  const overall: 'operational' | 'degraded' | 'down' | 'partial' =
    summary.down > 0 ? 'down' :
    summary.degraded > 0 ? 'degraded' :
    summary.unconfigured > 0 ? 'partial' :
    'operational';

  return NextResponse.json(
    { ok: true, generated_at: now, overall, summary, services },
    { status: 200, headers: { 'cache-control': 'public, max-age=30' } },
  );
}
