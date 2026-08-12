/**
 * POST /api/feedback   (JSON)
 *   context   (required)  · short slug for WHERE the feedback was given
 *   rating    (optional)  · 1 (not useful) .. 5 (very useful)
 *   comment   (optional)  · free-text note, <= 1000 chars
 *   page      (optional)  · the path the widget was on
 *
 * Open endpoint (logged-out visitors can leave feedback). If a session cookie
 * is present we attach the user id; otherwise it is null. Rate-limited by IP.
 * Never stores decision / vote / note content · only what the user typed.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@/lib/db';
import { readSession, readSessionCookie } from '@/lib/sessions';
import { checkRateLimit, getClientIp, rateLimitResponse } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const feedbackSchema = z
  .object({
    context: z.string().trim().min(1).max(40),
    rating: z.number().int().min(1).max(5).optional(),
    comment: z.string().trim().max(1000).optional(),
    page: z.string().trim().max(200).optional(),
  })
  .refine((d) => d.rating !== undefined || (d.comment && d.comment.length > 0), {
    message: 'Provide a rating or a comment.',
  });

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const rl = await checkRateLimit(`feedback-ip:${ip}`, 20, 3600);
  if (!rl.allowed) {
    return rateLimitResponse(rl, 'Thanks · that is enough feedback for now. Please try again later.');
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: 'Could not read request body.' }, { status: 400 });
  }

  const parsed = feedbackSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: 'Invalid feedback.' }, { status: 422 });
  }

  const session = await readSession(readSessionCookie(req.headers));

  await db
    .insert(schema.feedback)
    .values({
      userId: session?.userId ?? null,
      context: parsed.data.context,
      rating: parsed.data.rating ?? null,
      comment: parsed.data.comment ?? null,
      page: parsed.data.page ?? null,
    })
    .catch(() => {
      /* feedback is best-effort · never surface a DB hiccup to the user */
    });

  return NextResponse.json({ ok: true }, { status: 200, headers: { 'cache-control': 'no-store' } });
}
