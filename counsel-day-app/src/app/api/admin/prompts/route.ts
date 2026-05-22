/**
 * GET    /api/admin/prompts?kind=<kind>            · list all versions of a kind
 * POST   /api/admin/prompts                        · save a new version + activate
 *           body: { kind, text, notes? }
 * PATCH  /api/admin/prompts                        · activate an existing version
 *           body: { kind, version_id }
 *
 * Admin-only. Every action audit-logged so the operator history is
 * visible from /admin-audit-log.html.
 *
 * Cache invalidation: callers of resolvePrompt() observe new active
 * prompts within at most 5 minutes; this route also calls
 * invalidatePromptCache(kind) immediately so the next request reads
 * the new active row from DB without waiting.
 */

import { NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { requireAdmin } from '@/lib/admin-auth';
import { sql, eq, and, desc } from 'drizzle-orm';
import { savePromptVersion, activatePromptVersion, invalidatePromptCache } from '@/lib/prompts';
import { VERDICT_SYSTEM_PROMPT } from '@/lib/anthropic';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const KNOWN_KINDS = new Set(['verdict_synthesis', 'chatbot_system']);

// Importing chatbot system prompt directly from the chatbot route file
// would be awkward; we duplicate the safety-net text reading here so
// the editor can show the operator the in-code default for either kind.
// If it ever drifts, this is the editor's display only · the chatbot
// route holds its own truth. (Worth refactoring into a shared constants
// module the moment a third kind appears.)
function getCodeDefault(kind: string): string {
  if (kind === 'verdict_synthesis') return VERDICT_SYSTEM_PROMPT;
  // chatbot_system constant lives in the chatbot route; surfacing it
  // here would create a circular import. Instead the editor falls back
  // to "(no in-code default surfaced)" and the operator can still save
  // overrides; the route's local constant remains the runtime fallback.
  return '';
}

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const url = new URL(req.url);
  const kind = String(url.searchParams.get('kind') ?? '');
  if (!kind || !KNOWN_KINDS.has(kind)) {
    return NextResponse.json({ ok: false, message: 'Unknown kind. Valid: verdict_synthesis, chatbot_system.' }, { status: 400 });
  }
  const rows = await db
    .select({
      id: schema.prompts.id,
      version: schema.prompts.version,
      text: schema.prompts.text,
      notes: schema.prompts.notes,
      isActive: schema.prompts.isActive,
      createdAt: schema.prompts.createdAt,
      createdBy: schema.prompts.createdBy,
    })
    .from(schema.prompts)
    .where(eq(schema.prompts.kind, kind))
    .orderBy(desc(schema.prompts.version));

  return NextResponse.json(
    {
      ok: true,
      kind,
      code_default: getCodeDefault(kind),
      versions: rows,
    },
    { status: 200, headers: { 'cache-control': 'private, no-store' } }
  );
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  let body: { kind?: string; text?: string; notes?: string } = {};
  try { body = await req.json(); } catch { /* validation below */ }
  const kind = String(body.kind ?? '');
  const text = String(body.text ?? '');
  if (!KNOWN_KINDS.has(kind)) {
    return NextResponse.json({ ok: false, message: 'Unknown kind.' }, { status: 400 });
  }
  if (text.trim().length < 50) {
    return NextResponse.json({ ok: false, message: 'Prompt text must be at least 50 characters.' }, { status: 422 });
  }
  if (text.length > 50000) {
    return NextResponse.json({ ok: false, message: 'Prompt text is too long (max 50K chars).' }, { status: 422 });
  }

  const saved = await savePromptVersion({
    kind, text, notes: body.notes ?? null, createdBy: gate.userId,
  });

  await db.insert(schema.auditLog).values({
    actorUserId: gate.userId,
    action: 'admin.prompt.saved',
    targetType: 'prompt',
    targetId: String(saved.id),
    metadata: { kind, version: saved.version },
  }).catch(() => {});

  return NextResponse.json(
    { ok: true, id: saved.id, version: saved.version },
    { status: 200, headers: { 'cache-control': 'private, no-store' } }
  );
}

export async function PATCH(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  let body: { kind?: string; version_id?: number } = {};
  try { body = await req.json(); } catch { /* validation below */ }
  const kind = String(body.kind ?? '');
  const versionId = Number(body.version_id);
  if (!KNOWN_KINDS.has(kind) || !Number.isFinite(versionId)) {
    return NextResponse.json({ ok: false, message: 'kind + version_id required.' }, { status: 400 });
  }
  try {
    await activatePromptVersion({ kind, versionId });
  } catch (err) {
    return NextResponse.json({ ok: false, message: (err as Error).message }, { status: 404 });
  }
  invalidatePromptCache(kind);
  await db.insert(schema.auditLog).values({
    actorUserId: gate.userId,
    action: 'admin.prompt.activated',
    targetType: 'prompt',
    targetId: String(versionId),
    metadata: { kind },
  }).catch(() => {});
  return NextResponse.json({ ok: true, activated: versionId }, { status: 200 });
}
