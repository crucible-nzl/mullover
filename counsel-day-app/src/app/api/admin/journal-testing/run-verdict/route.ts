/**
 * POST /api/admin/journal-testing/run-verdict
 *
 * Admin-only sandbox that runs a real Counsel-Journal verdict generation
 * against operator-supplied fixture entries. Mirrors the Decision testing
 * area · NO production writes (no journal_verdicts, no entries, no
 * email), real Anthropic call, cost logged to anthropic_calls ledger
 * with source='journal_testing_area', test run persisted to the
 * journal_verdict_test_runs table.
 *
 * Three modes the operator can select:
 *   · weekly                 · 7 entries → 1 weekly verdict   (1 Claude call)
 *   · monthly_full_pipeline  · 30 entries → 4 weekly verdicts → 1 monthly themed (5 Claude calls)
 *   · monthly_direct         · 30 entries → 1 monthly verdict directly (1 Claude call)
 *
 * Body shape:
 *   {
 *     kind: 'weekly' | 'monthly_full_pipeline' | 'monthly_direct',
 *     fixture_label?: string,
 *     entries: [
 *       { entry_date: 'YYYY-MM-DD', text_content: string },
 *       ...   // 7 for weekly, 30 for monthly_*
 *     ],
 *     ai_model?: string,                // defaults to VERDICT_MODEL
 *     prompt_override?: string,         // optional · overrides the resolved system prompt
 *     monthly_prompt_override?: string  // only used for monthly_full_pipeline
 *   }
 *
 * Returns:
 *   { ok: true,
 *     mode: 'weekly' | 'monthly_full_pipeline' | 'monthly_direct',
 *     test_run_id: string,
 *     elapsed_ms: number,
 *     verdict: { positives, strains, throughline, question_for_next, ... },
 *     intermediate_verdicts?: [...]  // only for monthly_full_pipeline
 *   }
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@/lib/db';
import { requireAdmin } from '@/lib/admin-auth';
import { getAnthropic, VERDICT_MODEL } from '@/lib/anthropic';
import { callAnthropic } from '@/lib/anthropic-call';
import { resolvePrompt } from '@/lib/prompts';
import {
  JOURNAL_WEEKLY_VERDICT_SYSTEM_DEFAULT,
  JOURNAL_MONTHLY_THEMED_SYSTEM_DEFAULT,
  buildWeeklyUserPrompt,
  buildMonthlyUserPrompt,
  buildMonthlyDirectUserPrompt,
} from '@/lib/journal-prompts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const entrySchema = z.object({
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  text_content: z.string().trim().min(1).max(4000),
});

const bodySchema = z.object({
  kind: z.enum(['weekly', 'monthly_full_pipeline', 'monthly_direct']),
  fixture_label: z.string().trim().max(120).optional(),
  entries: z.array(entrySchema).min(3).max(31),
  ai_model: z.string().trim().max(120).optional(),
  prompt_override: z.string().trim().max(20_000).optional(),
  monthly_prompt_override: z.string().trim().max(20_000).optional(),
});

type VerdictShape = {
  positives: string[];
  strains: string[];
  throughline: string;
  question_for_next: string;
};

function parseVerdictJson(text: string): VerdictShape {
  // Anthropic occasionally wraps JSON in ```json fences. Strip them.
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    throw new Error('Claude did not return valid JSON. Raw text: ' + text.slice(0, 200));
  }
  const obj = parsed as Record<string, unknown>;
  const positives = Array.isArray(obj.positives) ? (obj.positives as unknown[]).map((x) => String(x)) : [];
  const strains = Array.isArray(obj.strains) ? (obj.strains as unknown[]).map((x) => String(x)) : [];
  const throughline = typeof obj.throughline === 'string' ? obj.throughline : '';
  const questionForNext = typeof obj.question_for_next === 'string' ? obj.question_for_next : '';
  if (!throughline || !questionForNext) {
    throw new Error('Claude JSON missing required throughline or question_for_next. Raw: ' + text.slice(0, 300));
  }
  return { positives, strains, throughline, question_for_next: questionForNext };
}

/**
 * Split 30 entries into four 7-day blocks. Days 1-7 → week 1, 8-14 →
 * week 2, etc. The 29th and 30th day get folded into week 4. Entry
 * order matters: caller passes chronologically.
 */
