/**
 * Forward-only migration runner. Reads db/migrations/*.sql in lexical
 * order, applies any not yet recorded in the _migrations table, and
 * records each one. Idempotent: re-running is a no-op.
 *
 * Run with: npm run db:migrate
 */

import 'dotenv/config';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('DATABASE_URL not set. Aborting.');
  process.exit(1);
}

const migrationsDir = join(process.cwd(), 'db', 'migrations');
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

if (files.length === 0) {
  console.log('No migration files found in db/migrations/.');
  process.exit(0);
}

const sql = postgres(dbUrl, { max: 1 });

async function main() {
  // Bootstrap the tracking table (idempotent).
  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  const applied = await sql<{ id: number }[]>`SELECT id FROM _migrations`;
  const appliedIds = new Set(applied.map((r) => r.id));

  for (const f of files) {
    // Filename format: NNNN_name.sql, e.g. 0001_init.sql
    const idMatch = f.match(/^(\d+)_/);
    if (!idMatch) {
      console.warn(`Skipping ${f}: filename must be NNNN_name.sql`);
      continue;
    }
    const id = parseInt(idMatch[1], 10);
    const name = f.replace(/\.sql$/, '');

    if (appliedIds.has(id)) {
      console.log(`  skip ${name} (already applied)`);
      continue;
    }

    console.log(`  apply ${name}`);
    const body = readFileSync(join(migrationsDir, f), 'utf8');
    try {
      await sql.unsafe(body); // raw SQL · the file is checked into git
      await sql`INSERT INTO _migrations (id, name) VALUES (${id}, ${name})
                ON CONFLICT (id) DO NOTHING`;
    } catch (err) {
      console.error(`  FAILED ${name}:`, err);
      process.exit(1);
    }
  }

  console.log('Migrations complete.');
  await sql.end();
}

main().catch((err) => {
  console.error('Migrate runner crashed:', err);
  process.exit(1);
});
