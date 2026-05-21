/**
 * GET /api/me/decision-insights
 *
 * Multi-decision dashboard feed · /decisions-insights.html renders
 * progressive unlocks from this endpoint. Returns:
 *   · Every paid decision the signed-in user has unsealed
 *   · Per-decision summary: question, partner names, verdict prose
 *     first 200 chars, dominant themes, sentiment summary
 *   · Cross-decision patterns when there are 2+ unsealed decisions:
 *     - recurring themes (word appears in >= 2 decisions' analysis)
 *     - vocabulary fingerprint (top tokens by frequency across all
 *       this user's notes · gives the "your decision vocabulary"
 *       insight on the dashboard)
 *
 * Auth: signed-in user only. Returns 200 with empty arrays for users
 * with no unsealed paid decisions so the frontend can render the
 * "complete a decision to unlock" empty state.
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { readSession, readSessionCookie } from '@/lib/sessions';
import { sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type AnalysisJson = {
  themes?: Array<{ name?: string; mentions?: number; attributed_to?: string[] }>;
  trajectory?: Array<{ vote_date?: string; net_direction?: number }>;
  sentiment?: { per_participant?: Record<string, { compound?: number; label?: string }> };
  word_cloud?: Array<{ word?: string; weight?: number }>;
  asymmetries?: Array<{ type?: string; description?: string }>;
};

export async function GET(req: Request) {
  const session = await readSession(readSessionCookie(req.headers));
  if (!session) {
    return NextResponse.json({ ok: false, message: 'You must be signed in.' }, { status: 401 });
  }

  // Every decision the user participates in that is unsealed and on a
  // paid tier. Join through participants since a user can be a partner
  // on someone else's decision too · the dashboard shows ALL their
  // sealed records, not just ones they created.
  type DecisionRow = {
    id: string;
    question: string;
    tier: string;
    duration_days: number;
    unseals_at: string;
    synthesis_text: string | null;
    analysis_json: AnalysisJson | null;
    partner_names: string[];
  };
  const rows = await db.execute<DecisionRow>(sql`
    SELECT
      d.id,
      d.question,
      d.tier,
      d.duration_days,
      d.unseals_at::text,
      v.synthesis_text,
      v.analysis_json,
      COALESCE(array_agg(DISTINCT p2.display_name) FILTER (WHERE p2.user_id != ${session.userId}), '{}') AS partner_names
    FROM decisions d
    JOIN participants p ON p.decision_id = d.id AND p.user_id = ${session.userId}
    LEFT JOIN verdicts v ON v.decision_id = d.id
    LEFT JOIN participants p2 ON p2.decision_id = d.id
    WHERE d.tier IN ('solo_paid', 'couple', 'family')
      AND d.unseals_at <= NOW()
    GROUP BY d.id, v.synthesis_text, v.analysis_json
    ORDER BY d.unseals_at DESC
  `);

  const decisions = (Array.from(rows) as DecisionRow[]).map((d) => {
    const synth = (d.synthesis_text ?? '').slice(0, 240).replace(/\s+\S*$/, '').trim();
    const analysis = d.analysis_json ?? null;
    const topThemes = (analysis?.themes ?? [])
      .slice()
      .sort((a, b) => (Number(b.mentions ?? 0) - Number(a.mentions ?? 0)))
      .slice(0, 3)
      .map((t) => ({ name: t.name ?? '', mentions: Number(t.mentions ?? 0) }))
      .filter((t) => t.name);
    return {
      id: d.id,
      question: d.question,
      tier: d.tier,
      duration_days: d.duration_days,
      unseals_at: d.unseals_at,
      synthesis_preview: synth ? synth + (synth.length < (d.synthesis_text ?? '').length ? '…' : '') : null,
      partner_names: d.partner_names ?? [],
      top_themes: topThemes,
      has_analysis: analysis !== null,
    };
  });

  // ---- Cross-decision patterns ----
  // Only run when the user has 2+ unsealed decisions · otherwise the
  // dashboard shows the "complete more decisions" progressive unlock.
  let recurringThemes: Array<{ name: string; decision_count: number; total_mentions: number }> = [];
  let vocabularyFingerprint: Array<{ word: string; weight: number }> = [];

  if (decisions.length >= 2) {
    const themeCounter = new Map<string, { count: number; mentions: number }>();
    const wordCounter = new Map<string, number>();
    for (const row of Array.from(rows) as DecisionRow[]) {
      const a = row.analysis_json;
      if (!a) continue;
      for (const t of a.themes ?? []) {
        const name = (t.name ?? '').toLowerCase().trim();
        if (!name) continue;
        const entry = themeCounter.get(name) ?? { count: 0, mentions: 0 };
        entry.count += 1;
        entry.mentions += Number(t.mentions ?? 1);
        themeCounter.set(name, entry);
      }
      for (const w of a.word_cloud ?? []) {
        const word = (w.word ?? '').toLowerCase().trim();
        if (!word) continue;
        wordCounter.set(word, (wordCounter.get(word) ?? 0) + Number(w.weight ?? 1));
      }
    }
    recurringThemes = Array.from(themeCounter.entries())
      .filter(([, v]) => v.count >= 2)
      .map(([name, v]) => ({ name, decision_count: v.count, total_mentions: v.mentions }))
      .sort((a, b) => b.decision_count - a.decision_count || b.total_mentions - a.total_mentions)
      .slice(0, 8);
    vocabularyFingerprint = Array.from(wordCounter.entries())
      .map(([word, weight]) => ({ word, weight }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 30);
  }

  return NextResponse.json(
    {
      ok: true,
      decisions,
      recurring_themes: recurringThemes,
      vocabulary_fingerprint: vocabularyFingerprint,
      // Progressive-unlock hints for the dashboard frontend so it can
      // render the right empty / locked states without re-counting.
      unlock_state: {
        has_any: decisions.length > 0,
        has_cross_decision: decisions.length >= 2,
        next_unlock_at: decisions.length < 2 ? 2 - decisions.length : null,
      },
    },
    { status: 200, headers: { 'cache-control': 'private, no-store' } }
  );
}
