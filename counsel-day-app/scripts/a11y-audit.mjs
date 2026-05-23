#!/usr/bin/env node
// Counsel.day · accessibility static audit
//
// Static-HTML accessibility scan. Catches what can be checked without
// rendering: missing alt, label-less inputs, buttons without accessible
// text, low-contrast color tokens, missing lang, missing skip link.
//
// Does NOT replace axe-core or a screen-reader walk · those need a
// browser. This is the cheap pre-walk pass that catches obvious gaps
// so the manual audit can focus on interaction quality.
//
// Usage:
//   node scripts/a11y-audit.mjs            # check production
//   BASE=http://localhost:8080 node scripts/a11y-audit.mjs

const BASE = process.env.BASE ?? 'https://counsel.day';

const PUBLIC_PAGES = [
  '/index.html', '/pricing.html', '/method.html', '/verdict.html',
  '/family.html', '/contact.html', '/security.html', '/privacy.html',
  '/terms.html', '/changelog.html', '/help.html', '/faq.html',
  '/signin.html', '/signup.html', '/account.html', '/compose.html',
  '/offer.html', '/offer-a.html', '/offer-b.html', '/offer-c.html',
  '/offer-d.html', '/offer-e.html', '/offer-f.html', '/offer-g.html',
  '/offer-e2.html', '/offer-e-facebook.html', '/offer-e-instagram.html',
  '/offer-e-google.html', '/offer-e-tiktok.html',
];

function color(s, c) {
  const codes = { red: 31, green: 32, yellow: 33, dim: 2, bold: 1 };
  return process.stdout.isTTY ? `\x1b[${codes[c]}m${s}\x1b[0m` : s;
}

const findings = [];
function add(severity, page, message) {
  findings.push({ severity, page, message });
}

// ============================================================
// WCAG contrast math · standard relative-luminance formula
// ============================================================

