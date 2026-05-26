/**
 * POST /api/daily       create or replace today's journal entry
 * GET  /api/daily       list the caller's entries that have already unsealed
 * GET  /api/daily?week=YYYY-MM-DD   list the entries inside that ISO week
 *
 * The Daily Counsel is Counsel.day's evening-journal companion to the
 * flagship sealed-decision product. Every evening the user submits a
 * short text reflection (Pro tier also gets voice via Whisper). The
 * entry is sealed for seven days: the user cannot re-read it until
 * the seal lifts. After the seal lifts, the Sunday-evening cron pulls
 * the past 7 days of UNSEALED entries and ships a Monday-morning
 * verdict in the editorial voice.
 *
 * Tier rules:
 *   · FREE   text only, weekly verdict, 7-day seal
 *   · PRO    text + voice (Whisper) + attach-to-decision + monthly deep-dive
 *
 * Validation:
 *   · entry_date defaults to user's local "today" (client supplies ISO
 *     date in their TZ); server rejects entries more than 1 day in the
 *     past or any in the future (cheats the seal).
 *   · text_content min 1 char, max 4000 (audio handled separately by
 *     /api/daily/voice which writes audio_url/transcript on this row).
 *   · Re-submitting same (user, entry_date) REPLACES the prior row's
 *     text content but keeps the original sealed_at/unseals_at · the
 *     seal clock cannot be reset by editing.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@/lib/db';
import { readSession, readSessionCookie } from '@/lib/sessions';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { and, eq, gt, lte, isNull, desc, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SEAL_DAYS = 7;
const MAX_TEXT_LEN = 4000;
const MIN_TEXT_LEN = 1;

// ---------------------------------------------------------------------------
// POST · create / replace today's entry
// ---------------------------------------------------------------------------

const postSchema = z.object({
  text_content: z.string().trim().min(MIN_TEXT_LEN).max(MAX_TEXT_LEN),
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  attached_decision_id: z.string().uuid().nullable().optional(),
});

export async function POST(req: Request) {
  const session = await readSession(readSessionCookie(req.headers));
  if (!session) {
    return NextResponse.json({ ok: false, message: 'You must be signed in.' }, { status: 401 });
  }

  // Per-user rate limit · a person posting more than 30 entries per
  // hour is a runaway client, not a journaler.
  const rl = await checkRateLimit(`daily-post:${session.userId}`, 30, 3600);
  if (!rl.allowed) return rateLimitResponse(rl, 'Too many entries submitted recently.');

  let raw: unknown;
  try { raw = await req.json(); } catch {
    return NextResponse.json({ ok: false, message: 'Body must be JSON.' }, { status: 400 });
  }
  const parsed = postSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: 'text_content is required (1-4000 chars).' }, { status: 422 });
  }
  const { text_content } = parsed.data;
  const entryDate = parsed.data.entry_date ?? todayUtcDate();
  const attachedDecisionId = parsed.data.attached_decision_id ?? null;

  // Reject entries dated more than 1 day in the past (back-dating
  // breaks the seal-clock contract) or any future date.
  const today = todayUtcDate();
  if (entryDate > today) {
    return NextResponse.json({ ok: false, message: 'Cannot post an entry for a future date.' }, { status: 422 });
  }
  const oneDayBack = isoDateDaysAgo(1);
  if (entryDate < oneDayBack) {
    return NextResponse.json({ ok: false, message: "You can only post tonight's entry, or yesterday's if you missed it." }, { status: 422 });
  }

  // Pro-tier required for attach-to-decision
  if (attachedDecisionId) {
    const sub = await db
      .select({ status: schema.dailySubscriptions.status, periodEnd: schema.dailySubscriptions.currentPeriodEnd })
      .from(schema.dailySubscriptions)
      .where(eq(schema.dailySubscriptions.userId, session.userId))
      .limit(1);
    const active = sub.length > 0 && sub[0].status === 'active' && sub[0].periodEnd && sub[0].periodEnd > new Date();
    if (!active) {
      return NextResponse.json({ ok: false, message: 'Attach-to-decision is a Pro tier feature. Upgrade at /daily/pricing.' }, { status: 402 });
    }
    // Verify the decision is owned by the user (don't let users attach
    // an entry to someone else's decision).
    const d = await db
      .select({ id: schema.decisions.id })
      .from(schema.decisions)
      .where(and(eq(schema.decisions.id, attachedDecisionId), eq(schema.decisions.ownerUserId, session.userId)))
      .limit(1);
    if (d.length === 0) {
      return NextResponse.json({ ok: false, message: 'That decision is not on your account.' }, { status: 404 });
    }
  }

  // Has this user already filed for this date? If yes, UPDATE the text
  // but PRESERVE sealed_at/unseals_at (editing doesn't restart the seal).
  const existing = await db
    .select({ id: schema.journalEntries.id, unsealsAt: schema.journalEntries.unsealsAt })
    .from(schema.journalEntries)
    .where(and(
      eq(schema.journalEntries.userId, session.userId),
      eq(schema.journalEntries.entryDate, entryDate),
      isNull(schema.journalEntries.deletedAt),
    ))
    .limit(1);

  const wordCount = text_content.trim().split(/\s+/).filter(Boolean).length;

  if (existing.length > 0) {
    await db.update(schema.journalEntries)
      .set({
        textContent: text_content,
        wordCount,
        attachedDecisionId,
      })
      .where(eq(schema.journalEntries.id, existing[0].id));
    return NextResponse.json({
      ok: true,
      action: 'replaced',
      unseals_at: existing[0].unsealsAt,
      message: `Updated tonight's entry. Still sealed until ${existing[0].unsealsAt?.toISOString().slice(0, 10) ?? ''}.`,
    });
  }

  const sealedAt = new Date();
  const unsealsAt = new Date(sealedAt.getTime() + SEAL_DAYS * 24 * 60 * 60 * 1000);

  const inserted = await db.insert(schema.journalEntries).values({
    userId: session.userId,
    entryDate,
    textContent: text_content,
    wordCount,
    attachedDecisionId,
    sealedAt,
    unsealsAt,
  }).returning({ id: schema.journalEntries.id });

  return NextResponse.json({
    ok: true,
    action: 'created',
    id: inserted[0].id,
    sealed_at: sealedAt.toISOString(),
    unseals_at: unsealsAt.toISOString(),
    message: `Sealed for 7 days. Opens ${unsealsAt.toISOString().slice(0, 10)}.`,
  }, { status: 201 });
}

// ---------------------------------------------------------------------------
// GET · list entries that have already unsealed (the seal contract:
//        an entry is invisible to the user until unseals_at <= NOW())
// ---------------------------------------------------------------------------

export async function GET(req: Request) {
  const session = await readSession(readSessionCookie(req.headers));
  if (!session) {
    return NextResponse.json({ ok: false, message: 'You must be signed in.' }, { status: 401 });
  }

  const url = new URL(req.url);
  const weekParam = url.searchParams.get('week');
  const limitParam = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '30'), 1), 200);

  const now = new Date();

  // Always enforce the seal: deleted_at is null AND unseals_at <= now.
  // The user's own entries are still invisible until the seal lifts.
  const baseConditions = [
    eq(schema.journalEntries.userId, session.userId),
    isNull(schema.journalEntries.deletedAt),
    lte(schema.journalEntries.unsealsAt, now),
  ];

  // ?week=YYYY-MM-DD scopes to the Mon-Sun ISO week containing that
  // date (used by the /daily archive view to navigate week by week).
  let entries;
  if (weekParam && /^\d{4}-\d{2}-\d{2}$/.test(weekParam)) {
    const monday = isoWeekMonday(weekParam);
    const sunday = isoDateAddDays(monday, 6);
    entries = await db
      .select()
      .from(schema.journalEntries)
      .where(and(
        ...baseConditions,
        sql`${schema.journalEntries.entryDate} >= ${monday}::date`,
        sql`${schema.journalEntries.entryDate} <= ${sunday}::date`,
      ))
      .orderBy(desc(schema.journalEntries.entryDate))
      .limit(limitParam);
  } else {
    entries = await db
      .select()
      .from(schema.journalEntries)
      .where(and(...baseConditions))
      .orderBy(desc(schema.journalEntries.entryDate))
      .limit(limitParam);
  }

  // Surface today's still-sealed entry separately so the UI can say
  // "you already filed tonight; opens DATE" instead of showing nothing.
  const todayIso = todayUtcDate();
  const sealedToday = await db
    .select({
      id: schema.journalEntries.id,
      entryDate: schema.journalEntries.entryDate,
      sealedAt: schema.journalEntries.sealedAt,
      unsealsAt: schema.journalEntries.unsealsAt,
      wordCount: schema.journalEntries.wordCount,
    })
    .from(schema.journalEntries)
    .where(and(
      eq(schema.journalEntries.userId, session.userId),
      eq(schema.journalEntries.entryDate, todayIso),
      gt(schema.journalEntries.unsealsAt, now),
      isNull(schema.journalEntries.deletedAt),
    ))
    .limit(1);

  return NextResponse.json({
    ok: true,
    entries: entries.map((e) => ({
      id: e.id,
      entry_date: e.entryDate,
      text_content: e.textContent,
      transcript: e.transcript,
      audio_url: e.audioUrl,
      duration_seconds: e.durationSeconds,
      word_count: e.wordCount,
      attached_decision_id: e.attachedDecisionId,
      sealed_at: e.sealedAt,
      unsealed_at: e.unsealsAt, // already past, hence visible
    })),
    sealed_today: sealedToday[0]
      ? {
          id: sealedToday[0].id,
          entry_date: sealedToday[0].entryDate,
          sealed_at: sealedToday[0].sealedAt,
          unseals_at: sealedToday[0].unsealsAt,
          word_count: sealedToday[0].wordCount,
        }
      : null,
  }, { status: 200, headers: { 'cache-control': 'private, no-store' } });
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoDateDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function isoDateAddDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function isoWeekMonday(iso: string): string {
  // Return the ISO-Monday of the week containing the given date.
  const d = new Date(iso + 'T00:00:00Z');
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day; // shift to Monday
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}
