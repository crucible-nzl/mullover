/**
 * Per-model pricing for the Anthropic verdict pipeline. Source of
 * truth for cost calculations · used by both the cron (writes
 * verdicts.cost_cents on real verdict runs) and the admin testing
 * area (shows cost in the result panel).
 *
 * Prices are USD cents per million tokens. Update against
 * https://www.anthropic.com/pricing when Anthropic changes them ·
 * the per-million unit makes the maths cheap (multiply tokens, divide
 * by 1e6, round up).
 *
 * Why a function and not a flat constant: VERDICT_MODEL is env-
 * overridable, so the same code path serves any of Opus / Sonnet /
 * Haiku. Hardcoding Opus prices (the original bug) silently mis-
 * priced every verdict the moment the model env flipped.
 */

type AnthropicPriceRow = {
  /** USD cents per 1,000,000 input tokens. */
  inputCentsPerM: number;
  /** USD cents per 1,000,000 output tokens. */
  outputCentsPerM: number;
};

const PRICES: Record<string, AnthropicPriceRow> = {
  // Opus 4.7: $15 / $75 per M tokens · 1,500 / 7,500 cents
  'claude-opus-4-7': { inputCentsPerM: 1_500, outputCentsPerM: 7_500 },

  // Sonnet 4.6: $3 / $15 per M tokens · 300 / 1,500 cents
  'claude-sonnet-4-6': { inputCentsPerM: 300, outputCentsPerM: 1_500 },

  // Haiku 4.5 (dated alias): $1 / $5 per M tokens · 100 / 500 cents
  'claude-haiku-4-5-20251001': { inputCentsPerM: 100, outputCentsPerM: 500 },
};

/**
 * Cost in cents for an Anthropic call, rounded UP so we never under-
 * report. Falls back to Opus pricing when the model is unknown · safe
 * conservative default (we'll over-report rather than miss spend).
 */
export function calculateAnthropicCostCents(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const price = PRICES[model] ?? PRICES['claude-opus-4-7'];
  return Math.ceil(
    (inputTokens * price.inputCentsPerM + outputTokens * price.outputCentsPerM) / 1_000_000
  );
}

/** Lets the admin UI render "claude-sonnet-4-6 · $3 in / $15 out". */
export function priceTableFor(model: string): AnthropicPriceRow {
  return PRICES[model] ?? PRICES['claude-opus-4-7'];
}
