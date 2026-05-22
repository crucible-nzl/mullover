/**
 * GET /api/verdict-share/[token]
 *
 * PUBLIC endpoint · no auth required. Returns the verdict prose +
 * question + verdict-day date for whoever has the token. Optionally
 * returns partner names (if allow_partner_names) and the lightweight
 * analysis themes (if allow_analysis).
 *
 * NEVER returns: vote notes, conviction sliders, vote directions,
 * owner email, participant emails, vocabulary overlap, sentiment
 * scores, asymmetries, key quotes (those contain verbatim notes),
 * or the decision id. The decision id stays private so a leaked
 * share URL can't be brute-forced into the authed API surface.
 *
 * On valid token: increments view_count + sets last_viewed_at so
 * the owner can see how often the link has been opened.
 *
 * Returns:
 *   200 + verdict payload
 *   404 + "Not found." for any failure mode (revoked, expired,
 *         unknown token, or sealed/not-yet-generated) · no
 *         information disclosure
 */

import { NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, and, isNull, sql, gt } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!token || token.length < 16 || token.length > 200) {
    return NextResponse.json({ ok: false, message: 'Not found.' }, { status: 404 });
  }

  const shareRows = await db
    .select({
      id: schema.verdictShares.id,
      decisionId: schema.verdictShares.decisionId,
      allowPartnerNames: schema.verdictShares.allowPartnerNames,
      allowAnalysis: schema.verdictShares.allowAnalysis,
      expiresAt: schema.verdictShares.expiresAt,
    })
    .from(schema.verdictShares)
    .where(and(
      eq(schema.verdictShares.token, token),
      isNull(schema.verdictShares.revokedAt),
    ))
    .limit(1);
  if (shareRows.length === 0) {
    return NextResponse.json({ ok: false, message: 'Not found.' }, { status: 404 });
  }
  const share = shareRows[0];

  // Expiry check · expires_at is nullable; null means never.
  if (share.expiresAt && share.expiresAt.getTime() < Date.now()) {
    return NextResponse.json({ ok: false, message: 'Not found.' }, { status: 404 });
  }

  // Verdict must exist · sealed decisions can't be shared anyway
  // (the gate in POST /share blocks this) but defensive check.
  const verdictRows = await db
    .select({
      generatedAt: schema.verdicts.generatedAt,
      synthesisText: schema.verdicts.synthesisText,
      themes: schema.verdicts.themes,
      nextConversationPrompt: schema.verdicts.nextConversationPrompt,
    })
    .from(schema.verdicts)
    .where(eq(schema.verdicts.decisionId, share.decisionId))
    .limit(1);
  if (verdictRows.length === 0) {
    return NextResponse.json({ ok: false, message: 'Not found.' }, { status: 404 });
  }
  const v = verdictRows[0];

  const decisionRows = await db
    .select({
      question: schema.decisions.question,
      unsealsAt: schema.decisions.unsealsAt,
      durationDays: schema.decisions.durationDays,
    })
    .from(schema.decisions)
    .where(eq(schema.decisions.id, share.decisionId))
    .limit(1);
  if (decisionRows.length === 0) {
    return NextResponse.json({ ok: false, message: 'Not found.' }, { status: 404 });
  }
  const d = decisionRows[0];

  // Partner names · returned only when the owner allowed it. We use
  // display_name (already-blurred or chosen-by-user) · never email.
  let partnerNames: string[] = [];
  if (share.allowPartnerNames) {
    const partRows = await db
      .select({ displayName: schema.participants.displayName })
      .from(schema.participants)
      .where(eq(schema.participants.decisionId, share.decisionId));
    partnerNames = partRows.map((p) => p.displayName).filter(Boolean);
  }

  // Analysis themes · only the names + mention counts, never quotes.
  // Quotes can leak verbatim user notes which the recipient is not
  // entitled to even when the owner ticks Allow.
  let safeThemes: Array<{ name: string; mentions: number }> = [];
  if (share.allowAnalysis && Array.isArray(v.themes)) {
    safeThemes = (v.themes as Array<{ name?: string; mentions?: number }>)
      .map((t) => ({ name: String(t.name ?? '').slice(0, 60), mentions: Number(t.mentions ?? 0) || 0 }))
      .filter((t) => t.name)
      .slice(0, 12);
  }

  // Bump view counter · fire-and-forget. A failure here must not
  // block the response · we'd rather under-count than 500 the share.
  void db.execute(sql`
    UPDATE verdict_shares
    SET view_count = view_count + 1, last_viewed_at = NOW()
    WHERE id = ${share.id}
  `).catch(() => {});

  return NextResponse.json(
    {
      ok: true,
      question: d.question,
      duration_days: d.durationDays,
      unsealed_on: d.unsealsAt,
      generated_at: v.generatedAt,
      synthesis_text: v.synthesisText ?? '',
      next_conversation_prompt: v.nextConversationPrompt ?? '',
      partner_names: partnerNames,
      themes: safeThemes,
    },
    { status: 200, headers: { 'cache-control': 'public, max-age=60' } }
  );
}
