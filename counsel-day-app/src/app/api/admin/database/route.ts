/**
 * GET /api/admin/database
 *
 * Postgres health, size, table stats, schema view. Useful for
 * triaging "why is the box slow" without SSH-ing to the prod
 * postgres console.
 *
 * Returns:
 *   · version          · PostgreSQL version string
 *   · database_size    · bytes
 *   · connections      · { current, max }
 *   · tables           · per-table rowcount + total size in bytes
 *   · indexes          · top indexes by size
 *   · slow_queries     · last 10 statements from pg_stat_statements
 *                        (returns [] if the extension isn't enabled)
 *   · schema           · per-table column list, FKs, types
 *
 * Admin gate via requireAdmin().
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';
import { requireAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    try { return await fn(); } catch (e) { console.warn('[admin/database] subquery failed:', e); return fallback; }
  }

  const version = await safe(async () => {
    const rows = await db.execute<{ version: string }>(sql`SELECT version()::text AS version`);
    return (rows[0] as { version: string }).version;
  }, 'unknown');

  const databaseSize = await safe(async () => {
    const rows = await db.execute<{ bytes: string }>(sql`SELECT pg_database_size(current_database())::text AS bytes`);
    return Number((rows[0] as { bytes: string }).bytes);
  }, 0);

  const connections = await safe(async () => {
    const rows = await db.execute<{ current: string; max: string }>(sql`
      SELECT
        (SELECT count(*)::text FROM pg_stat_activity WHERE datname = current_database()) AS current,
        (SELECT setting FROM pg_settings WHERE name = 'max_connections') AS max
    `);
    const r = rows[0] as { current: string; max: string };
    return { current: Number(r.current), max: Number(r.max) };
  }, { current: 0, max: 0 });

  type TableStat = { schema: string; name: string; rowcount: number; size_bytes: number };
  const tables = await safe(async () => {
    const rows = await db.execute<{ schema: string; name: string; rowcount: string; size_bytes: string }>(sql`
      SELECT schemaname AS schema,
             relname AS name,
             n_live_tup::text AS rowcount,
             pg_total_relation_size(relid)::text AS size_bytes
      FROM pg_stat_user_tables
      ORDER BY pg_total_relation_size(relid) DESC
    `);
    return Array.from(rows).map((r) => ({
      schema: r.schema,
      name: r.name,
      rowcount: Number(r.rowcount),
      size_bytes: Number(r.size_bytes),
    })) as TableStat[];
  }, [] as TableStat[]);

  type IndexStat = { name: string; table: string; size_bytes: number };
  const indexes = await safe(async () => {
    const rows = await db.execute<{ index_name: string; table_name: string; size_bytes: string }>(sql`
      SELECT indexrelname AS index_name,
             relname AS table_name,
             pg_relation_size(indexrelid)::text AS size_bytes
      FROM pg_stat_user_indexes
      ORDER BY pg_relation_size(indexrelid) DESC
      LIMIT 20
    `);
    return Array.from(rows).map((r) => ({
      name: r.index_name,
      table: r.table_name,
      size_bytes: Number(r.size_bytes),
    })) as IndexStat[];
  }, [] as IndexStat[]);

  type SchemaCol = { table: string; column: string; type: string; nullable: boolean };
  const schemaCols = await safe(async () => {
    const rows = await db.execute<{ table_name: string; column_name: string; data_type: string; is_nullable: string }>(sql`
      SELECT table_name, column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position
    `);
    return Array.from(rows).map((r) => ({
      table: r.table_name,
      column: r.column_name,
      type: r.data_type,
      nullable: r.is_nullable === 'YES',
    })) as SchemaCol[];
  }, [] as SchemaCol[]);

  type SlowQuery = { query: string; calls: number; mean_ms: number; total_ms: number };
  const slowQueries = await safe(async () => {
    const rows = await db.execute<{ query: string; calls: string; mean: string; total: string }>(sql`
      SELECT substring(query, 1, 240) AS query, calls::text AS calls,
             mean_exec_time::text AS mean,
             total_exec_time::text AS total
      FROM pg_stat_statements
      ORDER BY mean_exec_time DESC
      LIMIT 10
    `);
    return Array.from(rows).map((r) => ({
      query: r.query,
      calls: Number(r.calls),
      mean_ms: +Number(r.mean).toFixed(2),
      total_ms: +Number(r.total).toFixed(2),
    })) as SlowQuery[];
  }, [] as SlowQuery[]);

  return NextResponse.json(
    { ok: true, generated_at: new Date().toISOString(), version, database_size_bytes: databaseSize, connections, tables, indexes, schema_columns: schemaCols, slow_queries: slowQueries },
    { headers: { 'cache-control': 'private, no-store' } }
  );
}
