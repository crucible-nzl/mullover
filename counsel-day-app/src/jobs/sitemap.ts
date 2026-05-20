/**
 * In-process sitemap generator.
 *
 * Walks /var/www/counsel.day/ for indexable *.html files, emits an
 * https://counsel.day/<path> entry per file with lastmod=mtime, and
 * writes the result to /var/www/counsel.day/sitemap.xml.
 *
 * Runs as the deploy user. /var/www/counsel.day is deploy-owned, so
 * no privilege escalation is needed · this replaces the old systemd
 * counsel-day-sitemap.service that required sudo (which the running
 * app process cannot grant under NoNewPrivileges).
 *
 * Excludes:
 *   · admin*.html, admin-*.html                  · private surfaces
 *   · og-image-generator.html, homepage.html       · internal
 *   · 404.html, 500.html, maintenance.html, offline.html, signed-out.html, session-expired.html
 *   · invite.html, signup.html, signin.html, *-password.html, verify-email.html, start.html
 *     · these are entered via specific tokens; no canonical sitemap URL
 *
 * The sitemap is regenerated whenever an admin clicks "Run now" or
 * (in future) when the static deploy fires a hook.
 */

import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, posix } from 'node:path';

const ROOT = process.env.STATIC_ROOT || '/var/www/counsel.day';
const BASE_URL = (process.env.APP_BASE_URL || 'https://counsel.day').replace(/\/$/, '');

const EXCLUDED_FILES = new Set([
  'admin.html', 'og-image-generator.html', 'homepage.html',
  '404.html', '500.html', 'maintenance.html', 'offline.html',
  'signed-out.html', 'session-expired.html',
  'invite.html', 'signup.html', 'signin.html',
  'reset-password.html', 'forgot-password.html', 'verify-email.html',
  'start.html', 'components.html',
]);
const EXCLUDED_PREFIXES = ['admin-']; // admin-growth.html, admin-users.html, etc.
const EXCLUDED_DIRS = new Set(['fonts', 'engineering', 'scripts', 'ops', 'about']);

function walk(dir: string, rel: string = ''): Array<{ url: string; mtime: Date }> {
  const out: Array<{ url: string; mtime: Date }> = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name.startsWith('.')) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (EXCLUDED_DIRS.has(name)) continue;
      out.push(...walk(full, posix.join(rel, name)));
      continue;
    }
    if (!st.isFile()) continue;
    if (!name.endsWith('.html')) continue;
    if (EXCLUDED_FILES.has(name)) continue;
    if (EXCLUDED_PREFIXES.some((p) => name.startsWith(p))) continue;
    // Map index.html → /, page.html → /page
    const relPath = posix.join(rel, name);
    let urlPath = '/' + relPath;
    if (urlPath.endsWith('/index.html')) urlPath = urlPath.slice(0, -'index.html'.length);
    else if (urlPath.endsWith('.html')) urlPath = urlPath.slice(0, -'.html'.length);
    out.push({ url: BASE_URL + urlPath, mtime: st.mtime });
  }
  return out;
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function main() {
  const start = Date.now();
  const entries = walk(ROOT);
  entries.sort((a, b) => a.url.localeCompare(b.url));

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap-0.9">',
    ...entries.map((e) => [
      '  <url>',
      `    <loc>${escape(e.url)}</loc>`,
      `    <lastmod>${e.mtime.toISOString().slice(0, 10)}</lastmod>`,
      '  </url>',
    ].join('\n')),
    '</urlset>',
    '',
  ].join('\n');

  const outPath = join(ROOT, 'sitemap.xml');
  writeFileSync(outPath, xml, 'utf-8');
  const ms = Date.now() - start;
  console.log(`[sitemap] wrote ${entries.length} urls to ${outPath} in ${ms}ms`);
}

main();
