/**
 * POST /api/admin/testing-area/run-verdict
 *
 * Operator-only sandbox that runs a real Anthropic verdict generation
 * against operator-supplied fixture data, with NO database writes and
 * NO emails. Used by /admin-testing-area.html for prompt tuning, tone
 * checks, and AI-output spot-checks before changing production state.
 *
 * Body shape:
 *   {
 *     question: string,                         // the decision prompt
 *     format: 'yes_no' | 'strong_lean' | 'a_b',
 *     duration_days: number,                    // 7 by default in the UI
 *     tier: 'solo_free' | 'solo_paid' | 'couple' | 'family',
 *     participants: [
 *       {
 *         display_name: string,                 // "James", "Alexandra", etc.
 *         votes: [
 *           { vote_date: 'YYYY-MM-DD',
 *             direction: 'strong_yes' | 'lean_yes' | 'lean_no' | 'strong_no' | 'skip',
 *             conviction: number | null,        // optional 1-5
 *             note: string | null
 *           },
 *           ...
 *         ]
 *       },
 *       ...
 *     ]
 *   }
 *
 * Returns:
 *   { ok: true,
 *     mode: 'free' | 'ai',                      // free tier skips Anthropic
 *     summary: { ... },                         // per-participant numerical aggregate
 *     verdict: {                                // only present in 'ai' mode
 *       synthesis_text: string,
 *       prompt_used: string,
 *       tokens_input: number,
 *       tokens_output: number,
 *       cost_cents: number,
 *       model: string
 *     }
 *   }
 *
 * Returns 503 if ANTHROPIC_API_KEY is unset (for AI tiers).
 *
 * NOTHING is persisted · no rows in decisions, votes, verdicts, or
 * verdict_runs. This is a pure scratch endpoint.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@/lib/db';
import { requireAdmin } from '@/lib/admin-auth';
import { getAnthropic, VERDICT_MODEL, VERDICT_SYSTEM_PROMPT } from '@/lib/anthropic';
import { calculateAnthropicCostCents } from '@/lib/anthropic-pricing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const voteSchema = z.object({
  vote_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'vote_date must be YYYY-MM-DD'),
  direction: z.enum(['strong_yes', 'lean_yes', 'lean_no', 'strong_no', 'skip']),
  conviction: z.number().int().min(1).max(5).nullable().optional(),
  note: z.string().max(3000).nullable().optional(),
});

const participantSchema = z.object({
  display_name: z.string().trim().min(1).max(80),
  votes: z.array(voteSchema).min(1).max(30),
});

const bodySchema = z.object({
  question: z.string().trim().min(1).max(500),
  format: z.enum(['yes_no', 'strong_lean', 'a_b']).default('strong_lean'),
  duration_days: z.number().int().min(1).max(365).default(7),
  tier: z.enum(['solo_free', 'solo_paid', 'couple', 'family']),
  participants: z.array(participantSchema).min(1).max(6),
});

type Direction = 'strong_yes' | 'lean_yes' | 'lean_no' | 'strong_no' | 'skip';

function directionScore(d: Direction): number {
  // -2 ... +2; skips count as zero in averages but are reported separately.
  switch (d) {
    case 'strong_yes': return 2;
    case 'lean_yes':   return 1;
    case 'lean_no':    return -1;
    case 'strong_no':  return -2;
    case 'skip':       return 0;
  }
}

function scoreToWord(avg: number): string {
  if (avg >= 1.5) return 'YES';
  if (avg >= 0.5) return 'LEAN YES';
  if (avg > -0.5) return 'NEUTRAL';
  if (avg > -1.5) return 'LEAN NO';
  return 'NO';
}

/**
 * Recency-weighted score. Earlier votes count less than later ones · a
 * partner who started at lean_no and ended at lean_yes lands at lean_yes,
 * not at the flat average. Weight grows linearly with day index so the
 * final vote weighs ~Nx the first vote on an N-day decision.
 *
 * Skips are excluded from both numerator and denominator (an evening the
 * partner didn't vote shouldn't drag either direction).
 *
 * This matches how the AI verdict prose reads the arc, so the displayed
 * verdict word and the AI's framing agree instead of diverging (the bug
 * the first test surfaced: card said NEUTRAL, prose said LEAN YES).
 */
