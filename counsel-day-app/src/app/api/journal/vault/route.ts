/**
 * GET /api/journal/vault
 *
 * Returns the signed-in user's journal entries · the data source for
 * the Vault page (counsel-day-complete/vault.html). Free-tier users
 * get the last 90 days; Journal Pro gets the full history.
 *
 * The actual audio playback URL is NOT included in the list response
 * (signed URLs are short-lived and per-row generation would be
 * wasteful here). The client fetches the signed URL on-demand from
 * /api/journal/vault/[id]/playback when the user expands a row.
 */

import { NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { readSession, readSessionCookie } from '@/lib/sessions';
import { and, eq, isNull, desc, gte, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const FREE_TIER_DAYS = 90;

export async function GET(req: Request) {
  const session = await readSession(readSessionCookie(req.headers));
  if (!session) {
    return NextResponse.json({ ok: false, message: 'You must be signed in.' }, { status: 401 });
  }

  // Determine the user's tier so we can clamp the result set for free
  // users. The actual audio file lives in R2; the DB row tells us if
  // an audio_url was ever recorded for this entry.
  const dailyProRows = await db
    .select({ status: schema.dailySubscriptions.status, periodEnd: schema.dailySubscriptions.currentPeriodEnd })
    .from(schema.dailySubscriptions)
    .where(eq(schema.dailySubscriptions.userId, session.userId))
    .limit(1);
  const isPro = dailyProRows.length > 0 && dailyProRows[0].status === 'active' && (dailyProRows[0].periodEnd ?? new Date(0)) > new Date();

  const conditions = [
    eq(schema.journalEntries.userId, session.userId),
    isNull(schema.journalEntries.deletedAt),
  ];
  if (!isPro) {
    const cutoff = new Date(Date.now() - FREE_TIER_DAYS * 24 * 60 * 60 * 1000);
    conditions.push(gte(schema.journalEntries.entryDate, cutoff.toISOString().slice(0, 10)));
  }

  const rows = await db
    .select({
      id: schema.journalEntries.id,
      entryDate: schema.journalEntries.entryDate,
      textContent: schema.journalEntries.textContent,
      transcript: schema.journalEntries.transcript,
      audioUrl: schema.journalEntries.audioUrl,
      durationSeconds: schema.journalEntries.durationSeconds,
      wordCount: schema.journalEntries.wordCount,
      language: schema.journalEntries.language,
      sealedAt: schema.journalEntries.sealedAt,
      unsealsAt: schema.journalEntries.unsealsAt,
    })
    .from(schema.journalEntries)
    .where(and(...conditions))
    .orderBy(desc(schema.journalEntries.entryDate));

  // TASK 4 · The vault now lists ALL entries, including sealed ones.
  // For sealed entries we send back only the metadata (date, seal
  // timestamps, duration, word count, is_sealed:true) and DROP the
  // text_content, transcript, and audio flag. The user can see the
  // entry exists ("yes my recording is safe") without breaking the
  // seal contract. The /playback endpoint also rejects unsealed
  // entries server-side so a hand-crafted request cannot pull the
  // sealed audio.
  const now = new Date();
  const entries = rows.map((r) => {
    const sealed = (r.unsealsAt ?? new Date(0)) > now;
    if (sealed) {
      return {
        id: r.id,
        entry_date: r.entryDate,
        is_sealed: true,
        text_content: null,
        transcript: null,
        audio_url: r.audioUrl ? true : null,  // present-but-locked flag for the UI
        duration_seconds: r.durationSeconds != null ? Number(r.durationSeconds) : null,
        word_count: r.wordCount,
        language: r.language,
        sealed_at: r.sealedAt,
        unseals_at: r.unsealsAt,
      };
    }
    return {
      id: r.id,
      entry_date: r.entryDate,
      is_sealed: false,
      text_content: r.textContent,
      transcript: r.transcript,
      audio_url: r.audioUrl ? true : null,
      duration_seconds: r.durationSeconds != null ? Number(r.durationSeconds) : null,
      word_count: r.wordCount,
      language: r.language,
      sealed_at: r.sealedAt,
      unseals_at: r.unsealsAt,
    };
  });

  return NextResponse.json({
    ok: true,
    is_pro: isPro,
    retention_days: isPro ? null : FREE_TIER_DAYS,
    entries,
    total: entries.length,
  });
}
