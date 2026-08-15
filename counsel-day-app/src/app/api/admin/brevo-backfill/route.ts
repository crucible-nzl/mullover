/**
 * POST /api/admin/brevo-backfill
 *
 * One-shot (re-runnable) sync of every verified, non-deleted user into
 * Brevo Contacts. Exists because the contact sync only shipped on
 * 2026-08-16 · every signup before that date sent transactional email
 * through Brevo without ever creating a contact, so the Contacts view
 * showed one hand-made entry against six real users.
 *
 * Idempotent: upsertBrevoContact uses updateEnabled, so running this twice
 * updates rather than duplicates. Safe to re-run after any future outage.
 *
 * Paced at ~5 contacts/second · far under Brevo's rate limit, and the
 * expected volume is tens of rows, not thousands. Admin-gated, audit-logged.
 */

import { NextResponse } from 'next/server';
import { and, isNull, isNotNull } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { requireAdmin } from '@/lib/admin-auth';
import { upsertBrevoContact } from '@/lib/brevo-contacts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  if (!process.env.BREVO_API_KEY) {
    return NextResponse.json({ ok: false, message: 'BREVO_API_KEY is not set on this environment.' }, { status: 503 });
  }

  // Verified + not deleted. Unverified rows are excluded on purpose: those
  // addresses never proved they exist, and pushing them to Brevo would
  // seed the contact base with typos.
  const users = await db
    .select({
      email: schema.users.email,
      firstName: schema.users.firstName,
      marketingConsent: schema.users.marketingConsent,
    })
    .from(schema.users)
    .where(and(isNull(schema.users.deletedAt), isNotNull(schema.users.emailVerifiedAt)));

  let synced = 0;
  let failed = 0;
  for (const u of users) {
    const r = await upsertBrevoContact(u);
    if (r.ok) synced++;
    else failed++;
    await sleep(200);
  }

  await db.insert(schema.auditLog).values({
    actorUserId: gate.userId,
    action: 'admin.brevo_backfill.run',
    targetType: 'integration',
    targetId: null,
    metadata: { considered: users.length, synced, failed },
  }).catch(() => {});

  return NextResponse.json(
    {
      ok: true,
      considered: users.length,
      synced,
      failed,
      note: failed > 0
        ? 'Some contacts failed · check the app logs. Commonest cause: the MARKETING_CONSENT attribute not yet created in Brevo (Contacts > Settings > Contact attributes); those rows land without attributes on the automatic retry.'
        : 'All verified users are now in Brevo Contacts. Re-running is safe (upsert).',
    },
    { headers: { 'cache-control': 'private, no-store' } }
  );
}