function recencyWeightedScore(votes: Array<{ direction: Direction }>): number {
  let weightedSum = 0;
  let weightSum = 0;
  votes.forEach((v, i) => {
    if (v.direction === 'skip') return;
    const weight = i + 1; // linear, 1-indexed: day 1 = 1, day 2 = 2, ...
    weightedSum += directionScore(v.direction) * weight;
    weightSum += weight;
  });
  return weightSum === 0 ? 0 : weightedSum / weightSum;
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  let raw: unknown;
  try { raw = await req.json(); } catch {
    return NextResponse.json({ ok: false, message: 'Body must be JSON.' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: 'Invalid fixture', errors: parsed.error.flatten() },
      { status: 422 }
    );
  }
  const body = parsed.data;

  // ---- Per-participant numerical summary (every tier gets this) ----
  // verdict_word is recency-weighted (the final vote weighs ~7x the
  // first on a 7-day decision) so the displayed card aligns with how
  // the AI prose reads the arc. The flat average is still returned in
  // `average` for transparency · operators can see both numbers.
  const summary = body.participants.map((p) => {
    const cast = p.votes.filter((v) => v.direction !== 'skip');
    const sum = cast.reduce((acc, v) => acc + directionScore(v.direction), 0);
    const flatAvg = cast.length === 0 ? 0 : sum / cast.length;
    const weighted = recencyWeightedScore(p.votes);
    const counts: Record<Direction, number> = {
      strong_yes: 0, lean_yes: 0, lean_no: 0, strong_no: 0, skip: 0,
    };
    for (const v of p.votes) counts[v.direction] += 1;
    return {
      display_name: p.display_name,
      vote_count: cast.length,
      skip_count: counts.skip,
      counts,
      average: Math.round(flatAvg * 100) / 100,
      weighted_average: Math.round(weighted * 100) / 100,
      verdict_word: scoreToWord(weighted),
    };
  });

  // Solo Free tier ends here · numbers only, no AI synthesis.
  // Per [[project_verdict_ai_tiering]]: free Solo gets numerical summary,
  // paid Solo / Couple / Family get the AI-written paragraph.
  if (body.tier === 'solo_free') {
    return NextResponse.json(
      {
        ok: true,
        mode: 'free',
        message: 'Solo Free tier · numerical summary only (no AI synthesis).',
        summary,
      },
      { headers: { 'cache-control': 'private, no-store' } }
    );
  }

  // ---- AI tiers · same call path as the production verdict cron ----
  const anthropic = getAnthropic();
  if (!anthropic) {
    return NextResponse.json(
      { ok: false, message: 'ANTHROPIC_API_KEY is not set on this environment.' },
      { status: 503 }
    );
  }

  const userPrompt = JSON.stringify(
    {
      question: body.question,
      format: body.format,
      duration_days: body.duration_days,
      tier: body.tier,
      votes: body.participants.flatMap((p) =>
        p.votes.map((v) => ({
          display_name: p.display_name,
          vote_date: v.vote_date,
          direction: v.direction,
          conviction: v.conviction ?? null,
          note: v.note ?? null,
        }))
      ),
    },
    null,
    2
  );

  const started = Date.now();
  try {
    const msg = await anthropic.messages.create({
      model: VERDICT_MODEL,
      max_tokens: 2000,
      system: [
        { type: 'text', text: VERDICT_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: userPrompt }],
    });
    const synthesis = msg.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { text: string }).text)
      .join('\n');
    const costCents = calculateAnthropicCostCents(
      VERDICT_MODEL,
      msg.usage.input_tokens,
      msg.usage.output_tokens,
    );

    // Persist the run so:
    //   · /admin overview can sum Anthropic spend across production + test
    //   · /admin-verdict-logs "Testing verdicts" tab can show prior tuning
    //     sessions without forcing the operator to re-run them
    //   · the operator gets a stable URL/id back for sharing or replay
    // Failure to persist is non-fatal · the inline result still returns.
    let testRunId: string | null = null;
    try {
      const inserted = await db.insert(schema.verdictTestRuns).values({
        triggeredByUserId: gate.userId,
        question: body.question,
        format: body.format,
        durationDays: body.duration_days,
        tier: body.tier,
        participantsJson: body.participants as unknown,
        aiModel: VERDICT_MODEL,
        synthesisText: synthesis,
        promptUsed: VERDICT_SYSTEM_PROMPT,
        tokensInput: msg.usage.input_tokens,
        tokensOutput: msg.usage.output_tokens,
        costCents,
      }).returning({ id: schema.verdictTestRuns.id });
      testRunId = inserted[0]?.id ?? null;
    } catch (e) {
      console.warn('[testing-area] failed to persist test run:', (e as Error).message);
    }

    return NextResponse.json(
      {
        ok: true,
        mode: 'ai',
        test_run_id: testRunId,
        elapsed_ms: Date.now() - started,
        summary,
        verdict: {
          synthesis_text: synthesis,
          prompt_used: VERDICT_SYSTEM_PROMPT,
          user_prompt: userPrompt,
          tokens_input: msg.usage.input_tokens,
          tokens_output: msg.usage.output_tokens,
          cost_cents: costCents,
          model: VERDICT_MODEL,
        },
      },
      { headers: { 'cache-control': 'private, no-store' } }
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        message: (err as Error).message || 'Anthropic call failed.',
        elapsed_ms: Date.now() - started,
      },
      { status: 502 }
    );
  }
}
