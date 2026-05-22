/**
 * Tokenised public share links for paid verdicts.
 *
 * POST   /api/verdict-report/share
 *        body: { decision_id, allow_partner_names?, allow_analysis?, expires_in_days? }
 *        returns: { ok, token, url, created_at, expires_at }
 * DELETE /api/verdict-report/share?token=<token>
 *        revokes the link · public fetches return 410 from this point
 *
 * Auth: signed in, must be a participant of the decision, decision
 * must be on a paid tier and unsealed. (Sharing the prose of a sealed
 * decision is meaningless · there isn't one yet.)
 *
 * The token returned here is the only secret · the public route at
 * /api/verdict-share/[token] checks it directly. Tokens are 32 chars
 * of base64url (~190 bits of entropy) which is enough that brute
 * force isn't a concern, even without rate limiting.
 */

import { NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { readSession, readSessionCookie } from '@/lib/sessions';
import { and, eq, sql } from 'drizzle-orm';
import { newToken } from '@/lib/tokens';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PAID_TIERS = new Set(['solo_paid', 'couple', 'family']);
const BASE = process.env.APP_BASE_URL ?? 'https://counsel.day';

async function gateOwner(req: Request, decisionId: string): Promise<
  | { ok: true; userId: string }
  | { ok: false; status: number; message: string }
> {
  const session = await readSession(readSessionCookie(req.headers));
  if (!session) return { ok: false, status: 401, message: 'You must be signed in.' };
  if (!/^[0-9a-f-]{36}$/i.test(decisionId)) {
    return { ok: false, status: 400, message: 'Invalid decision id.' };
  }

  const partRows = await db
    .select({ id: schema.participants.id })
    .from(schema.participants)
    .where(and(eq(schema.participants.decisionId, decisionId), eq(schema.participants.userId, session.userId)))
    .limit(1);
  if (partRows.length === 0) return { ok: false, status: 403, message: 'Not found.' };

  const decisionRows = await db
    .select({ tier: schema.decisions.tier, unsealsAt: schema.decisions.unsealsAt })
    .from(schema.decisions)
    .where(eq(schema.decisions.id, decisionId))
    .limit(1);
  if (decisionRows.length === 0) return { ok: false, status: 404, message: 'Decision not found.' };
  const d = decisionRows[0];

  if (!PAID_TIERS.has(d.tier)) {
    return { ok: false, status: 402, message: 'Share links are a paid-tier feature.' };
  }
  if (!d.unsealsAt || d.unsealsAt.getTime() > Date.now()) {
    return { ok: false, status: 409, message: 'The decision must be unsealed before you can share its verdict.' };
  }
  return { ok: true, userId: session.userId };
}

export async function POST(req: Request) {
  let body: {
    decision_id?: string;
    allow_partner_names?: unknown;
    allow_analysis?: unknown;
    expires_in_days?: unknown;
  } = {};
  try { body = await req.json(); } catch { /* keep empty · validation below */ }
  const decisionId = String(body.decision_id ?? '');

  const gate = await gateOwner(req, decisionId);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
  }

  const allowPartnerNames = body.allow_partner_names !== false; // default true
  const allowAnalysis = body.allow_analysis === true;             // default false
  // Optional expiry · null means never expires. Capped at 365 to
  // avoid pathologically long-lived links.
  let expiresAt: Date | null = null;
  const expiresInDays = Number(body.expires_in_days);
  if (Number.isFinite(expiresInDays) && expiresInDays > 0) {
    const days = Math.min(365, Math.floor(expiresInDays));
    expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  const token = newToken();
  const [inserted] = await db.insert(schema.verdictShares).values({
    decisionId,
    ownerUserId: gate.userId,
    token,
    allowPartnerNames,
    allowAnalysis,
    expiresAt: expiresAt ?? undefined,
  }).returning({
    token: schema.verdictShares.token,
    createdAt: schema.verdictShares.createdAt,
    expiresAt: schema.verdictShares.expiresAt,
  });

  await db.insert(schema.auditLog).values({
    actorUserId: gate.userId,
    action: 'verdict.share.created',
    targetType: 'decision',
    targetId: decisionId,
    metadata: { allow_partner_names: allowPartnerNames, allow_analysis: allowAnalysis, expires_at: inserted?.expiresAt ?? null },
  }).catch(() => {});

  return NextResponse.json(
    {
      ok: true,
      token: inserted.token,
      url: `${BASE}/share.html?token=${encodeURIComponent(inserted.token)}`,
      created_at: inserted.createdAt,
      expires_at: inserted.expiresAt,
    },
    { status: 200, headers: { 'cache-control': 'private, no-store' } }
  );
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const token = String(url.searchParams.get('token') ?? '');
  if (!token || token.length < 16) {
    return NextResponse.json({ ok: false, message: 'Missing token.' }, { status: 400 });
  }

  const session = await readSession(readSessionCookie(req.headers));
  if (!session) {
    return NextResponse.json({ ok: false, message: 'You must be signed in.' }, { status: 401 });
  }

  // Only the owner can revoke. Revoke = set revoked_at; we keep the row
  // for audit so the operator can see how many were ever issued.
  const result = await db.execute(sql`
    UPDATE verdict_shares
    SET revoked_at = NOW()
    WHERE token = ${token}
      AND owner_user_id = ${session.userId}
      AND revoked_at IS NULL
    RETURNING id, decision_id
  `);
  const rows = Array.from(result) as Array<{ id: number; decision_id: string }>;
  if (rows.length === 0) {
    return NextResponse.json({ ok: false, message: 'No active share found for that token.' }, { status: 404 });
  }

  await db.insert(schema.auditLog).values({
    actorUserId: session.userId,
    action: 'verdict.share.revoked',
    targetType: 'decision',
    targetId: rows[0].decision_id,
  }).catch(() => {});

  return NextResponse.json({ ok: true, revoked: true }, { status: 200, headers: { 'cache-control': 'private, no-store' } });
}

export async function GET(req: Request) {
  // Owner lists active share links for a given decision.
  const url = new URL(req.url);
  const decisionId = String(url.searchParams.get('decision_id') ?? '');
  const gate = await gateOwner(req, decisionId);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
  }

  const rows = await db
    .select({
      token: schema.verdictShares.token,
      createdAt: schema.verdictShares.createdAt,
      revokedAt: schema.verdictShares.revokedAt,
      expiresAt: schema.verdictShares.expiresAt,
      viewCount: schema.verdictShares.viewCount,
      lastViewedAt: schema.verdictShares.lastViewedAt,
      allowPartnerNames: schema.verdictShares.allowPartnerNames,
      allowAnalysis: schema.verdictShares.allowAnalysis,
    })
    .from(schema.verdictShares)
    .where(and(eq(schema.verdictShares.decisionId, decisionId), eq(schema.verdictShares.ownerUserId, gate.userId)));

  return NextResponse.json(
    { ok: true, shares: rows.map((r) => ({ ...r, url: `${BASE}/share.html?token=${encodeURIComponent(r.token)}` })) },
    { status: 200, headers: { 'cache-control': 'private, no-store' } }
  );
}
