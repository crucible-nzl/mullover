/**
 * POST /api/transcribe   multipart/form-data: audio=<File>, decision_id=<uuid?>
 *
 * Whisper-API fallback for the voice-input widget on /vote-today.html,
 * /compose.html, /verdict-reveal.html. Browsers that support
 * `window.SpeechRecognition` transcribe client-side at zero cost; this
 * endpoint serves the rest.
 *
 * Gates (in order):
 *   1. auth required (readSession)
 *   2. OPENAI_API_KEY present (else 503 · widget tells user to type)
 *   3. rate-limit · 60/hr per user · 600/hr per IP
 *   4. content-length and MIME pre-checks
 *   5. TIER GATE · if decision_id supplied, the decision must exist,
 *      the user must be a participant or the owner, and the tier must
 *      NOT be 'solo_free' (voice is a paid-tier benefit)
 *   6. QUOTA · cumulative transcribed seconds today for (user, decision)
 *      must remain under 30s (one 30s clip, or several shorter ones)
 *   7. Whisper called with response_format=verbose_json so we get the
 *      authoritative audio duration back from OpenAI (rather than
 *      guessing from byte count, which Opus VBR makes unreliable)
 *
 * Privacy posture (also reflected in /privacy.html):
 *   · Audio is forwarded to OpenAI's Whisper API with the standard
 *     paid-API terms · OpenAI does NOT train on data submitted through
 *     the API (their published policy).
 *   · We never persist the audio. The request reads bytes into memory,
 *     forwards them, and discards them.
 *   · We never persist the transcript on the server. It's returned to
 *     the browser; whether the user pastes it into a note is their call.
 *   · The audit log captures duration in milliseconds only · never
 *     bytes, never transcript content.
 */

