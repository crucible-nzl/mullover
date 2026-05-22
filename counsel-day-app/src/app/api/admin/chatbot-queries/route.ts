/**
 * GET /api/admin/chatbot-queries
 *
 * Paginated read of the chatbot_queries table for the admin chatbot
 * dashboard. Filterable by:
 *   · escalated=true/false  · only show turns where the bot escalated
 *                             (signals a KB gap)
 *   · user_id=<uuid>        · all turns by one user
 *   · since=<ISO-date>      · only turns asked after a date
 *   · q=<text>              · ILIKE on the question text
 *
 * Returns the question/reply text + token counts + duration + escalation
 * flag. The reply text is the bot's raw output; operator reads it to
 * find places the bot said something suboptimal and tune the KB.
 *
 * Cursor pagination via id DESC · page_size capped at 200.
 */

import { NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { requireAdmin } from '@/lib/admin-auth';
import { sql, and, eq, lt, gt, ilike, isNotNull } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const url = new URL(req.url);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));
  const before = url.searchParams.get('before'); // cursor: load rows with id < before
  const escalated = url.searchParams.get('escalated');
  const userId = url.searchParams.get('user_id');
  const since = url.searchParams.get('since');
  const q = url.searchParams.get('q');

  const conditions = [] as Array<ReturnType<typeof eq>>;
  if (before) {
    const n = Number(before);
    if (Number.isFinite(n)) conditions.push(lt(schema.chatbotQueries.id, n));
  }
  if (escalated === 'true') conditions.push(eq(schema.chatbotQueries.escalated, true));
  if (escalated === 'false') conditions.push(eq(schema.chatbotQueries.escalated, false));
  if (userId && /^[0-9a-f-]{36}$/i.test(userId)) {
    conditions.push(eq(schema.chatbotQueries.userId, userId));
  }
  if (since) {
    const sinceDate = new Date(since);
    if (!Number.isNaN(sinceDate.getTime())) {
      conditions.push(gt(schema.chatbotQueries.askedAt, sinceDate));
    }
  }
  if (q && q.trim().length > 0) {
    conditions.push(ilike(schema.chatbotQueries.question, '%' + q.trim() + '%'));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      id: schema.chatbotQueries.id,
      askedAt: schema.chatbotQueries.askedAt,
      userId: schema.chatbotQueries.userId,
      question: schema.chatbotQueries.question,
      reply: schema.chatbotQueries.reply,
      escalated: schema.chatbotQueries.escalated,
      tokensInput: schema.chatbotQueries.tokensInput,
      tokensOutput: schema.chatbotQueries.tokensOutput,
      durationMs: schema.chatbotQueries.durationMs,
    })
    .from(schema.chatbotQueries)
    .where(where)
    .orderBy(sql`${schema.chatbotQueries.id} DESC`)
    .limit(limit);

  // Summary aggregates for the dashboard header card · total / 7d /
  // escalated rate. Cheap with the indexes 0014 added.
  const summary = await db.execute<{
    total: string;
    last_7d: string;
    escalated_total: string;
    escalated_7d: string;
    avg_tokens: string;
  }>(sql`
    SELECT
      count(*)::text AS total,
      count(*) FILTER (WHERE asked_at > NOW() - INTERVAL '7 days')::text AS last_7d,
      count(*) FILTER (WHERE escalated = true)::text AS escalated_total,
      count(*) FILTER (WHERE escalated = true AND asked_at > NOW() - INTERVAL '7 days')::text AS escalated_7d,
      COALESCE(AVG(tokens_input + tokens_output), 0)::text AS avg_tokens
    FROM chatbot_queries
  `);

  const s = summary[0] as Record<string, string>;

  return NextResponse.json(
    {
      ok: true,
      rows,
      next_cursor: rows.length === limit ? rows[rows.length - 1].id : null,
      summary: {
        total: Number(s.total),
        last_7d: Number(s.last_7d),
        escalated_total: Number(s.escalated_total),
        escalated_7d: Number(s.escalated_7d),
        escalation_rate: Number(s.total) > 0 ? Number(s.escalated_total) / Number(s.total) : 0,
        avg_tokens_per_turn: Math.round(Number(s.avg_tokens)),
      },
    },
    { status: 200, headers: { 'cache-control': 'private, no-store' } }
  );
}
