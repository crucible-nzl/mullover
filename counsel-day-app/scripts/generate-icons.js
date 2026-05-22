/**
 * PWA icon generator.
 *
 * Reads counsel-day-complete/icon-source.svg (1024x1024) and rasterises
 * to every PNG size the manifest + service worker reference. Without
 * these files the manifest fails Chrome's installability check and
 * `beforeinstallprompt` never fires.
 *
 * Run from the repo root (or counsel-day-app/) any time the source SVG
 * changes:
 *
 *   cd counsel-day-app
 *   npm install --no-save sharp   # one-time; sharp is heavy, not in deps
 *   node scripts/generate-icons.js
 *
 * Outputs (into counsel-day-complete/):
 *   icon-192.png            · standard manifest icon
 *   icon-512.png            · large manifest icon (Play Store + splash)
 *   icon-maskable-192.png   · Android adaptive icon, 10% safe area
 *   icon-maskable-512.png   · Android adaptive icon, large
 *   icon.svg                · copy of icon-source for SVG-aware browsers
 *   apple-touch-icon.png    · iOS home-screen icon, 180x180
 *
 * Commit the PNGs to the repo · they're static assets. Re-run only if
 * the source SVG changes. The static-deploy script ships them to
 * /var/www/counsel.day, where the manifest references them.
 */

const fs = require('fs');
const path = require('path');

let sharp;
try {
  sharp = require('sharp');
} catch (err) {
  console.error('\n[generate-icons] sharp is not installed.');
  console.error('Install it first: cd counsel-day-app && npm install --no-save sharp');
  console.error('(It\'s heavy and only needed for icon regen, so we don\'t pin it in package.json.)');
  process.exit(1);
}

const ROOT = path.resolve(__dirname, '..', '..');
const STATIC_DIR = path.join(ROOT, 'counsel-day-complete');
const SOURCE = path.join(STATIC_DIR, 'icon-source.svg');

if (!fs.existsSync(SOURCE)) {
  console.error(`[generate-icons] source SVG missing: ${SOURCE}`);
  process.exit(1);
}

const sourceBuffer = fs.readFileSync(SOURCE);

async function writePng(outName, size, opts = {}) {
  const outPath = path.join(STATIC_DIR, outName);
  let pipeline = sharp(sourceBuffer, { density: 384 }).resize(size, size, {
    fit: 'contain',
    background: { r: 255, g: 255, b: 255, alpha: 1 },
  });
  if (opts.maskable) {
    // Maskable icons: Android crops anywhere within the inner 80% circle.
    // We shrink the rendered glyph to fit within the safe area (10% margin
    // on every side) and place it centred on a paper-white background.
    const inner = Math.round(size * 0.8);
    const offset = Math.round((size - inner) / 2);
    const glyph = await sharp(sourceBuffer, { density: 384 })
      .resize(inner, inner, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .png()
      .toBuffer();
    pipeline = sharp({
      create: { width: size, height: size, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
    }).composite([{ input: glyph, top: offset, left: offset }]).png();
  }
  await pipeline.png({ compressionLevel: 9 }).toFile(outPath);
  console.log(`  wrote ${outName} (${size}x${size})`);
}

async function main() {
  console.log('[generate-icons] rasterising icon-source.svg →');
  await writePng('icon-192.png', 192);
  await writePng('icon-512.png', 512);
  await writePng('icon-maskable-192.png', 192, { maskable: true });
  await writePng('icon-maskable-512.png', 512, { maskable: true });
  await writePng('apple-touch-icon.png', 180);
  // The manifest also references /icon.svg; copy the source so SVG-aware
  // browsers (Chrome, Edge, Safari 16.4+) get the vector form.
  fs.copyFileSync(SOURCE, path.join(STATIC_DIR, 'icon.svg'));
  console.log('  wrote icon.svg (copy of icon-source.svg)');
  console.log('[generate-icons] done');
}

main().catch((err) => {
  console.error('[generate-icons] failed:', err.message);
  process.exit(1);
});
