/**
 * Counsel Journal verdict prompts · shared between the production cron
 * (src/jobs/cron.ts) and the admin testing harness (/api/admin/journal-
 * testing/run-verdict). Centralised here so the test path uses the
 * exact same prompt the real Monday verdict uses, and so a single
 * admin-prompt-editor override applies to both surfaces.
 *
 * Positives-first revision · 2026-06-05 · James's call. Counsel Journal
 * is a positive-reinforcement product; verdicts ALWAYS lead with what
 * kept working, and strain is only named when CLEARLY recurring (3+
 * mentions or pattern across multiple days/weeks).
 */

export const JOURNAL_WEEKLY_VERDICT_SYSTEM_DEFAULT = `You are the Counsel.day editorial voice writing a weekly verdict on a user's daily journal entries. You are observational, not advisory.

ALWAYS lead with the positives · what kept working across the week. Surface 3-5 specific positives, each one rooted in evidence from the entries (the day it appeared, the words the writer used). The journal exists to help future-the-writer see what is durably working, not to dwell on what is hard.

Only after the positives are named, you may name 1-2 strains · and ONLY if they are CLEARLY RECURRING across multiple entries (three or more mentions, or a pattern across the week). A one-off frustration on a single day is not a strain · let it go. If the writer had a hard day inside an otherwise solid week, the verdict respects that the hard day was the exception, not the throughline.

You quote the user's own phrasing back to them. You do not give advice, you do not diagnose, you do not coach. You write one specific concrete question for the week ahead, drawn from the throughline you just named.

Formatting: positives + strains as plain phrases (no bullets in the JSON values). The throughline is one prose paragraph of 2-4 sentences · no bullets, no advice. The question is a single concrete sentence the writer can carry into the next seven evenings.

Never use the words "feel", "you should", "you might consider", "try to", "remember to", "consider", "perhaps", "maybe". The voice is observational, calm, and present-tense. It reads what the writer wrote and reflects it back · nothing more.`;

export const JOURNAL_MONTHLY_THEMED_SYSTEM_DEFAULT = `You are the Counsel.day editorial voice writing the monthly themed verdict on a Counsel Journal subscriber. The input is the FOUR weekly verdicts that shipped across the past four Mondays · not the raw daily entries. Your job is to name what the MONTH was actually about · the shape of it, not the moments.

ALWAYS lead with positives · the patterns of working that show up across two or more of the four weeks. Name 3-5 of these specifically, with reference to which weeks they recurred (e.g. "Weeks 2 and 4 both named the morning walk as the steadier anchor"). The themes that recur across weeks ARE the throughline of the month.

Only after positives are named, name 1-2 strains · and ONLY if they recurred across THREE OR MORE of the four weeks. A pattern that showed up in one week is not the month's throughline · let it go. If the writer had a difficult week inside an otherwise solid month, the monthly verdict respects that the difficult week was a chapter, not the spine.

The throughline names the SHAPE of the month · what was the month actually about, beneath the day-to-day texture? One prose paragraph, 3-5 sentences, no bullets. The closing question is a single concrete one that opens the month ahead · not advice, a question the writer can carry.

Never use the words "feel", "you should", "you might consider", "try to", "remember to", "consider", "perhaps", "maybe". Observational voice, present tense, drawn from the weekly verdicts the writer already has in their vault.`;

/**
 * User-prompt builder · weekly. Hands Claude a JSON document with the
 * date range and the entries it should reflect. The system prompt above
 * controls the voice + structure; this controls the input.
 */
export function buildWeeklyUserPrompt(args: {
  weekStartsOn: string;
  weekEndsOn: string;
  entries: Array<{ entry_date: string; text_content: string }>;
}): string {
  return `Write the weekly Counsel Journal verdict for the entries below. Return ONLY valid JSON matching this exact schema:

{
  "positives": ["string", "string", "string"],          // 3-5 specific positives, lead with these
  "strains":   ["string"],                              // 0-2 strains, ONLY if recurring; can be empty
  "throughline": "string",                              // 2-4 sentence prose paragraph
  "question_for_next": "string"                         // one concrete question for the week ahead
}

Week: ${args.weekStartsOn} to ${args.weekEndsOn}

Entries (in chronological order):

${args.entries
  .map((e) => `--- ${e.entry_date} ---\n${e.text_content.trim()}`)
  .join('\n\n')}
`;
}

/**
 * User-prompt builder · monthly themed verdict. Hands Claude the FOUR
 * weekly verdicts that shipped this month (NOT raw entries).
 */
export function buildMonthlyUserPrompt(args: {
  monthLabel: string;
  weeklyVerdicts: Array<{
    week_starts_on: string;
    week_ends_on: string;
    positives: string[];
    strains: string[];
    throughline: string;
  }>;
}): string {
  return `Write the monthly themed Counsel Journal verdict for ${args.monthLabel}. The input is the four weekly verdicts that shipped this month. Return ONLY valid JSON matching this exact schema:

{
  "positives": ["string", "string", "string"],
  "strains":   ["string"],
  "throughline": "string",
  "question_for_next": "string"
}

The four weekly verdicts (in chronological order):

${args.weeklyVerdicts
  .map(
    (v, i) =>
      `--- Week ${i + 1} · ${v.week_starts_on} to ${v.week_ends_on} ---\n` +
      `Positives: ${v.positives.join(' · ')}\n` +
      `Strains: ${v.strains.length ? v.strains.join(' · ') : '(none)'}\n` +
      `Throughline: ${v.throughline}`,
  )
  .join('\n\n')}
`;
}

/**
 * Monthly direct variant · 30 entries fed directly into ONE Claude call
 * instead of going through the 4-weekly pipeline. Cheaper, less faithful
 * to production. Used by the test harness's "Monthly · direct" mode.
 */
export function buildMonthlyDirectUserPrompt(args: {
  monthLabel: string;
  entries: Array<{ entry_date: string; text_content: string }>;
}): string {
  return `Write the monthly themed Counsel Journal verdict for ${args.monthLabel}. The input is 30 daily entries · synthesise them in ONE pass (you do not need to produce intermediate weekly verdicts). Return ONLY valid JSON matching this exact schema:

{
  "positives": ["string", "string", "string"],
  "strains":   ["string"],
  "throughline": "string",
  "question_for_next": "string"
}

Entries (in chronological order):

${args.entries
  .map((e) => `--- ${e.entry_date} ---\n${e.text_content.trim()}`)
  .join('\n\n')}
`;
}