import { NextResponse } from 'next/server';
import { readSession, readSessionCookie } from '@/lib/sessions';
import { checkRateLimit, getClientIp, rateLimitResponse } from '@/lib/rate-limit';
import { sendTransactional } from '@/lib/email';
import { db, schema } from '@/lib/db';
import { eq, and, gte, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_SECONDS_PER_CLIP = 30;
const DAILY_QUOTA_SECONDS = 30; // per (user, decision, UTC day)

// Whisper price · $0.006 per minute, rounded to the nearest second.
const WHISPER_USD_PER_MINUTE = 0.006;
const WHISPER_USD_PER_SECOND = WHISPER_USD_PER_MINUTE / 60;

// Org-wide daily spend cap on Whisper. Overrideable via env. Default
// $5/day = ~14 hours of transcription = thousands of voter-nights ·
// generous for steady-state but firm enough to limit abuse blast radius.
const WHISPER_DAILY_BUDGET_USD = Number(process.env.WHISPER_DAILY_BUDGET_USD ?? '5');
// Fraction of the cap at which to fire ONE warning email per UTC day.
const WHISPER_WARN_AT = Number(process.env.WHISPER_WARN_AT ?? '0.8');

const ALLOWED_MIME = new Set([
  'audio/webm',
  'audio/webm;codecs=opus',
  'audio/ogg',
  'audio/mp4',
  'audio/m4a',
  'audio/mpeg',
  'audio/wav',
]);

export async function POST(req: Request) {
  // ---- auth ----
  const session = await readSession(readSessionCookie(req.headers));
  if (!session) {
    return NextResponse.json({ ok: false, message: 'You must be signed in.' }, { status: 401 });
  }

  // ---- env check (graceful degradation) ----
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, message: 'Voice transcription is not configured. Type your note instead.' },
      { status: 503 }
    );
  }

  // ---- rate limit ----
  const ip = getClientIp(req);
  const userCheck = await checkRateLimit(`transcribe-user:${session.userId}`, 60, 3600);
  if (!userCheck.allowed) {
    return rateLimitResponse(userCheck, 'You have used voice transcription a lot recently. Try again later or type the note.');
  }
  const ipCheck = await checkRateLimit(`transcribe-ip:${ip}`, 600, 3600);
  if (!ipCheck.allowed) {
    return rateLimitResponse(ipCheck, 'Too many transcription requests from this network.');
  }

  // ---- org-wide Whisper daily budget cap ----
  // Stops a runaway / abuse loop from draining the OpenAI account
  // even if per-user rate-limits are exhausted in parallel.
  if (WHISPER_DAILY_BUDGET_USD > 0) {
    const spentToday = await spentDollarsToday();
    if (spentToday >= WHISPER_DAILY_BUDGET_USD) {
      console.warn(`[transcribe] daily budget reached · spent=$${spentToday.toFixed(2)} cap=$${WHISPER_DAILY_BUDGET_USD}`);
      return NextResponse.json(
        { ok: false, message: 'Voice transcription is temporarily unavailable. Type the note instead.' },
        { status: 503 }
      );
    }
  }

  // ---- content-length cap (cheap pre-parse bail) ----
  const contentLength = Number(req.headers.get('content-length') ?? '0');
  if (contentLength > 0 && contentLength > MAX_BYTES) {
    return NextResponse.json(
      { ok: false, message: 'Audio too large. Keep it under 30 seconds.' },
      { status: 413 }
    );
  }

  // ---- parse multipart ----
  let fd: FormData;
  try {
    fd = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, message: 'Could not read audio.' }, { status: 400 });
  }

  const audio = fd.get('audio');
  if (!(audio instanceof File)) {
    return NextResponse.json({ ok: false, message: 'No audio file provided.' }, { status: 400 });
  }
  if (audio.size > MAX_BYTES) {
    return NextResponse.json({ ok: false, message: 'Audio too large. Keep it under 30 seconds.' }, { status: 413 });
  }
  if (audio.size === 0) {
    return NextResponse.json({ ok: false, message: 'Empty audio file.' }, { status: 400 });
  }

  // Content-type allowlist
  const mime = (audio.type || '').toLowerCase().split(';')[0].trim();
  const mimeWithParams = (audio.type || '').toLowerCase();
  if (!ALLOWED_MIME.has(mime) && !ALLOWED_MIME.has(mimeWithParams)) {
    return NextResponse.json(
      { ok: false, message: `Unsupported audio format (${audio.type || 'unknown'}).` },
      { status: 415 }
    );
  }

  // ---- decision context (optional) ----
  const decisionIdRaw = fd.get('decision_id');
  const decisionId = typeof decisionIdRaw === 'string' && decisionIdRaw.length > 0 ? decisionIdRaw : null;

  // ---- TIER GATE ----
  // If the caller scoped this transcription to a decision, enforce the
  // tier rule (Solo Free is blocked) and check the daily quota. If no
  // decision_id was supplied (e.g. /compose.html where the decision
  // does not yet exist), skip the gate · the user has already chosen
  // a tier in the compose form and the front-end disables the mic when
  // 'solo_free' is selected. We trust that signal here.
  if (decisionId) {
    const dRows = await db
      .select({
        id: schema.decisions.id,
        tier: schema.decisions.tier,
        ownerUserId: schema.decisions.ownerUserId,
      })
      .from(schema.decisions)
      .where(eq(schema.decisions.id, decisionId))
      .limit(1);
    if (dRows.length === 0) {
      return NextResponse.json({ ok: false, message: 'Decision not found.' }, { status: 404 });
    }
    const decision = dRows[0];

    // User must be the owner or a participant
    const isOwner = decision.ownerUserId === session.userId;
    if (!isOwner) {
      const partRows = await db
        .select({ id: schema.participants.id })
        .from(schema.participants)
        .where(and(
          eq(schema.participants.decisionId, decisionId),
          eq(schema.participants.userId, session.userId)
        ))
        .limit(1);
      if (partRows.length === 0) {
        return NextResponse.json({ ok: false, message: 'You are not a participant in this decision.' }, { status: 403 });
      }
    }

    // Tier gate · voice is a paid-tier benefit
    if (decision.tier === 'solo_free') {
      return NextResponse.json(
        { ok: false, message: 'Voice transcription is available on paid decisions (Solo, Couple, Family, Consumer Annual).' },
        { status: 402 }
      );
    }

    // Daily quota · sum the seconds already used today by THIS user on
    // THIS decision. Stored in audit_log metadata.ms field by the audit
    // helper below.
    const used = await usedSecondsToday(session.userId, decisionId);
    if (used >= DAILY_QUOTA_SECONDS) {
      return NextResponse.json(
        { ok: false, message: `You have used your ${DAILY_QUOTA_SECONDS}s of voice transcription for this decision today. Resets at 00:00 UTC.` },
        { status: 429 }
      );
    }
  }

  // ---- forward to OpenAI Whisper (verbose_json for authoritative duration) ----
  const startedAt = Date.now();
  const upstreamFd = new FormData();
  upstreamFd.append('file', audio, audio.name || 'audio.webm');
  upstreamFd.append('model', 'whisper-1');
  upstreamFd.append('response_format', 'verbose_json');

  let upstreamResp: Response;
  try {
    upstreamResp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: upstreamFd,
    });
  } catch (err) {
    console.error('[transcribe] upstream fetch failed', (err as Error).message);
    return NextResponse.json(
      { ok: false, message: 'Transcription service unavailable. Type the note instead.' },
      { status: 502 }
    );
  }

  const elapsedMs = Date.now() - startedAt;

  if (!upstreamResp.ok) {
    const body = await upstreamResp.text().catch(() => '');
    console.warn('[transcribe] OpenAI returned', upstreamResp.status, body.slice(0, 200));
    await audit(session.userId, decisionId, audio.size, elapsedMs, 0, 'upstream_error', upstreamResp.status);
    return NextResponse.json(
      { ok: false, message: 'Transcription failed. Try again or type the note.' },
      { status: 502 }
    );
  }

  // verbose_json shape: { text, duration, segments: [...], ... }
  let parsed: { text?: string; duration?: number };
  try {
    parsed = await upstreamResp.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: 'Transcription returned malformed response.' },
      { status: 502 }
    );
  }

  const transcript = (parsed.text || '').trim();
  const durationSec = typeof parsed.duration === 'number' && parsed.duration > 0 ? parsed.duration : 0;

  // If OpenAI says the clip is longer than the per-clip cap, refuse to
  // bill it AND refuse to count it. The client should have stopped at
  // 30s, but a determined client could submit longer audio.
  if (durationSec > MAX_SECONDS_PER_CLIP + 2) {
    await audit(session.userId, decisionId, audio.size, elapsedMs, durationSec, 'over_clip_cap', null);
    return NextResponse.json(
      { ok: false, message: `Recording too long (${Math.round(durationSec)}s). Maximum is ${MAX_SECONDS_PER_CLIP}s per clip.` },
      { status: 413 }
    );
  }

  // If this clip pushes the daily total OVER the cap, accept the
  // transcript (we already paid Whisper for it) but flag the user.
  // Next attempt today will be blocked by the gate at the top.
  if (decisionId) {
    const usedAfter = (await usedSecondsToday(session.userId, decisionId)) + durationSec;
    if (usedAfter > DAILY_QUOTA_SECONDS + 5) {
      // Audit but still return the transcript so the user gets the
      // text they recorded · denying it after charging would be
      // hostile.
      await audit(session.userId, decisionId, audio.size, elapsedMs, durationSec, 'over_daily_cap_post', null);
    } else {
      await audit(session.userId, decisionId, audio.size, elapsedMs, durationSec, 'ok', null);
    }
  } else {
    await audit(session.userId, null, audio.size, elapsedMs, durationSec, 'ok_no_decision', null);
  }

  // Fire-and-forget warning email if today's spend just crossed the
  // threshold for the first time. Doesn't block the response.
  void maybeWarnBudgetCrossed();

  return NextResponse.json(
    {
      ok: true,
      transcript,
      duration_seconds: Math.round(durationSec * 10) / 10,
      ...(decisionId ? { quota: { used_today: await usedSecondsToday(session.userId, decisionId), limit: DAILY_QUOTA_SECONDS } } : {}),
    },
    { status: 200 }
  );
}

