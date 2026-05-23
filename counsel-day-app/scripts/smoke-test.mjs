#!/usr/bin/env node
// Counsel.day · smoke test
//
// Hits every public surface against a target host (default: production)
// and asserts the response shape is sane. Catches the dumb-broken stuff
// before users do: 500s on a route that should 400, missing endpoints,
// admin endpoints accidentally exposed, expired SSL, etc.
//
// Usage:
//   node scripts/smoke-test.mjs                 # checks production
//   BASE=https://counsel.day node scripts/smoke-test.mjs
//   BASE=http://localhost:3000 node scripts/smoke-test.mjs  # local dev
//
// Exit code: 0 = all green, 1 = at least one failure.

const BASE = process.env.BASE ?? 'https://counsel.day';
const TIMEOUT_MS = 10_000;

let pass = 0;
let fail = 0;
const failures = [];

function color(s, c) {
  const codes = { red: 31, green: 32, yellow: 33, dim: 2 };
  return process.stdout.isTTY ? `\x1b[${codes[c]}m${s}\x1b[0m` : s;
}

async function check(label, fn) {
  process.stdout.write(`  ${label} ... `);
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const result = await fn(ctrl.signal);
    clearTimeout(timer);
    if (result?.ok === false) {
      fail++;
      failures.push({ label, reason: result.reason });
      console.log(color(`FAIL · ${result.reason}`, 'red'));
    } else {
      pass++;
      console.log(color(result?.note ?? 'ok', 'green'));
    }
  } catch (err) {
    fail++;
    failures.push({ label, reason: err.message });
    console.log(color(`ERROR · ${err.message}`, 'red'));
  }
}

async function expectStatus(path, ...allowed) {
  return async (signal) => {
    const r = await fetch(`${BASE}${path}`, { redirect: 'manual', signal });
    if (allowed.includes(r.status)) return { note: `${r.status}` };
    return { ok: false, reason: `expected ${allowed.join('/')}, got ${r.status}` };
  };
}

async function expectJsonField(path, key, value) {
  return async (signal) => {
    const r = await fetch(`${BASE}${path}`, { signal });
    if (!r.ok) return { ok: false, reason: `HTTP ${r.status}` };
    const j = await r.json();
    if (j[key] === value) return { note: `${key}=${value}` };
    return { ok: false, reason: `${key}=${j[key]} (expected ${value})` };
  };
}

async function expectHeader(path, header, predicate, description) {
  return async (signal) => {
    const r = await fetch(`${BASE}${path}`, { signal });
    const v = r.headers.get(header);
    if (predicate(v)) return { note: `${header}: ${v}` };
    return { ok: false, reason: `${description} (got ${header}=${v})` };
  };
}

async function expectBodyContains(path, needle) {
  return async (signal) => {
    const r = await fetch(`${BASE}${path}`, { signal });
    const body = await r.text();
    if (body.includes(needle)) return { note: `contains "${needle.slice(0, 40)}"` };
    return { ok: false, reason: `body missing "${needle.slice(0, 40)}"` };
  };
}

async function postExpect(path, body, ...allowed) {
  return async (signal) => {
    const r = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
      redirect: 'manual',
    });
    if (allowed.includes(r.status)) return { note: `${r.status}` };
    return { ok: false, reason: `expected ${allowed.join('/')}, got ${r.status}` };
  };
}

console.log(color(`\nCounsel.day smoke test · ${BASE}\n`, 'dim'));

console.log('Health + infrastructure');
await check('GET /api/health → ok:true', await expectJsonField('/api/health', 'ok', true));
await check('GET / → 200',                await expectStatus('/', 200));
await check('GET /robots.txt → 200',      await expectStatus('/robots.txt', 200));
await check('GET /sitemap.xml → 200',     await expectStatus('/sitemap.xml', 200));
await check('GET /.well-known/security.txt → 200', await expectStatus('/.well-known/security.txt', 200));

console.log('\nPublic marketing pages');
const marketing = ['/index.html', '/pricing.html', '/method.html', '/verdict.html', '/family.html', '/contact.html', '/security.html', '/privacy.html', '/terms.html', '/changelog.html', '/help.html', '/faq.html'];
for (const p of marketing) {
  await check(`GET ${p}`, await expectStatus(p, 200));
}

console.log('\nAd landing pages (offer variants)');
const offers = ['/offer.html', '/offer-a.html', '/offer-b.html', '/offer-c.html', '/offer-d.html', '/offer-e.html', '/offer-f.html', '/offer-g.html', '/offer-e2.html', '/offer-e-facebook.html', '/offer-e-instagram.html', '/offer-e-google.html', '/offer-e-tiktok.html'];
for (const p of offers) {
  await check(`GET ${p}`, await expectStatus(p, 200));
}

console.log('\nAuth-gated pages redirect when anonymous');
await check('GET /account.html → 200 or redirect', await expectStatus('/account.html', 200, 302, 307));
await check('GET /decisions.html → 200 or redirect', await expectStatus('/decisions.html', 200, 302, 307));

console.log('\nAdmin gate · anonymous must be blocked');
await check('GET /admin.html → 302/401/403', await expectStatus('/admin.html', 302, 401, 403));
await check('GET /api/admin/overview → 401/403', await expectStatus('/api/admin/overview', 401, 403));
await check('GET /api/admin/users → 401/403', await expectStatus('/api/admin/users', 401, 403));
await check('GET /api/admin/security-audit → 401/403', await expectStatus('/api/admin/security-audit', 401, 403));

console.log('\nAPI input validation · empty bodies must 4xx (not 500)');
await check('POST /api/signin {} → 422', await postExpect('/api/signin', {}, 400, 422));
await check('POST /api/signup {} → 422', await postExpect('/api/signup', {}, 400, 422));
await check('POST /api/contact {} → 422', await postExpect('/api/contact', {}, 400, 422));

console.log('\nSecurity headers');
await check('CSP present on /',     await expectHeader('/', 'content-security-policy', (v) => v?.includes('default-src'), 'CSP header missing or malformed'));
await check('X-Frame-Options on /', await expectHeader('/', 'x-frame-options', (v) => v === 'DENY' || v === 'SAMEORIGIN', 'X-Frame-Options not DENY/SAMEORIGIN'));
await check('HSTS on /',            await expectHeader('/', 'strict-transport-security', (v) => v?.includes('max-age'), 'HSTS missing'));

console.log('\nBrand markers present (Iteration 8 · white + wine)');
await check('Wine accent on index',    await expectBodyContains('/index.html', '#722F37'));
await check('GA4 script on index',     await expectBodyContains('/index.html', 'ga4.js'));
await check('Newsreader font loaded',  await expectBodyContains('/index.html', 'Newsreader'));
await check('No retired records-strip on index', async (signal) => {
  const r = await fetch(`${BASE}/index.html`, { signal });
  const body = await r.text();
  if (!body.includes('records-strip')) return { note: 'absent' };
  return { ok: false, reason: 'retired Iteration 7 chrome still present' };
});

console.log('\n' + color('—'.repeat(60), 'dim'));
console.log(`Result: ${color(pass + ' pass', 'green')}, ${fail ? color(fail + ' fail', 'red') : color('0 fail', 'green')}`);

if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  · ${f.label}: ${color(f.reason, 'red')}`);
  process.exit(1);
}
process.exit(0);
