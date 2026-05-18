/**
 * GET    /api/me/contacts          · list saved contacts (most-recently-invited first)
 * POST   /api/me/contacts          · add or upsert a contact
 * DELETE /api/me/contacts?id=<uuid> · remove one
 *
 * Contacts auto-save when the user invites someone via /api/compose; this
 * endpoint exists for the /compose quick-pick UI and the /account
 * "Saved contacts" management section.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@/lib/db';
import { readSession, readSessionCookie } from '@/lib/sessions';
import { and, eq, desc } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const session = await readSession(readSessionCookie(req.headers));
  if (!session) {
    return NextResponse.json({ ok: false, message: 'You must be signed in.' }, { status: 401 });
  }

  const rows = await db
    .select({
      id: schema.savedContacts.id,
      displayName: schema.savedContacts.displayName,
      email: schema.savedContacts.email,
      relationship: schema.savedContacts.relationship,
      lastInvitedAt: schema.savedContacts.lastInvitedAt,
      inviteCount: schema.savedContacts.inviteCount,
      createdAt: schema.savedContacts.createdAt,
    })
    .from(schema.savedContacts)
    .where(eq(schema.savedContacts.userId, session.userId))
    .orderBy(desc(schema.savedContacts.lastInvitedAt), desc(schema.savedContacts.createdAt))
    .limit(50);

  return NextResponse.json(
    { ok: true, contacts: rows },
    { status: 200, headers: { 'cache-control': 'private, no-store' } }
  );
}

const postSchema = z.object({
  display_name: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email().max(200),
  relationship: z.enum(['partner', 'family', 'friend', 'other']).optional(),
});

export async function POST(req: Request) {
  const session = await readSession(readSessionCookie(req.headers));
  if (!session) {
    return NextResponse.json({ ok: false, message: 'You must be signed in.' }, { status: 401 });
  }

  let raw: Record<string, unknown>;
  try {
    const ct = req.headers.get('content-type') ?? '';
    raw = ct.includes('application/json')
      ? ((await req.json()) as Record<string, unknown>)
      : Object.fromEntries((await req.formData()).entries());
  } catch {
    return NextResponse.json({ ok: false, message: 'Could not read request body.' }, { status: 400 });
  }

  const parsed = postSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: 'Some fields were invalid.' }, { status: 422 });
  }
  const { display_name, email, relationship } = parsed.data;

  // Upsert: case-insensitive email collision per user updates the display name + relationship
  // rather than erroring. Lets the user "edit" by re-saving.
  const inserted = await db
    .insert(schema.savedContacts)
    .values({
      userId: session.userId,
      displayName: display_name,
      email,
      relationship: relationship ?? null,
    })
    .onConflictDoUpdate({
      target: [schema.savedContacts.userId, schema.savedContacts.email],
      set: {
        displayName: display_name,
        relationship: relationship ?? null,
        updatedAt: new Date(),
      },
    })
    .returning({ id: schema.savedContacts.id });

  return NextResponse.json(
    { ok: true, id: inserted[0].id },
    { status: 200, headers: { 'cache-control': 'private, no-store' } }
  );
}

export async function DELETE(req: Request) {
  const session = await readSession(readSessionCookie(req.headers));
  if (!session) {
    return NextResponse.json({ ok: false, message: 'You must be signed in.' }, { status: 401 });
  }

  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ ok: false, message: 'Invalid contact id.' }, { status: 400 });
  }

  await db
    .delete(schema.savedContacts)
    .where(and(eq(schema.savedContacts.id, id), eq(schema.savedContacts.userId, session.userId)));

  return NextResponse.json({ ok: true, message: 'Contact removed.' }, { status: 200 });
}