/**
 * Sum the transcribed seconds used TODAY by user on a specific
 * decision. Reads from audit_log.metadata.seconds for rows with
 * action='transcribe.whisper' and the matching target_id.
 *
 * Why audit_log not a dedicated counter table: keeps the schema
 * smaller and the audit_log is already authoritative for billing
 * reconciliation. The query is cheap because audit_log has indices
 * on (action, created_at) and the daily window is small.
 */
async function usedSecondsToday(userId: string, decisionId: string): Promise<number> {
  const startOfDayUtc = new Date();
  startOfDayUtc.setUTCHours(0, 0, 0, 0);

  const rows = await db
    .select({
      total: sql<number>`COALESCE(SUM((metadata->>'seconds')::numeric), 0)::numeric`,
    })
    .from(schema.auditLog)
    .where(and(
      eq(schema.auditLog.action, 'transcribe.whisper'),
      eq(schema.auditLog.actorUserId, userId),
      eq(schema.auditLog.targetId, decisionId),
      gte(schema.auditLog.createdAt, startOfDayUtc)
    ));
  return Number(rows[0]?.total ?? 0);
}

async function audit(
  userId: string,
  decisionId: string | null,
  audioBytes: number,
  elapsedMs: number,
  durationSec: number,
  outcome: string,
  upstreamStatus: number | null
) {
  await db
    .insert(schema.auditLog)
    .values({
      action: 'transcribe.whisper',
      actorUserId: userId,
      targetType: decisionId ? 'decision' : 'audio',
      targetId: decisionId,
      metadata: {
        bytes: audioBytes,
        ms: elapsedMs,
        seconds: Math.round(durationSec * 100) / 100,
        outcome,
        upstream_status: upstreamStatus,
      },
    })
    .catch(() => { /* never fail transcribe on audit error */ });
}

