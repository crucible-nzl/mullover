/**
 * GET  /api/admin/verdict-model · current model, where it comes from
 *      (admin setting / env var / in-code default), and the selectable list
 *      with pricing so the UI can label options honestly.
 * PUT  /api/admin/verdict-model · { model } · sets the admin override.
 *      Validated against KNOWN_MODELS (exactly the models we can price ·
 *      adding a pricing row is what makes a model selectable). Audit-logged
 *      with the before/after values. Takes effect on the NEXT verdict run ·
 *      no restart, no deploy.
 *
 * The env var VERDICT_AI_MODEL remains as the fallback chain, which also
 * means clearing the row (not offered in the UI · deliberate, one obvious
 * state) would simply restore the env/default behaviour.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin-auth';
import { db, schema } from '@/lib/db';
import { KNOWN_MODELS, priceTableFor } from '@/lib/anthropic-pricing';
import { verdictModelState, VERDICT_MODEL_SETTING_KEY } from '@/lib/verdict-model';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function allowedList() {
  return KNOWN_MODELS.map((id) => {
    const p = priceTableFor(id);
    return {
      id,
      // "$3 / $15 per M tokens" · cents to whole dollars for the label.
      price_label: `$${p.inputCentsPerM / 100} in / $${p.outputCentsPerM / 100} out per M tokens`,
    };
  });
}

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const state = await verdictModelState();
  return NextResponse.json(
    { ok: true, ...state, allowed: allowedList() },
    { headers: { 'cache-control': 'private, no-store' } }
  );
}

const putSchema = z.object({
  model: z.string().refine((m) => KNOWN_MODELS.includes(m), 'Unknown model'),
});

export async function PUT(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  let raw: unknown;
  try { raw = await req.json(); } catch {
    return NextResponse.json({ ok: false, message: 'Body must be JSON.' }, { status: 400 });
  }
  const parsed = putSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: 'Unknown model. Selectable models are exactly the ones with a pricing row.' },
      { status: 422 }
    );
  }

  const before = await verdictModelState();
  await db
    .insert(schema.appSettings)
    .values({ key: VERDICT_MODEL_SETTING_KEY, value: parsed.data.model, updatedBy: gate.userId })
    .onConflictDoUpdate({
      target: schema.appSettings.key,
      set: { value: parsed.data.model, updatedAt: new Date(), updatedBy: gate.userId },
    });

  await db.insert(schema.auditLog).values({
    actorUserId: gate.userId,
    action: 'admin.verdict_model.change',
    targetType: 'app_setting',
    targetId: null,
    metadata: { from: before.model, from_source: before.source, to: parsed.data.model },
  }).catch(() => {});

  const state = await verdictModelState();
  return NextResponse.json(
    { ok: true, ...state, allowed: allowedList(), message: `Verdict model is now ${state.model}. Applies from the next verdict run.` },
    { headers: { 'cache-control': 'private, no-store' } }
  );
}
