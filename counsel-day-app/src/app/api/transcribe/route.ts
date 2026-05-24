/**
 * POST /api/transcribe   multipart/form-data: audio=<File>
 *
 * Whisper-API fallback used by the voice-input widget on
 * /vote-today.html, /compose.html, /verdict-reveal.html. Browsers
 * that support `window.SpeechRecognition` transcribe client-side at
 * zero cost; this endpoint serves the rest.
 *
 * Privacy posture (also noted in /privacy.html):
 *   · Audio is forwarded to OpenAI's Whisper API with the standard
 *     API terms · OpenAI does NOT train on data submitted through the
 *     paid API (March 2023 policy).
 *   · We do NOT persist the audio on our server. It's read into
 *     memory, sent to OpenAI, and discarded with the request.
 *   · We do NOT persist the transcript either. It's returned to the
 *     browser; whether the user keeps it (paste-into-note) is their
 *     call. The audit log captures duration + ms only, never bytes.
 *
 * Defenses:
 *   · auth required (readSession)
 *   · rate-limit 60/hr per user · 600/hr per IP
 *   · 60-second max audio length (enforced both client-side and via
 *     content-length cap of 5 MB · Opus/WebM at 32 kbps is ~240 KB
 *     per 60s)
 *   · only accepts audio/webm, audio/mp4, audio/mpeg content types
 *   · 503 when OPENAI_API_KEY is unset (graceful · widget falls back
 *     to a "voice unavailable, type instead" message)
 */

import { NextResponse } from 'next/server';
import { readSession, readSessionCookie } from '@/lib/sessions';
import { checkRateLimit, getClientIp, rateLimitResponse } from '@/lib/rate-limit';
import { db, schema } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
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

  // ---- content-length cap (cheap pre-parse bail) ----
  const contentLength = Number(req.headers.get('content-length') ?? '0');
  if (contentLength > 0 && contentLength > MAX_BYTES) {
    return NextResponse.json(
      { ok: false, message: 'Audio too large. Keep it under 60 seconds.' },
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
    return NextResponse.json(
      { ok: false, message: 'Audio too large. Keep it under 60 seconds.' },
      { status: 413 }
    );
  }
  if (audio.size === 0) {
    return NextResponse.json({ ok: false, message: 'Empty audio file.' }, { status: 400 });
  }

  // Content-type allowlist · loose match because browsers tack on codec
  // parameters (e.g. 'audio/webm;codecs=opus').
  const mime = (audio.type || '').toLowerCase().split(';')[0].trim();
  const mimeWithParams = (audio.type || '').toLowerCase();
  if (!ALLOWED_MIME.has(mime) && !ALLOWED_MIME.has(mimeWithParams)) {
    return NextResponse.json(
      { ok: false, message: `Unsupported audio format (${audio.type || 'unknown'}).` },
      { status: 415 }
    );
  }

  // ---- forward to OpenAI Whisper ----
  // Pass the file straight through without buffering twice. The
  // OpenAI endpoint expects a multipart 'file' field; we rebuild the
  // FormData rather than proxying because we want to control which
  // params reach OpenAI (no language hint, no prompt, no temperature).
  const startedAt = Date.now();
  const upstreamFd = new FormData();
  upstreamFd.append('file', audio, audio.name || 'audio.webm');
  upstreamFd.append('model', 'whisper-1');
  upstreamFd.append('response_format', 'text');

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
    await audit(session.userId, audio.size, elapsedMs, 'upstream_error', upstreamResp.status);
    return NextResponse.json(
      { ok: false, message: 'Transcription failed. Try again or type the note.' },
      { status: 502 }
    );
  }

  const transcript = (await upstreamResp.text()).trim();
  await audit(session.userId, audio.size, elapsedMs, 'ok', null);

  return NextResponse.json({ ok: true, transcript }, { status: 200 });
}

/**
 * Audit log entry · captures METADATA only, never bytes or transcript.
 * Used to spot abuse patterns and reconcile OpenAI billing.
 */
async function audit(
  userId: string,
  audioBytes: number,
  elapsedMs: number,
  outcome: string,
  upstreamStatus: number | null
) {
  await db
    .insert(schema.auditLog)
    .values({
      action: 'transcribe.whisper',
      actorUserId: userId,
      targetType: 'audio',
      metadata: {
        bytes: audioBytes,
        ms: elapsedMs,
        outcome,
        upstream_status: upstreamStatus,
      },
    })
    .catch(() => { /* never fail transcribe on audit error */ });
}