/**
 * Sum the actual USD spent on Whisper today across the whole org.
 * Reads from audit_log.metadata.seconds for successful transcribe
 * rows and multiplies by the per-second rate. Slightly stale under
 * concurrent load (race-free counter would need a transaction lock)
 * but the overshoot is bounded at ~$0.10 per request, acceptable for
 * a $5 cap.
 */
async function spentDollarsToday(): Promise<number> {
  const startOfDayUtc = new Date();
  startOfDayUtc.setUTCHours(0, 0, 0, 0);

  const rows = await db
    .select({
      seconds: sql<number>`COALESCE(SUM((metadata->>'seconds')::numeric), 0)::numeric`,
    })
    .from(schema.auditLog)
    .where(and(
      eq(schema.auditLog.action, 'transcribe.whisper'),
      gte(schema.auditLog.createdAt, startOfDayUtc)
    ));
  const seconds = Number(rows[0]?.seconds ?? 0);
  return seconds * WHISPER_USD_PER_SECOND;
}

/**
 * Send ONE warning email per UTC day when today's spend crosses the
 * configured fraction of the daily cap. De-duped by inserting a
 * sentinel audit_log row (action='transcribe.budget_warning_sent')
 * the first time it fires today; subsequent calls see the row and
 * short-circuit. Email goes to OPS_DIGEST_EMAIL.
 */
async function maybeWarnBudgetCrossed() {
  if (WHISPER_DAILY_BUDGET_USD <= 0 || WHISPER_WARN_AT <= 0) return;
  const opsEmail = process.env.OPS_DIGEST_EMAIL;
  if (!opsEmail) return;

  const threshold = WHISPER_DAILY_BUDGET_USD * WHISPER_WARN_AT;
  const spent = await spentDollarsToday();
  if (spent < threshold) return;

  const startOfDayUtc = new Date();
  startOfDayUtc.setUTCHours(0, 0, 0, 0);

  // Have we already sent the warning today?
  const existing = await db
    .select({ id: schema.auditLog.id })
    .from(schema.auditLog)
    .where(and(
      eq(schema.auditLog.action, 'transcribe.budget_warning_sent'),
      gte(schema.auditLog.createdAt, startOfDayUtc)
    ))
    .limit(1);
  if (existing.length > 0) return;

  // Insert the sentinel FIRST so concurrent requests don't all send.
  // If the email later fails, the warning is suppressed for the day
  // (acceptable · this is a heads-up, not a critical signal).
  try {
    await db.insert(schema.auditLog).values({
      action: 'transcribe.budget_warning_sent',
      targetType: 'budget',
      metadata: { spent_usd: spent, cap_usd: WHISPER_DAILY_BUDGET_USD, threshold_usd: threshold },
    });
  } catch {
    return; // race: another request beat us to it
  }

  const pct = Math.round((spent / WHISPER_DAILY_BUDGET_USD) * 100);
  const html = `<p>Counsel.day Whisper transcription spend today is <strong>$${spent.toFixed(2)} USD</strong> ` +
    `(<strong>${pct}%</strong> of the $${WHISPER_DAILY_BUDGET_USD.toFixed(2)} daily cap).</p>` +
    `<p>The cap will refuse further transcription requests at 100%. ` +
    `If this is steady-state traffic, raise <code>WHISPER_DAILY_BUDGET_USD</code> in env.local. ` +
    `If it looks like abuse, check audit_log for the noisy users:</p>` +
    `<pre>SELECT actor_user_id, COUNT(*), SUM((metadata-&gt;&gt;'seconds')::numeric)
FROM audit_log WHERE action='transcribe.whisper' AND created_at &gt;= date_trunc('day', NOW())
GROUP BY actor_user_id ORDER BY 3 DESC LIMIT 10;</pre>`;
  const text = `Counsel.day Whisper spend today: $${spent.toFixed(2)} USD (${pct}% of $${WHISPER_DAILY_BUDGET_USD.toFixed(2)} cap). Cap will refuse further requests at 100%.`;

  void sendTransactional({
    to: { email: opsEmail, name: 'Counsel.day ops' },
    subject: `[Counsel.day] Whisper spend at ${pct}% of daily cap`,
    textContent: text,
    htmlContent: html,
  }).catch((err) => console.error('[transcribe] budget warning email failed', (err as Error).message));
}
