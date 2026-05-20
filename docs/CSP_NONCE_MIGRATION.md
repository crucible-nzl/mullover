# CSP Nonce Migration · Plan

The current production CSP allows `'unsafe-inline'` on both `script-src` and `style-src` (see [`counsel-day-complete/ops/Caddyfile`](../counsel-day-complete/ops/Caddyfile) line 97). Removing it requires nonces or hashes on every inline `<script>` and `<style>` block. Status as of 2026-05-20: not yet migrated. This document is the path forward.

## Why this matters

`'unsafe-inline'` defeats the primary purpose of CSP: blocking script injection. Any reflected-XSS that lands a `<script>` tag in the DOM executes today. Argon2id, MFA, and rate-limiting protect the auth surface; CSP is the layer that protects every authenticated page from XSS once a session cookie is loaded. The hardening backlog ([`docs/SECURITY_HARDENING.md`](SECURITY_HARDENING.md)) calls this out as the largest remaining defence gap.

## Current footprint

Run `python counsel-day-complete/scripts/audit-inline-scripts.py` to count inline blocks per file. Order of magnitude as of 2026-05-20: ~100 inline `<script>` blocks across ~50 HTML files (most pages use 2-4 small scripts: nav hydration, analytics, PWA registration, page-specific UI hookup).

## Two paths, pick one

### Path A · Nonce per request (recommended for app-served pages)

Best when HTML is served by Next.js (`counsel-day-app/`). Next.js middleware mints a 128-bit nonce per request, attaches it to `Content-Security-Policy: ...'nonce-XYZ'...`, and renders inline scripts with `<script nonce="XYZ">`. Static pages served by Caddy can't easily do this because Caddy doesn't have a templating pass that's both fast and safe for the page bodies.

### Path B · Hash allowlist (recommended for Caddy-served static pages)

Compute the SHA-256 hash of each unique inline block and add `'sha256-...'` to `script-src` and `style-src`. Browsers compare the actual block's hash against the allowlist and execute only if they match. This needs zero per-request work in Caddy but does need a build step that maintains the allowlist.

Counsel.day's static site is large enough that Path B is more practical. The sealed-record overlay and skeleton-shimmer have a small number of distinct inline blocks; many `<script>` tags are page-specific and would need their own hash. The Caddyfile CSP value would balloon, but it would still be < 4 KB (browser limit is much higher).

## Steps for Path B

1. Write `counsel-day-complete/scripts/csp-hash-allowlist.py` that:
   - Walks every `.html` file under `counsel-day-complete/`.
   - Extracts each inline `<script>...</script>` and `<style>...</style>` block.
   - Computes SHA-256 of the inner content.
   - Outputs a deduped sorted list of `'sha256-<base64>'` entries.

2. Wire the output into the Caddyfile via an env-var or include file: `{$CD_SCRIPT_HASHES}` and `{$CD_STYLE_HASHES}` injected into the CSP header.

3. Add `--check` mode to the script. Brand-verify Check N° (new) runs this check and fails the build if any inline block in any HTML file is not in the allowlist.

4. Drop `'unsafe-inline'` from the CSP. Test in staging on every page (HOMEPAGE, every signed-in surface, every admin surface). Re-add only if a specific page breaks.

## Steps for Path A (Next.js app routes)

Already documented in `next.config.mjs` headers; the migration is a single middleware update. Lower priority because the app routes are mostly JSON APIs and don't render inline scripts.

## Acceptance

- `curl -I https://counsel.day/ | grep Content-Security-Policy` no longer contains `'unsafe-inline'`.
- Every page loads in Chrome / Firefox / Safari without console CSP-violation errors.
- Brand-verify includes the new check.

## Known blockers

- GTM and GA4 inject inline scripts that we don't control. Either keep `'unsafe-inline'` for `script-src-elem` only OR use `'strict-dynamic'` with a nonce on the bootstrap loader and let it cascade. PostHog (EU) is the same pattern.
- reCAPTCHA injects inline event handlers. The official guidance is to use `'unsafe-eval'` (different directive) and nonce on the bootstrap.

These three vendors are the reason the migration hasn't shipped yet. None are dealbreakers; all three have documented CSP guidance.
