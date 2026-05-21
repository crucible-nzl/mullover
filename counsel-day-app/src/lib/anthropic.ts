/**
 * Anthropic Claude client. Lazy-initialised so the app boots even when
 * ANTHROPIC_API_KEY is unset · the verdict cron will skip its run with
 * a warning rather than crash.
 *
 * Model is env-overridable via VERDICT_AI_MODEL so the operator can flip
 * Opus / Sonnet / Haiku without a code change. Default is Sonnet 4.6 ·
 * the verdict task is structured prose under tight rules, not Opus-class
 * reasoning, and Sonnet runs ~5x cheaper. To revert to Opus, set
 * VERDICT_AI_MODEL=claude-opus-4-7 in /etc/counsel-day-app/env.local
 * and `sudo systemctl restart counsel-day-app`.
 *
 * Prompt caching is used on the system prompt because every verdict
 * uses the same template, only the votes/notes differ.
 */

import Anthropic from '@anthropic-ai/sdk';

let _client: Anthropic | null = null;

export function getAnthropic(): Anthropic | null {
  if (_client) return _client;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  _client = new Anthropic({ apiKey: key });
  return _client;
}

export const VERDICT_MODEL = process.env.VERDICT_AI_MODEL || 'claude-sonnet-4-6';

/** System prompt for the verdict pipeline. Cached so it counts once per
 *  5-minute window, not once per decision. Edit carefully · prompt changes
 *  are stored in verdicts.prompt_used so we can diff over time.
 *
 *  Rule design notes:
 *  · Rule 1 is the no-paraphrase clause. The first test run on 2026-05-21
 *    expanded "mum" to "a relationship he did not want to disrupt" and
 *    "studio" to "a working life she had built." Both are reasonable
 *    inferences and both are wrong by policy · the verdict reads the
 *    record, it does not generalise it.
 *  · Rule 4 forbids the heading-style "James: LEAN YES" label that the
 *    earlier prompt produced. The numerical verdict word is calculated
 *    and shown on a separate card; the AI does not generate it.
 *  · Rule 5 is 400-600 words, down from the original 600-900. The
 *    shorter budget kills the drift-toward-advice paragraphs that the
 *    long form tolerated. */
export const VERDICT_SYSTEM_PROMPT = `You are the synthesis voice for Counsel.day, a private-voting decision tool. You are reading the complete record of a decision · one or more partners voted once each evening on the same question, sealed from each other, with optional notes. Your job is to write the verdict paragraph that goes into the final report.

Rules · non-negotiable:
1. NEVER invent reasoning a partner did not write. Never paraphrase a note into a different kind of claim. If a partner wrote "mum," write "mum" · do not generalise to "family" or "relationship." If they wrote "studio," write "studio" · do not generalise to "her work" or "her creative life." Use the exact nouns the partners used. If a note is empty, do not speculate about it.
2. NEVER side with one partner against the other. The verdict is a mirror, not a tiebreaker.
3. Use the partners' first names exactly as supplied. No surnames, no titles.
4. Write in clean editorial prose. No bullet points, no headings, no markdown formatting. Do NOT begin with a label like "James: LEAN YES" · the verdict word is calculated separately and shown on its own card. Begin your output directly with the synthesis prose.
5. Total length: 400 to 600 words. Then one specific conversation prompt to close.
6. The conversation prompt at the end must be a concrete actionable question, not advice. Example shape: "What is the smallest version of [their actual disagreement] you could test in the next two weeks?"
7. Counsel.day does not give advice. Read the arc · do not pick the answer. Do not name patterns the partners should carry into other decisions. Do not suggest what either partner should hold, remember, or notice. The verdict ends at the conversation prompt.`;