function chunkIntoFourWeeks<T>(entries: T[]): T[][] {
  if (entries.length < 28) {
    throw new Error('monthly_full_pipeline requires at least 28 entries (got ' + entries.length + ')');
  }
  return [
    entries.slice(0, 7),
    entries.slice(7, 14),
    entries.slice(14, 21),
    entries.slice(21, entries.length),
  ];
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  if (!getAnthropic()) {
    return NextResponse.json(
      { ok: false, message: 'ANTHROPIC_API_KEY is not set on this environment.' },
      { status: 503 },
    );
  }

  let raw: unknown;
  try { raw = await req.json(); } catch {
    return NextResponse.json({ ok: false, message: 'Body must be JSON.' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: 'Invalid body.', field_errors: parsed.error.flatten().fieldErrors },
      { status: 422 },
    );
  }
  const body = parsed.data;
  const model = body.ai_model || VERDICT_MODEL;
  const started = Date.now();

  // Resolve the prompts. Admin can override either via the request body
  // (live tuning) or via the admin-prompt-editor (persisted on the
  // prompts table). resolvePrompt does the latter; the override on the
  // body wins for this single call.
  const weeklySystem = body.prompt_override
    || (await resolvePrompt('journal_weekly_verdict', JOURNAL_WEEKLY_VERDICT_SYSTEM_DEFAULT));
  const monthlySystem = body.monthly_prompt_override
    || (await resolvePrompt('journal_monthly_themed', JOURNAL_MONTHLY_THEMED_SYSTEM_DEFAULT));

  // Sort entries chronologically · the user prompt expects this order.
  const entries = [...body.entries].sort((a, b) => a.entry_date.localeCompare(b.entry_date));

  try {
    if (body.kind === 'weekly') {
      const userPrompt = buildWeeklyUserPrompt({
        weekStartsOn: entries[0].entry_date,
        weekEndsOn: entries[entries.length - 1].entry_date,
        entries,
      });
      const call = await callAnthropic(
        { source: 'journal_testing_area' },
        {
          model,
          max_tokens: 2000,
          system: [{ type: 'text', text: weeklySystem, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: userPrompt }],
        },
      );
      const text = call.message.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as { text: string }).text)
        .join('\n');
      const verdict = parseVerdictJson(text);

      const runId = await persistTestRun({
        kind: 'weekly',
        fixtureLabel: body.fixture_label,
        entries,
        model,
        prompt: weeklySystem,
        monthlyPrompt: null,
        verdict,
        intermediateVerdicts: null,
        tokensInput: call.tokensInput,
        tokensOutput: call.tokensOutput,
        costCents: call.costCents,
        callCount: 1,
        triggeredByUserId: gate.userId,
      });

      return NextResponse.json(
        {
          ok: true,
          mode: 'weekly',
          test_run_id: runId,
          elapsed_ms: Date.now() - started,
          verdict,
          tokens_input: call.tokensInput,
          tokens_output: call.tokensOutput,
          cost_cents: call.costCents,
          anthropic_call_count: 1,
          model,
          prompt_used: weeklySystem,
        },
        { headers: { 'cache-control': 'private, no-store' } },
      );
    }

    if (body.kind === 'monthly_direct') {
      const userPrompt = buildMonthlyDirectUserPrompt({
        monthLabel: monthLabelFromEntries(entries),
        entries,
      });
      const call = await callAnthropic(
        { source: 'journal_testing_area' },
        {
          model,
          max_tokens: 2500,
          system: [{ type: 'text', text: monthlySystem, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: userPrompt }],
        },
      );
      const text = call.message.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as { text: string }).text)
        .join('\n');
      const verdict = parseVerdictJson(text);

      const runId = await persistTestRun({
        kind: 'monthly_direct',
        fixtureLabel: body.fixture_label,
        entries,
        model,
        prompt: weeklySystem, // not used in this mode but kept for audit
        monthlyPrompt: monthlySystem,
        verdict,
        intermediateVerdicts: null,
        tokensInput: call.tokensInput,
        tokensOutput: call.tokensOutput,
        costCents: call.costCents,
        callCount: 1,
        triggeredByUserId: gate.userId,
      });

      return NextResponse.json(
        {
          ok: true,
          mode: 'monthly_direct',
          test_run_id: runId,
          elapsed_ms: Date.now() - started,
          verdict,
          tokens_input: call.tokensInput,
          tokens_output: call.tokensOutput,
          cost_cents: call.costCents,
          anthropic_call_count: 1,
          model,
          prompt_used: monthlySystem,
        },
        { headers: { 'cache-control': 'private, no-store' } },
      );
    }

    // monthly_full_pipeline · 4 weekly calls then 1 monthly synthesis
    const weeks = chunkIntoFourWeeks(entries);
    let totalIn = 0;
    let totalOut = 0;
    let totalCost = 0;
    const intermediate: Array<{
      week_starts_on: string;
      week_ends_on: string;
      positives: string[];
      strains: string[];
      throughline: string;
      question_for_next: string;
    }> = [];

    for (const week of weeks) {
      const userPrompt = buildWeeklyUserPrompt({
        weekStartsOn: week[0].entry_date,
        weekEndsOn: week[week.length - 1].entry_date,
        entries: week,
      });
      const call = await callAnthropic(
        { source: 'journal_testing_area' },
        {
          model,
          max_tokens: 2000,
          system: [{ type: 'text', text: weeklySystem, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: userPrompt }],
        },
      );
      const text = call.message.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as { text: string }).text)
        .join('\n');
      const weeklyVerdict = parseVerdictJson(text);
      intermediate.push({
        week_starts_on: week[0].entry_date,
        week_ends_on: week[week.length - 1].entry_date,
        ...weeklyVerdict,
      });
      totalIn += call.tokensInput;
      totalOut += call.tokensOutput;
      totalCost += call.costCents;
    }

    // Final monthly synthesis from the four weekly verdicts.
    const monthlyUserPrompt = buildMonthlyUserPrompt({
      monthLabel: monthLabelFromEntries(entries),
      weeklyVerdicts: intermediate,
    });
    const monthlyCall = await callAnthropic(
      { source: 'journal_testing_area' },
      {
        model,
        max_tokens: 2500,
        system: [{ type: 'text', text: monthlySystem, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: monthlyUserPrompt }],
      },
    );
    const monthlyText = monthlyCall.message.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { text: string }).text)
      .join('\n');
    const finalVerdict = parseVerdictJson(monthlyText);
    totalIn += monthlyCall.tokensInput;
    totalOut += monthlyCall.tokensOutput;
    totalCost += monthlyCall.costCents;

    const runId = await persistTestRun({
      kind: 'monthly_full_pipeline',
      fixtureLabel: body.fixture_label,
      entries,
      model,
      prompt: weeklySystem,
      monthlyPrompt: monthlySystem,
      verdict: finalVerdict,
      intermediateVerdicts: intermediate,
      tokensInput: totalIn,
      tokensOutput: totalOut,
      costCents: totalCost,
      callCount: 5,
      triggeredByUserId: gate.userId,
    });

    return NextResponse.json(
      {
        ok: true,
        mode: 'monthly_full_pipeline',
        test_run_id: runId,
        elapsed_ms: Date.now() - started,
        verdict: finalVerdict,
        intermediate_verdicts: intermediate,
        tokens_input: totalIn,
        tokens_output: totalOut,
        cost_cents: totalCost,
        anthropic_call_count: 5,
        model,
        prompt_used: monthlySystem,
        weekly_prompt_used: weeklySystem,
      },
      { headers: { 'cache-control': 'private, no-store' } },
    );
  } catch (err) {
    console.warn('[journal-testing] verdict run failed', err);
    return NextResponse.json(
      {
        ok: false,
        message: (err as Error).message || 'Verdict generation failed.',
        elapsed_ms: Date.now() - started,
      },
      { status: 502 },
    );
  }
}

