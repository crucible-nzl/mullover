#!/usr/bin/env node
// Counsel.day · static performance audit
//
// Cheap pre-Lighthouse pass that catches the common perf wins by
// inspecting the HTML + headers of every public page. Does not need
// Chromium installed (Lighthouse does, and we want this runnable in CI).
//
// Catches:
//   · HTML payload > 100 KB (render-blocking weight)
//   · Render-blocking external CSS / JS in <head> without media or async/defer
//   · <img> without width + height (Cumulative Layout Shift)
//   · png/jpg referenced where modern formats would win
//   · Missing preconnect/preload for known third parties
//   · Missing or short Cache-Control on static assets
//
// Usage:
//   node scripts/perf-audit.mjs                     # check production
//   BASE=http://localhost:8080 node scripts/perf-audit.mjs

const BASE = process.env.BASE ?? 'https://counsel.day';

const PUBLIC_PAGES = [
  '/index.html', '/pricing.html', '/method.html', '/verdict.html',
  '/family.html', '/contact.html', '/security.html', '/privacy.html',
  '/terms.html', '/changelog.html', '/help.html', '/faq.html',
  '/offer.html', '/offer-a.html', '/offer-b.html', '/offer-c.html',
  '/offer-d.html', '/offer-e.html', '/offer-f.html', '/offer-g.html',
  '/offer-e2.html', '/offer-e-facebook.html', '/offer-e-instagram.html',
  '/offer-e-google.html', '/offer-e-tiktok.html',
];

const STATIC_ASSETS = ['/styles.css', '/ga4.js', '/favicon.ico'];

function color(s, c) {
  const codes = { red: 31, green: 32, yellow: 33, dim: 2, bold: 1 };
  return process.stdout.isTTY ? `\x1b[${codes[c]}m${s}\x1b[0m` : s;
}

const findings = [];
function add(severity, page, message) {
  findings.push({ severity, page, message });
}

