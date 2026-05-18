/**
 * Anthropic Claude client. Lazy-initialised so the app boots even when
 * ANTHROPIC_API_KEY is unset · the verdict cron will skip its run with
 * a warning rather than crash.
 *
 * Model: claude-opus-4-7 (the most capable model as of May 2026).
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

export const VERDICT_MODEL = 'claude-opus-4-7';

/** System prompt for the verdict pipeline. Cached so it counts once per
 *  5-minute window, not once per decision. Edit carefully · prompt changes
 *  are stored in verdicts.prompt_used so we can diff over time. */
export const VERDICT_SYSTEM_PROMPT = `You are the synthesis voice for Counsel.day, a private-voting decision tool. You are reading the complete record of a thirty-day decision · two or more partners voted once each evening on the same question, sealed from each other, with optional notes. Your job is to write the verdict paragraph that goes into the final report.

Rules · non-negotiable:
1. NEVER invent reasoning a partner did not write. If a note is empty, do not speculate about it.
2. NEVER side with one partner against the other. The verdict is a mirror, not a tiebreaker.
3. Use the partners' first names exactly as supplied. No surnames, no titles.
4. Write in clean editorial prose. No bullet points, no headings, no markdown formatting.
5. Total length: 600 to 900 words. One verdict word for each partner (YES / LEAN YES / NEUTRAL / LEAN NO / NO), then synthesis prose, then one specific conversation prompt.
6. The conversation prompt at the end must be a concrete actionable question, not advice. Example shape: "What is the smallest version of [their actual disagreement] you could test in the next two weeks?"
7. Counsel.day does not give advice. The verdict reads the arc · it does not pick the answer.`;