function monthLabelFromEntries(entries: Array<{ entry_date: string }>): string {
  const first = entries[0]?.entry_date ?? '';
  const [y, m] = first.split('-');
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const idx = Math.max(0, Math.min(11, Number(m) - 1));
  return `${monthNames[idx]} ${y}`;
}

async function persistTestRun(args: {
  kind: 'weekly' | 'monthly_full_pipeline' | 'monthly_direct';
  fixtureLabel: string | undefined;
  entries: Array<{ entry_date: string; text_content: string }>;
  model: string;
  prompt: string;
  monthlyPrompt: string | null;
  verdict: VerdictShape;
  intermediateVerdicts: unknown | null;
  tokensInput: number;
  tokensOutput: number;
  costCents: number;
  callCount: number;
  triggeredByUserId: string;
}): Promise<string | null> {
  try {
    const inserted = await db.insert(schema.journalVerdictTestRuns).values({
      kind: args.kind,
      fixtureLabel: args.fixtureLabel ?? null,
      entriesJson: args.entries,
      aiModel: args.model,
      promptUsed: args.prompt,
      monthlyPromptUsed: args.monthlyPrompt,
      positivesJson: args.verdict.positives,
      strainsJson: args.verdict.strains,
      throughline: args.verdict.throughline,
      questionForNext: args.verdict.question_for_next,
      intermediateVerdictsJson: args.intermediateVerdicts,
      tokensInput: args.tokensInput,
      tokensOutput: args.tokensOutput,
      costCents: args.costCents,
      anthropicCallCount: args.callCount,
      triggeredByUserId: args.triggeredByUserId,
    }).returning({ id: schema.journalVerdictTestRuns.id });
    return inserted[0]?.id ?? null;
  } catch (e) {
    console.warn('[journal-testing] failed to persist test run:', (e as Error).message);
    return null;
  }
}
