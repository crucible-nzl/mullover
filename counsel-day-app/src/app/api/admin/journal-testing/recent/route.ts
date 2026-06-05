/**
 * GET /api/admin/journal-testing/recent
 *
 * Returns the last 25 Journal test runs · for the "Recent runs" table
 * on /admin-journal-testing.html. Admin-only; no PII beyond fixture
 * content (which is operator-supplied, not user data).
 */

import { NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { requireAdmin } from '@/lib/admin-auth';
import { desc } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const rows = await db
    .select({
      id: schema.journalVerdictTestRuns.id,
      kind: schema.journalVerdictTestRuns.kind,
      fixtureLabel: schema.journalVerdictTestRuns.fixtureLabel,
      aiModel: schema.journalVerdictTestRuns.aiModel,
      positivesJson: schema.journalVerdictTestRuns.positivesJson,
      strainsJson: schema.journalVerdictTestRuns.strainsJson,
      throughline: schema.journalVerdictTestRuns.throughline,
      questionForNext: schema.journalVerdictTestRuns.questionForNext,
      tokensInput: schema.journalVerdictTestRuns.tokensInput,
      tokensOutput: schema.journalVerdictTestRuns.tokensOutput,
      costCents: schema.journalVerdictTestRuns.costCents,
      anthropicCallCount: schema.journalVerdictTestRuns.anthropicCallCount,
      createdAt: schema.journalVerdictTestRuns.createdAt,
    })
    .from(schema.journalVerdictTestRuns)
    .orderBy(desc(schema.journalVerdictTestRuns.createdAt))
    .limit(25);

  return NextResponse.json(
    { ok: true, runs: rows },
    { status: 200, headers: { 'cache-control': 'private, no-store' } },
  );
}
