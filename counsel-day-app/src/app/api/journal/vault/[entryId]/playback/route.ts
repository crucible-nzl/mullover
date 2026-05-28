/**
 * GET /api/journal/vault/[entryId]/playback
 *
 * Returns a signed Cloudflare R2 URL for the audio file behind a
 * single journal entry. Short-lived (default 60 minutes, configurable
 * via R2_SIGNED_URL_MINS in env.local). The client never sees the
 * raw R2 endpoint or credentials.
 *
 * Pre-requisites in env.local:
 *   R2_ENDPOINT          (https://<account-id>.r2.cloudflarestorage.com)
 *   R2_ACCESS_KEY_ID
 *   R2_SECRET_ACCESS_KEY
 *   R2_BUCKET            (e.g. "counsel-journal-audio")
 *   R2_SIGNED_URL_MINS   (optional, default 60)
 *
 * When R2 isn't configured this returns 503 with a clear message so
 * the client can show "vault not configured" rather than failing
 * silently · see project_audio_vault_storage.md.
 */

import { NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { readSession, readSessionCookie } from '@/lib/sessions';
import { and, eq, isNull } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ entryId: string }> }) {
  const session = await readSession(readSessionCookie(_req.headers));
  if (!session) {
    return NextResponse.json({ ok: false, message: 'You must be signed in.' }, { status: 401 });
  }

  const { entryId } = await params;
  if (!entryId) {
    return NextResponse.json({ ok: false, message: 'Missing entry id.' }, { status: 400 });
  }

  // Verify the entry belongs to this user · no cross-user access.
  const rows = await db
    .select({
      id: schema.journalEntries.id,
      userId: schema.journalEntries.userId,
      audioUrl: schema.journalEntries.audioUrl,
      unsealsAt: schema.journalEntries.unsealsAt,
    })
    .from(schema.journalEntries)
    .where(and(eq(schema.journalEntries.id, entryId), isNull(schema.journalEntries.deletedAt)))
    .limit(1);

  if (rows.length === 0 || rows[0].userId !== session.userId) {
    return NextResponse.json({ ok: false, message: 'Entry not found.' }, { status: 404 });
  }
  if ((rows[0].unsealsAt ?? new Date(0)) > new Date()) {
    return NextResponse.json({ ok: false, message: 'This entry is still sealed.' }, { status: 403 });
  }
  if (!rows[0].audioUrl) {
    return NextResponse.json({ ok: false, message: 'This entry has no audio (typed entry).' }, { status: 404 });
  }

  // Check R2 is configured. Until the bucket + credentials are set up
  // on the server, return 503 with a clear hint so the operator knows
  // exactly what to do.
  const endpoint = process.env.R2_ENDPOINT;
  const accessKey = process.env.R2_ACCESS_KEY_ID;
  const secret = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  if (!endpoint || !accessKey || !secret || !bucket) {
    return NextResponse.json(
      {
        ok: false,
        message: 'Vault audio is not yet configured · R2 bucket + credentials need to be set in /etc/counsel-day-app/env.local · see /docs/audio-vault-setup.md',
      },
      { status: 503 },
    );
  }

  // Sign a GetObject URL. Uses @aws-sdk/client-s3 + @aws-sdk/s3-request-presigner
  // which support R2 because R2 is S3-compatible. Lazy-imported so this
  // route doesn't pull the SDK on cold start when audio isn't requested.
  const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');

  const client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId: accessKey, secretAccessKey: secret },
  });
  const expiresIn = (parseInt(process.env.R2_SIGNED_URL_MINS ?? '60', 10) || 60) * 60;
  try {
    const command = new GetObjectCommand({ Bucket: bucket, Key: rows[0].audioUrl });
    const url = await getSignedUrl(client, command, { expiresIn });
    return NextResponse.json({ ok: true, url, expires_in_seconds: expiresIn });
  } catch (err) {
    console.error('[journal/vault/playback] R2 sign failed', err);
    return NextResponse.json(
      { ok: false, message: 'Could not generate playback URL · check the R2 credentials + bucket name.' },
      { status: 500 },
    );
  }
}
