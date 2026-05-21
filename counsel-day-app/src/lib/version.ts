/**
 * Reads the deployed git short-sha from /opt/counsel-day-app/.git-rev,
 * which deploy.sh writes before each build. Read once at module load
 * so /api/health is cheap.
 *
 * Falls back to CD_GIT_REV env (in case env.local has it set manually),
 * then to npm_package_version, then to 'unknown'.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readFromFile(): string | null {
  // Match the path deploy.sh writes (/opt/counsel-day-app/.git-rev),
  // but stay relative to the package root so local dev also works
  // when a developer manually creates a .git-rev file.
  const candidates = [
    join(process.cwd(), '.git-rev'),
    '/opt/counsel-day-app/.git-rev',
  ];
  for (const p of candidates) {
    try {
      const raw = readFileSync(p, 'utf8').trim();
      if (raw) return raw;
    } catch {
      // file missing or unreadable · try the next candidate
    }
  }
  return null;
}

const fromFile = readFromFile();
export const APP_VERSION: string =
  fromFile ?? process.env.CD_GIT_REV ?? process.env.npm_package_version ?? 'unknown';