async function auditPage(path) {
  const url = `${BASE}${path}`;
  let resp;
  try {
    resp = await fetch(url);
  } catch (e) {
    add('error', path, `fetch failed: ${e.message}`);
    return;
  }
  if (!resp.ok) {
    add('error', path, `HTTP ${resp.status}`);
    return;
  }

  const body = await resp.text();
  const sizeKB = Math.round(Buffer.byteLength(body, 'utf8') / 1024);

  // HTML weight
  if (sizeKB > 200) add('high', path, `HTML payload ${sizeKB} KB · target < 200 KB`);
  else if (sizeKB > 100) add('medium', path, `HTML payload ${sizeKB} KB · target < 100 KB`);

  // Render-blocking in <head>
  const headMatch = body.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  if (headMatch) {
    const head = headMatch[1];
    const headScripts = [...head.matchAll(/<script(?![^>]*\b(?:async|defer|type=["']module["'])[^>]*)[^>]*src=["']([^"']+)["'][^>]*>/gi)];
    for (const m of headScripts) {
      add('high', path, `render-blocking <script src="${m[1]}"> in <head> · add defer/async`);
    }
  }

  // Images without width/height
  const imgs = [...body.matchAll(/<img\s+([^>]+)>/gi)];
  let imgIssues = 0;
  for (const m of imgs) {
    const attrs = m[1];
    if (!/\bwidth=/.test(attrs) || !/\bheight=/.test(attrs)) imgIssues++;
  }
  if (imgIssues > 0) {
    add('medium', path, `${imgIssues} <img> tag(s) without explicit width+height (CLS risk)`);
  }

  // Legacy image formats
  const legacyImgs = [...body.matchAll(/<img[^>]+src=["']([^"']+\.(?:png|jpg|jpeg))["']/gi)];
  if (legacyImgs.length > 2) {
    add('low', path, `${legacyImgs.length} <img> using png/jpg · convert hero/og images to webp+avif`);
  }

  // Inline <script> in <head> blocking parser
  if (headMatch) {
    const inlineScripts = [...headMatch[1].matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi)];
    let inlineSize = 0;
    for (const m of inlineScripts) inlineSize += m[1].length;
    if (inlineSize > 4096) add('medium', path, `${Math.round(inlineSize / 1024)} KB inline JS in <head> · move below the fold`);
  }

  // Preconnect to known third parties
  const hasGAPreconnect = /<link[^>]+rel=["']preconnect["'][^>]+(?:googletagmanager|google-analytics)/.test(body);
  const usesGA = body.includes('googletagmanager') || body.includes('google-analytics') || body.includes('ga4.js');
  if (usesGA && !hasGAPreconnect) {
    add('low', path, 'GA used without <link rel="preconnect"> to googletagmanager · saves ~100ms');
  }

  // Long inline CSS
  const styleBlocks = [...body.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)];
  let styleSize = 0;
  for (const m of styleBlocks) styleSize += m[1].length;
  if (styleSize > 20480) add('low', path, `${Math.round(styleSize / 1024)} KB inline CSS · consider extracting`);

  return { sizeKB };
}

async function auditAsset(path) {
  const url = `${BASE}${path}`;
  let resp;
  try {
    resp = await fetch(url);
  } catch (e) {
    add('error', path, `fetch failed: ${e.message}`);
    return;
  }
  const cache = resp.headers.get('cache-control') ?? '';
  if (!cache) {
    add('medium', path, 'no Cache-Control header');
  } else {
    const maxAge = /max-age=(\d+)/.exec(cache);
    const age = maxAge ? parseInt(maxAge[1], 10) : 0;
    if (age < 600) add('medium', path, `Cache-Control max-age=${age}s · static assets should be ≥ 3600`);
  }
}

console.log(color(`\nCounsel.day perf audit · ${BASE}\n`, 'dim'));

const sizes = [];
for (const p of PUBLIC_PAGES) {
  const r = await auditPage(p);
  if (r?.sizeKB) sizes.push({ path: p, sizeKB: r.sizeKB });
}

for (const a of STATIC_ASSETS) {
  await auditAsset(a);
}

console.log('Largest HTML payloads');
sizes.sort((a, b) => b.sizeKB - a.sizeKB);
for (const s of sizes.slice(0, 5)) {
  const mark = s.sizeKB > 100 ? color('LARGE', 'yellow') : color('ok', 'green');
  console.log(`  ${mark.padStart(6)}  ${s.sizeKB} KB  ${s.path}`);
}

console.log('\nFindings by severity');
const order = ['error', 'high', 'medium', 'low'];
const labels = { error: 'ERROR', high: 'HIGH ', medium: 'MED  ', low: 'LOW  ' };
const colors = { error: 'red', high: 'red', medium: 'yellow', low: 'dim' };
findings.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
let hadAny = false;
for (const f of findings) {
  hadAny = true;
  console.log(`  ${color(labels[f.severity], colors[f.severity])}  ${f.page.padEnd(36)}  ${f.message}`);
}
if (!hadAny) console.log('  ' + color('(no perf issues found)', 'green'));

console.log('\n' + color('—'.repeat(60), 'dim'));
console.log('Counts:', color(`${findings.filter(f => f.severity === 'error').length} error`, 'red'),
  color(`${findings.filter(f => f.severity === 'high').length} high`, 'red'),
  color(`${findings.filter(f => f.severity === 'medium').length} medium`, 'yellow'),
  color(`${findings.filter(f => f.severity === 'low').length} low`, 'dim'));
console.log('\nNext step: open Chrome DevTools → Lighthouse → Mobile → Performance');
console.log('for the top three pages above. This script catches static issues;');
console.log('Lighthouse catches runtime (LCP, INP, FCP) on the rendered page.');

process.exit(findings.filter(f => f.severity === 'error' || f.severity === 'high').length > 0 ? 1 : 0);
