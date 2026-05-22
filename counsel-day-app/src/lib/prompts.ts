/**
 * Prompts registry · reads the active row from the `prompts` table
 * with a 5-minute in-memory cache, falling back to an in-code default
 * when no DB row exists for the given kind.
 *
 * Call sites:
 *   · src/jobs/cron.ts verdictGenerate     · kind: 'verdict_synthesis'
 *   · src/app/api/admin/testing-area/run-verdict  · same
 *   · src/app/api/chatbot/message          · kind: 'chatbot_system'
 *
 * The defaults baked into the call sites are the SAFETY NET. If the
 * DB read fails or the table is empty, the in-code prompt still ships.
 * This makes the operator's editor an additive override · the system
 * always has SOMETHING to send to Claude.
 *
 * Cache is best-effort · admin actions that save a new prompt should
 * call `invalidatePromptCache(kind)` to flush the cache so the next
 * request reads the new active row. Otherwise the cache rolls naturally
 * within 5 minutes.
 */

import { db, schema } from './db';
import { and, eq, sql } from 'drizzle-orm';

type CachedPrompt = { text: string; version: number; readAt: number };

const cache = new Map<string, CachedPrompt>();
const TTL_MS = 5 * 60 * 1000;

/**
 * Return the active prompt for the given kind, or null if no override
 * is set in DB. The caller falls back to its in-code default.
 */
export async function getActivePrompt(kind: string): Promise<{ text: string; version: number } | null> {
  const cached = cache.get(kind);
  if (cached && Date.now() - cached.readAt < TTL_MS) {
    return { text: cached.text, version: cached.version };
  }
  try {
    const rows = await db
      .select({ text: schema.prompts.text, version: schema.prompts.version })
      .from(schema.prompts)
      .where(and(eq(schema.prompts.kind, kind), eq(schema.prompts.isActive, true)))
      .limit(1);
    if (rows.length === 0) {
      // Negative cache · don't hammer the DB on every request when
      // no override exists. 60s is enough to absorb a hot loop.
      cache.set(kind, { text: '', version: -1, readAt: Date.now() - (TTL_MS - 60_000) });
      return null;
    }
    cache.set(kind, { text: rows[0].text, version: rows[0].version, readAt: Date.now() });
    return rows[0];
  } catch (err) {
    console.warn('[prompts] DB read failed for kind=' + kind + ':', (err as Error).message);
    return null;
  }
}

/**
 * Helper: returns the DB prompt if set, else the provided fallback.
 * Most call sites should use this · avoids a per-callsite ternary.
 */
export async function resolvePrompt(kind: string, fallback: string): Promise<string> {
  const row = await getActivePrompt(kind);
  return row?.text ?? fallback;
}

export function invalidatePromptCache(kind?: string): void {
  if (kind) cache.delete(kind);
  else cache.clear();
}

/**
 * Save a new prompt version + flip is_active. Transactional so we
 * never end up with two active rows for the same kind.
 */
export async function savePromptVersion(args: {
  kind: string;
  text: string;
  notes?: string | null;
  createdBy?: string | null;
}): Promise<{ id: number; version: number }> {
  return await db.transaction(async (tx) => {
    // Find current max version for this kind
    const maxRows = await tx.execute<{ max_version: string | null }>(sql`
      SELECT MAX(version)::text AS max_version FROM prompts WHERE kind = ${args.kind}
    `);
    const currentMax = Number((maxRows[0] as { max_version: string | null })?.max_version ?? 0) || 0;
    const newVersion = currentMax + 1;

    // Deactivate prior active row(s) for this kind. The partial unique
    // index would catch a double-active state at insert time anyway,
    // but this is cleaner.
    await tx.execute(sql`
      UPDATE prompts SET is_active = FALSE WHERE kind = ${args.kind} AND is_active = TRUE
    `);

    const inserted = await tx.insert(schema.prompts).values({
      kind: args.kind,
      version: newVersion,
      text: args.text,
      notes: args.notes ?? null,
      createdBy: args.createdBy ?? null,
      isActive: true,
    }).returning({ id: schema.prompts.id, version: schema.prompts.version });

    return inserted[0];
  });
}

/**
 * Roll back to a prior version by id. Marks the target row is_active=true
 * and all other rows for that kind is_active=false. Transactional.
 */
export async function activatePromptVersion(args: { kind: string; versionId: number }): Promise<void> {
  await db.transaction(async (tx) => {
    // Verify the target exists and is for the right kind
    const targetRows = await tx
      .select({ id: schema.prompts.id })
      .from(schema.prompts)
      .where(and(eq(schema.prompts.id, args.versionId), eq(schema.prompts.kind, args.kind)))
      .limit(1);
    if (targetRows.length === 0) {
      throw new Error('Version not found for kind ' + args.kind);
    }
    await tx.execute(sql`
      UPDATE prompts SET is_active = FALSE WHERE kind = ${args.kind} AND is_active = TRUE
    `);
    await tx.execute(sql`
      UPDATE prompts SET is_active = TRUE WHERE id = ${args.versionId}
    `);
  });
  invalidatePromptCache(args.kind);
}
