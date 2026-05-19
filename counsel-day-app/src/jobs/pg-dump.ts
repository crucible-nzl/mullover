/**
 * In-process Postgres backup.
 *
 * Calls `pg_dump` against DATABASE_URL and writes a gzipped dump to
 * /home/deploy/backups/counsel-day-YYYY-MM-DDTHH-mm-ssZ.sql.gz.
 *
 * Runs as the deploy user. The previous implementation shelled to
 * `sudo systemctl start counsel-day-backup.service` but the app
 * systemd unit has NoNewPrivileges=true and the spawn fails. This
 * in-process version writes to a deploy-owned path, no sudo needed.
 *
 * The directory /home/deploy/backups must exist and be deploy-writable
 * (one-time mkdir on the box). The script auto-creates it on first
 * run if missing.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, existsSync, createWriteStream } from 'node:fs';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';

const OUT_DIR = process.env.PG_BACKUP_DIR || '/home/deploy/backups';
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('[pg-dump] DATABASE_URL not set in environment · aborting');
  process.exit(2);
}

if (!existsSync(OUT_DIR)) {
  try {
    mkdirSync(OUT_DIR, { recursive: true });
  } catch (err) {
    console.error(`[pg-dump] could not create ${OUT_DIR}:`, err);
    process.exit(3);
  }
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, 'Z');
const outPath = join(OUT_DIR, `counsel-day-${stamp}.sql.gz`);

async function main() {
  const start = Date.now();
  // pg_dump reads DATABASE_URL via the connection string positional arg.
  // --no-owner avoids GRANT/REVOKE lines that fail on restore to a fresh box.
  const proc = spawn('pg_dump', ['--no-owner', '--no-acl', DATABASE_URL!], { stdio: ['ignore', 'pipe', 'pipe'] });

  let stderr = '';
  proc.stderr.on('data', (d) => { stderr += d.toString(); });

  const out = createWriteStream(outPath);
  const gz = createGzip({ level: 9 });

  await pipeline(proc.stdout, gz, out).catch((err) => {
    console.error('[pg-dump] pipeline failed:', err);
    process.exit(4);
  });

  await new Promise<void>((resolve, reject) => {
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pg_dump exited ${code} · stderr: ${stderr.slice(0, 500)}`));
    });
    proc.on('error', reject);
  });

  const ms = Date.now() - start;
  console.log(`[pg-dump] wrote ${outPath} in ${ms}ms`);
}

main().catch((err) => {
  console.error('[pg-dump] failed:', err);
  process.exit(1);
});
