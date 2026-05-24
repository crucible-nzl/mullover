/**
 * Counsel.day · OpenAI TTS narration of the verdict synthesis.
 *
 * One public function: narrateVerdict(text, verdictId). Calls OpenAI's
 * TTS endpoint with the brand-fit voice, streams the MP3 response, and
 * writes it to /var/www/counsel.day/verdicts/<verdict_id>.mp3 (which
 * Caddy already serves at https://counsel.day/verdicts/<id>.mp3).
 *
 * The function returns:
 *   { ok: true, publicUrl, costCents }
 * or
 *   { ok: false, reason }
 *
 * Budget cap (WHISPER-style, separate spend ledger):
 *   · TTS_DAILY_BUDGET_USD (env, default $5/day)
 *   · spent today is summed from audit_log rows action='tts.openai'
 *
 * Privacy: synthesis text is sent to OpenAI; per OpenAI's published
 * API policy, paid-API submissions are not used for model training.
 * The MP3 we receive back is stored on our own disk. Both the text
 * being sent and the audio coming back are logged metadata-only (no
 * content captured in audit_log).
 */

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { db, schema } from '@/lib/db';
import { eq, and, gte, sql } from 'drizzle-orm';

const TTS_MODEL = process.env.OPENAI_TTS_MODEL ?? 'gpt-4o-mini-tts';
const TTS_VOICE = process.env.OPENAI_TTS_VOICE ?? 'onyx';
const TTS_FORMAT = 'mp3' as const;
const TTS_AUDIO_DIR = process.env.VERDICTS_AUDIO_DIR ?? '/var/www/counsel.day/verdicts';
const TTS_PUBLIC_BASE = process.env.VERDICTS_AUDIO_PUBLIC_BASE ?? 'https://counsel.day/verdicts';

/** Approximate $0.015 / 1000 characters for gpt-4o-mini-tts. */
const TTS_USD_PER_CHAR = 0.015 / 1000;

/** Daily budget cap on org-wide TTS spend. Override via env. */
const TTS_DAILY_BUDGET_USD = Number(process.env.TTS_DAILY_BUDGET_USD ?? '5');

export interface TtsResult {
  ok: true;
  publicUrl: string;
  costCents: number;
  characters: number;
  bytes: number;
  durationMs: number;
}
export interface TtsError {
  ok: false;
  reason: string;
}

export async function narrateVerdict(
  text: string,
  verdictId: string
): Promise<TtsResult | TtsError> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { ok: false, reason: 'OPENAI_API_KEY not set' };
  if (!text || text.trim().length < 20) return { ok: false, reason: 'synthesis text too short to narrate' };
  if (!/^[0-9a-f-]{36}$/.test(verdictId)) return { ok: false, reason: 'invalid verdict id' };

  // Budget gate
  if (TTS_DAILY_BUDGET_USD > 0) {
    const spent = await spentDollarsToday();
    if (spent >= TTS_DAILY_BUDGET_USD) {
      return { ok: false, reason: `daily TTS budget reached ($${spent.toFixed(2)}/$${TTS_DAILY_BUDGET_USD})` };
    }
  }

  const trimmed = text.trim().slice(0, 16000); // OpenAI hard cap ~4096 tokens
  const characters = trimmed.length;
  const startedAt = Date.now();

  let resp: Response;
  try {
    resp = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: TTS_MODEL,
        voice: TTS_VOICE,
        input: trimmed,
        response_format: TTS_FORMAT,
      }),
    });
  } catch (err) {
    return { ok: false, reason: `fetch failed: ${(err as Error).message}` };
  }
  const durationMs = Date.now() - startedAt;

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    await auditTts(verdictId, characters, 0, 0, durationMs, 'upstream_error', resp.status);
    return { ok: false, reason: `OpenAI ${resp.status}: ${body.slice(0, 200)}` };
  }

  const buf = Buffer.from(await resp.arrayBuffer());
  if (buf.length === 0) {
    await auditTts(verdictId, characters, 0, 0, durationMs, 'empty_audio', null);
    return { ok: false, reason: 'empty audio response' };
  }

  // Write to disk. Caddy serves the directory; no app round-trip on playback.
  try {
    await fs.mkdir(TTS_AUDIO_DIR, { recursive: true });
  } catch {
    /* mkdir is best-effort · if it fails the write below surfaces it */
  }
  const filename = `${verdictId}.mp3`;
  const fullPath = join(TTS_AUDIO_DIR, filename);
  try {
    await fs.writeFile(fullPath, buf, { mode: 0o644 });
  } catch (err) {
    await auditTts(verdictId, characters, buf.length, 0, durationMs, 'disk_write_failed', null);
    return { ok: false, reason: `disk write failed: ${(err as Error).message}` };
  }

  const costCents = Math.round(characters * TTS_USD_PER_CHAR * 100);
  await auditTts(verdictId, characters, buf.length, costCents, durationMs, 'ok', null);

  return {
    ok: true,
    publicUrl: `${TTS_PUBLIC_BASE}/${filename}`,
    costCents,
    characters,
    bytes: buf.length,
    durationMs,
  };
}

async function spentDollarsToday(): Promise<number> {
  const startOfDayUtc = new Date();
  startOfDayUtc.setUTCHours(0, 0, 0, 0);

  const rows = await db
    .select({
      cents: sql<number>`COALESCE(SUM((metadata->>'cost_cents')::numeric), 0)::numeric`,
    })
    .from(schema.auditLog)
    .where(and(
      eq(schema.auditLog.action, 'tts.openai'),
      gte(schema.auditLog.createdAt, startOfDayUtc)
    ));
  return Number(rows[0]?.cents ?? 0) / 100;
}

async function auditTts(
  verdictId: string,
  characters: number,
  bytes: number,
  costCents: number,
  durationMs: number,
  outcome: string,
  upstreamStatus: number | null
) {
  await db
    .insert(schema.auditLog)
    .values({
      action: 'tts.openai',
      targetType: 'verdict',
      targetId: verdictId,
      metadata: {
        characters,
        bytes,
        cost_cents: costCents,
        ms: durationMs,
        outcome,
        model: TTS_MODEL,
        voice: TTS_VOICE,
        upstream_status: upstreamStatus,
      },
    })
    .catch(() => { /* never fail TTS on audit error */ });
}