function hexToRgb(hex) {
  const m = hex.replace('#', '').match(/^([0-9a-f]{6}|[0-9a-f]{3})$/i);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function relLuminance({ r, g, b }) {
  const f = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrastRatio(fg, bg) {
  const lf = relLuminance(hexToRgb(fg));
  const lb = relLuminance(hexToRgb(bg));
  const [L1, L2] = lf > lb ? [lf, lb] : [lb, lf];
  return (L1 + 0.05) / (L2 + 0.05);
}

// ============================================================
// Static brand-palette contrast check (runs once, not per page)
// ============================================================

console.log(color(`\nCounsel.day a11y audit · ${BASE}\n`, 'dim'));
console.log('Brand palette contrast vs. white background (#ffffff)');

const PALETTE = [
  { name: 'wine (accent)',       hex: '#722F37' },
  { name: 'wine-deep (hover)',   hex: '#561F26' },
  { name: 'ink (primary text)',  hex: '#0a0a0a' },
  { name: 'ink-soft',            hex: '#3a3530' },
  { name: 'muted',               hex: '#6b635a' },
  { name: 'subtle',              hex: '#9b9286' },
  { name: 'rose (Partner B)',    hex: '#c4806b' },
];

for (const c of PALETTE) {
  const r = contrastRatio(c.hex, '#ffffff');
  const passAA_body  = r >= 4.5;
  const passAA_large = r >= 3.0;
  const status = passAA_body
    ? color('AAA-body', 'green')
    : passAA_large
    ? color('large-text only', 'yellow')
    : color('FAIL', 'red');
  console.log(`  ${c.hex}  ${c.name.padEnd(22)}  ${r.toFixed(2)}:1  ${status}`);
  if (!passAA_body && !passAA_large) {
    add('high', '(palette)', `${c.name} ${c.hex} contrast ${r.toFixed(2)}:1 against white · below WCAG AA even for large text`);
  } else if (!passAA_body) {
    add('low', '(palette)', `${c.name} ${c.hex} only meets AA for large text · do not use in body copy`);
  }
}

// ============================================================
// Per-page static checks
// ============================================================

async function auditPage(path) {
  const url = `${BASE}${path}`;
  let body;
  try {
    const r = await fetch(url, { redirect: 'manual' });
    if (r.status === 302 || r.status === 401 || r.status === 403) {
      // Auth-gated · skip
      return;
    }
    if (!r.ok) {
      add('error', path, `HTTP ${r.status}`);
      return;
    }
    body = await r.text();
  } catch (e) {
    add('error', path, `fetch failed: ${e.message}`);
    return;
  }

  // <html lang="...">
  if (!/<html[^>]+\blang\s*=/i.test(body)) {
    add('high', path, '<html> missing lang attribute');
  }

  // <title>
  if (!/<title[^>]*>[^<]+<\/title>/i.test(body)) {
    add('high', path, '<title> missing or empty');
  }

  // meta viewport
  if (!/<meta[^>]+name=["']viewport["']/i.test(body)) {
    add('high', path, '<meta name="viewport"> missing · mobile zoom likely broken');
  }

  // skip-link as first focusable · only flag when there is enough
  // pre-main-content nav to make tabbing painful (>5 focusable items)
  const hasSkipLink = /href=["']#main["']|href=["']#content["']|class=["'][^"']*skip[-_]link/i.test(body);
  if (!hasSkipLink) {
    const mainAt = body.search(/<main\b/i);
    const navRegion = mainAt > 0 ? body.slice(0, mainAt) : body.slice(0, 4096);
    const navAnchors = (navRegion.match(/<a\b[^>]*\bhref=/gi) || []).length;
    if (navAnchors > 5) {
      add('medium', path, `no skip-link and ${navAnchors} nav anchors before <main> · keyboard users have to tab through all of them`);
    }
  }

  // <img> without alt
  const imgs = [...body.matchAll(/<img\b([^>]+)>/gi)];
  let imgsNoAlt = 0;
  for (const m of imgs) {
    const attrs = m[1];
    if (!/\balt\s*=/.test(attrs)) imgsNoAlt++;
  }
  if (imgsNoAlt > 0) {
    add('high', path, `${imgsNoAlt} <img> without alt attribute`);
  }

  // <button> without text or aria-label
  const buttons = [...body.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)];
  let buttonsNoText = 0;
  for (const m of buttons) {
    const attrs = m[1];
    const inner = m[2].replace(/<[^>]+>/g, '').trim();
    if (!inner && !/\baria-label\s*=/.test(attrs) && !/\baria-labelledby\s*=/.test(attrs)) {
      buttonsNoText++;
    }
  }
  if (buttonsNoText > 0) {
    add('high', path, `${buttonsNoText} <button> without text content or aria-label`);
  }

  // <a> with no text and no aria-label and no <img alt>
  const anchors = [...body.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)];
  let anchorsNoText = 0;
  for (const m of anchors) {
    const attrs = m[1];
    const innerRaw = m[2];
    const inner = innerRaw.replace(/<[^>]+>/g, '').trim();
    if (inner) continue;
    if (/\baria-label\s*=/.test(attrs)) continue;
    if (/\baria-labelledby\s*=/.test(attrs)) continue;
    // Anchor wraps an image with alt? OK.
    if (/<img\b[^>]*\balt\s*=\s*["'][^"']+["']/i.test(innerRaw)) continue;
    anchorsNoText++;
  }
  if (anchorsNoText > 0) {
    add('high', path, `${anchorsNoText} <a> without text, aria-label, or image alt`);
  }

  // <input> / <select> / <textarea> without an associated <label>.
  // Recognises three patterns: label[for=id], <label>...<input></label>
  // wrapping, and aria-label/aria-labelledby. Honeypot inputs (tabindex=-1
  // or name=honeypot) are skipped · they are intentionally hidden from a11y.
  // Radio + checkbox controls grouped under a <fieldset><legend> count as
  // group-labelled.
  const inputs = [...body.matchAll(/<(input|select|textarea)\b([^>]+?)(\/?)>/gi)];
  let inputsNoLabel = 0;
  for (const m of inputs) {
    const tag = m[1].toLowerCase();
    const attrs = m[2];
    const pos = m.index;
    const typeMatch = /\btype\s*=\s*["']([^"']+)["']/.exec(attrs);
    const type = typeMatch ? typeMatch[1].toLowerCase() : 'text';

    if (tag === 'input' && ['hidden', 'submit', 'button', 'image', 'reset'].includes(type)) continue;

    // Honeypot / intentionally inaccessible
    if (/\bname\s*=\s*["']honeypot["']/i.test(attrs)) continue;
    if (/\btabindex\s*=\s*["']-1["']/.test(attrs) && /\bautocomplete\s*=\s*["']off["']/.test(attrs)) continue;

    // ARIA-labelled
    if (/\baria-label\s*=/.test(attrs)) continue;
    if (/\baria-labelledby\s*=/.test(attrs)) continue;

    // label[for=id]
    const idMatch = /\bid\s*=\s*["']([^"']+)["']/.exec(attrs);
    const id = idMatch ? idMatch[1] : null;
    if (id && new RegExp(`<label[^>]+for\\s*=\\s*["']${id}["']`, 'i').test(body)) continue;

    // <label>…<input>…</label> wrapping. Walk back from this input's
    // position; if we hit <label without a </label> first, we're inside.
    const before = body.slice(Math.max(0, pos - 1024), pos);
    const lastOpenLabel = before.lastIndexOf('<label');
    const lastCloseLabel = before.lastIndexOf('</label>');
    if (lastOpenLabel > lastCloseLabel) continue;

    // <fieldset><legend>…</legend> group for radio/checkbox
    if (type === 'radio' || type === 'checkbox') {
      const lastOpenFieldset = before.lastIndexOf('<fieldset');
      const lastCloseFieldset = before.lastIndexOf('</fieldset>');
      if (lastOpenFieldset > lastCloseFieldset && /<legend/i.test(before.slice(lastOpenFieldset))) continue;
    }

    inputsNoLabel++;
  }
  if (inputsNoLabel > 0) {
    add('high', path, `${inputsNoLabel} form control(s) without associated <label> or aria-label`);
  }

  // Heading order · should start at h1 then h2 etc, no skips by more than 1
  const headings = [...body.matchAll(/<h([1-6])\b/gi)].map(m => parseInt(m[1], 10));
  let h1Count = headings.filter(h => h === 1).length;
  if (h1Count === 0) {
    add('medium', path, 'no <h1> on page');
  } else if (h1Count > 1) {
    add('low', path, `${h1Count} <h1> tags on page (one preferred per page for screen reader nav)`);
  }
  for (let i = 1; i < headings.length; i++) {
    if (headings[i] > headings[i - 1] + 1) {
      add('low', path, `heading jump h${headings[i - 1]} → h${headings[i]} (skipping a level breaks outline)`);
      break;
    }
  }

  // Outline-removed focus styles · only flag when the :focus rule
  // removes outline WITHOUT also adding another visible indicator
  // (border-color change, box-shadow, background change).
  const focusBlocks = [...body.matchAll(/:focus(?:-within|-visible)?\s*\{([^}]+)\}/gi)];
  for (const m of focusBlocks) {
    const rules = m[1];
    if (!/outline\s*:\s*(0|none)/i.test(rules)) continue;
    const hasAlternativeIndicator =
      /\bborder(-color)?\s*:/.test(rules) ||
      /\bbox-shadow\s*:/.test(rules) ||
      /\bbackground(-color)?\s*:/.test(rules) ||
      /\btext-decoration\s*:/.test(rules);
    if (!hasAlternativeIndicator) {
      add('medium', path, 'outline removed in :focus rule with no replacement indicator · invisible focus');
      break;
    }
  }

  // tabindex > 0 (anti-pattern)
  if (/\btabindex\s*=\s*["']?[1-9]/.test(body)) {
    add('medium', path, 'positive tabindex value · disrupts natural tab order');
  }
}

console.log('\nPer-page checks');
for (const p of PUBLIC_PAGES) {
  process.stdout.write(`  ${p} ... `);
  const before = findings.length;
  await auditPage(p);
  const added = findings.length - before;
  if (added === 0) console.log(color('clean', 'green'));
  else console.log(color(`${added} issue${added === 1 ? '' : 's'}`, added > 2 ? 'red' : 'yellow'));
}

// ============================================================
// Report
// ============================================================

console.log('\nFindings by severity');
const order = ['error', 'high', 'medium', 'low'];
const labels = { error: 'ERROR', high: 'HIGH ', medium: 'MED  ', low: 'LOW  ' };
const colors = { error: 'red', high: 'red', medium: 'yellow', low: 'dim' };
findings.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity) || a.page.localeCompare(b.page));
if (findings.length === 0) {
  console.log(color('  (no issues)', 'green'));
} else {
  for (const f of findings) {
    console.log(`  ${color(labels[f.severity], colors[f.severity])}  ${f.page.padEnd(36)}  ${f.message}`);
  }
}

console.log('\n' + color('—'.repeat(60), 'dim'));
console.log('Counts:',
  color(`${findings.filter(f => f.severity === 'error').length} error`, 'red'),
  color(`${findings.filter(f => f.severity === 'high').length} high`, 'red'),
  color(`${findings.filter(f => f.severity === 'medium').length} medium`, 'yellow'),
  color(`${findings.filter(f => f.severity === 'low').length} low`, 'dim'));

console.log('\nNext step: a real browser axe-core walk through the same pages.');
console.log('Install: npm i -g @axe-core/cli · then: axe https://counsel.day/index.html');
console.log('This script catches structural a11y; axe-core catches runtime ARIA and contrast on rendered nodes.');

process.exit(findings.filter(f => f.severity === 'error' || f.severity === 'high').length > 0 ? 1 : 0);
