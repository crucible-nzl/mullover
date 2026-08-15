/**
 * The verdict AI model, resolved at call time.
 *
 * Precedence: admin-portal setting (app_settings.verdict_ai_model, set from
 * /admin-prompt-editor) → VERDICT_AI_MODEL env var → in-code default. Reading
 * happens per verdict generation, so an admin change applies to the NEXT run
 * with no restart · verdicts are rare (a handful a day at most), so the extra
 * DB read is nothing.
 *
 * Fail-open BY DESIGN: any DB problem (missing table pre-migration, transient
 * outage) silently falls back to the env/default chain. A verdict must never
 * fail to generate because a settings lookup hiccuped. The value is validated
 * against KNOWN_MODELS on read as well as on write, so a hand-edited or stale
 * row can never put an unpriced model name on an Anthropic call.
 */

import { eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { VERDICT_MODEL } from '@/lib/anthropic';
import { KNOWN_MODELS } from '@/lib/anthropic-pricing';

export const VERDICT_MODEL_SETTING_KEY = 'verdict_ai_model';

export async function resolveVerdictModel(): Promise<string> {
  try {
    const rows = await db
      .select({ value: schema.appSettings.value })
      .from(schema.appSettings)
      .where(eq(schema.appSettings.key, VERDICT_MODEL_SETTING_KEY))
      .limit(1);
    const v = rows[0]?.value;
    if (v && KNOWN_MODELS.includes(v)) return v;
  } catch {
    // Settings table unavailable · env/default chain below.
  }
  return VERDICT_MODEL;
}

/** Where the currently-effective model comes from, for the admin UI. */
export async function verdictModelState(): Promise<{ model: string; source: 'admin' | 'env' | 'default' }> {
  try {
    const rows = await db
      .select({ value: schema.appSettings.value })
      .from(schema.appSettings)
      .where(eq(schema.appSettings.key, VERDICT_MODEL_SETTING_KEY))
      .limit(1);
    const v = rows[0]?.value;
    if (v && KNOWN_MODELS.includes(v)) return { model: v, source: 'admin' };
  } catch { /* fall through */ }
  if (process.env.VERDICT_AI_MODEL) return { model: process.env.VERDICT_AI_MODEL, source: 'env' };
  return { model: VERDICT_MODEL, source: 'default' };
}
