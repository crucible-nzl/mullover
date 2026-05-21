/**
 * Single choke-point for every Anthropic messages.create() call the
 * app makes. Wraps the SDK so we record token usage, cost, request id,
 * and duration to the anthropic_calls table on every invocation.
 *
 * Why this layer exists: Anthropic's Admin API has multi-hour
 * ingestion lag (verified 2026-05-22 · the console showed $0.14 spent
 * while cost_report returned only $0.0032 for the same period). The
 * console's live "spent" figure has no public API equivalent. So we
 * track our own product spend here · authoritative for Counsel.day,
 * does not include Claude Code / external usage on the same key.
 *
 * Every callsite that previously did `anthropic.messages.create(...)`
 * should now go through `callAnthropic({ source, ... })`. The function
 * returns the SDK message untouched, plus a few derived fields for
 * convenience (tokensInput, tokensOutput, costCents) so the caller
 * doesn't repeat the same math.
 */

import type { Message, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages';
import { getAnthropic } from './anthropic';
import { calculateAnthropicCostCents } from './anthropic-pricing';
import { db } from './db';
import { anthropicCalls } from './schema';

// Non-streaming only · everything in the app uses a single response, not
// a stream. Pinning the type here keeps callers from having to narrow
// the SDK's Stream | Message union themselves.
type MessagesCreateParams = MessageCreateParamsNonStreaming;
type MessagesResponse = Message & { _request_id?: string | null };

export type AnthropicCallContext = {
  // Where this call comes from. Stored as anthropic_calls.source · keep
  // values short and snake_case. Known values: 'verdict_cron',
  // 'testing_area'; add 'chatbot' / 'time_capsule' when those land.
  source: string;
  // Optional back-pointers for drill-down from the ledger. Set whichever
  // applies; the wrapper writes NULL for the rest.
  decisionId?: string | null;
  testRunId?: string | null;
};

export type CallResult = {
  message: MessagesResponse;
  // Convenience aggregates so the caller doesn't recompute. usage.input_tokens
  // and usage.output_tokens come from the SDK response; costCents is derived
  // from anthropic-pricing.ts using the response's model field (which can
  // differ from the request when Anthropic does model-routing).
  tokensInput: number;
  tokensOutput: number;
  costCents: number;
  requestId: string | null;
  durationMs: number;
};

/**
 * Make a messages.create() call and log it. Throws on SDK errors after
 * recording the failure row · the caller's existing try/catch still
 * handles the error path, the row is just for audit.
 */
export async function callAnthropic(
  ctx: AnthropicCallContext,
  params: MessagesCreateParams
): Promise<CallResult> {
  const client = getAnthropic();
  if (!client) {
    throw new Error('Anthropic client not configured (ANTHROPIC_API_KEY missing)');
  }

  const started = Date.now();
  let message: MessagesResponse;
  let errorMessage: string | null = null;
  try {
    // Cast through unknown · the SDK's overload returns Stream | Message
    // and we know we never pass stream:true, but TS can't see that.
    message = (await client.messages.create(params)) as unknown as MessagesResponse;
  } catch (err) {
    errorMessage = (err as Error).message?.slice(0, 1000) ?? String(err);
    // Record the failure row before re-throwing so the operator can see
    // it in the ledger even when the call blew up.
    const durationMs = Date.now() - started;
    await db.insert(anthropicCalls).values({
      source: ctx.source,
      model: typeof params.model === 'string' ? params.model : 'unknown',
      tokensInput: 0,
      tokensOutput: 0,
      costCents: 0,
      decisionId: ctx.decisionId ?? null,
      testRunId: ctx.testRunId ?? null,
      requestId: null,
      durationMs,
      ok: false,
      error: errorMessage,
    }).catch((logErr) => {
      console.warn('[anthropic-call] failed to log failure row:', (logErr as Error).message);
    });
    throw err;
  }

  const durationMs = Date.now() - started;
  // Anthropic streaming responses don't expose usage on the response
  // object the same way; we only support non-stream here. Both current
  // call sites are non-stream so this is fine.
  const usage = (message as { usage?: { input_tokens?: number; output_tokens?: number } }).usage ?? {};
  const tokensInput = Number(usage.input_tokens ?? 0) || 0;
  const tokensOutput = Number(usage.output_tokens ?? 0) || 0;
  const modelUsed = (message as { model?: string }).model
    ?? (typeof params.model === 'string' ? params.model : 'unknown');
  const costCents = calculateAnthropicCostCents(modelUsed, tokensInput, tokensOutput);
  const requestId = (message as { _request_id?: string | null })._request_id ?? null;

  // Fire-and-forget insert · we don't want a ledger write to ever block
  // returning the response to the caller. Errors are swallowed with a
  // warn so a transient DB hiccup can't break verdict generation.
  void db.insert(anthropicCalls).values({
    source: ctx.source,
    model: modelUsed,
    tokensInput,
    tokensOutput,
    costCents,
    decisionId: ctx.decisionId ?? null,
    testRunId: ctx.testRunId ?? null,
    requestId,
    durationMs,
    ok: true,
    error: null,
  }).catch((err) => {
    console.warn('[anthropic-call] failed to log success row:', (err as Error).message);
  });

  return {
    message,
    tokensInput,
    tokensOutput,
    costCents,
    requestId,
    durationMs,
  };
}
