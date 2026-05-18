# Counsel.day · Security hardening backlog

Findings from the 17 May 2026 audit of the live site (https://counsel.day) and the static codebase in `counsel-day-complete/`. Grouped by severity. Each item lists the finding, the remediation, and the file or surface where the fix lands.

The site is currently static HTML on Caddy 2.6 + Hetzner Ubuntu 24.04 ARM, with no backend. Most "high" findings become "critical" the moment a real backend with sessions, payments, and AI calls is wired in. **Fix the criticals before any backend goes live, and the highs before signup goes to a real audience.**

---

## CRITICAL · fix today

### C1 · Admin panel publicly reachable · **RESOLVED 17 May 2026**

- **Finding**: `GET https://counsel.day/admin.html` returned 200 + 128 KB of the full admin UI.
- **Resolution**: HTTP Basic Auth placed in front of `/admin`, `/admin.html`, `/admin-app.js` via Caddyfile. Credentials: `admin@counsel.day` / bcrypt-hashed password (stored only in Caddyfile, generated 17 May 2026, rotate quarterly). Verified: 401 without creds, 200 with.
- **Canonical Caddyfile** lives at [counsel-day-complete/ops/Caddyfile](../counsel-day-complete/ops/Caddyfile); production copy at `/etc/caddy/Caddyfile`.
- **Follow-up** (low priority): basic auth is a stopgap. When the real backend ships, move admin behind the same Supabase Auth session as the rest of the app, with an `is_admin` claim guarding access.

### C2 · Internal build script publicly reachable · **RESOLVED 17 May 2026**

- **Finding**: `GET /scripts/brand-verify.ps1` returned 200 + full PowerShell source.
- **Resolution**: File deleted from `/var/www/counsel.day/scripts/` and the `/scripts/*` path 404'd at the Caddy edge. Verified.

### C3 · Internal tools (og-image-generator.html) publicly reachable · **RESOLVED 17 May 2026**

- **Finding**: `GET /og-image-generator.html` returned 200.
- **Resolution**: Caddy `@blocked` matcher now 404s `/og-image-generator.html`, `/homepage.html`, `/components`, `/components.html`, and `/scripts/*` at the edge. Defence-in-depth: even if a future deploy puts the files back on disk, the edge will 404 them.

**Applied Caddyfile block** (now live):

```caddy
@blocked path /scripts /scripts/* /og-image-generator.html /homepage.html /components /components.html
respond @blocked 404

@admin path /admin /admin.html /admin-app.js
basicauth @admin {
    admin@counsel.day $2a$14$gwnD/...
}
```

---

## HIGH · fix this week

### H1 · CSP allows `'unsafe-inline'` for both script-src and style-src

- **Finding**: Live CSP header contains:
  ```
  script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.google-analytics.com;
  style-src  'self' 'unsafe-inline' https://fonts.googleapis.com;
  ```
- **Impact**: Defeats the primary XSS protection CSP exists for. Any reflected or stored XSS becomes immediately exploitable. This is fine on a pure static brochure site with zero user input, but the site now has `/signup` (form input) and will soon have all the app surfaces (compose, vote-today, etc.).
- **Why it happened**: Inline `<style>` blocks and inline `onclick=` handlers on `/compose.html` (radio toggles), `/vote.html` (demo button), and a few others. Cheap to ship; expensive to keep.
- **Fix**:
  1. **Short-term** (before signup goes to real users): generate a per-request nonce in Caddy and inject it into every `<script>` and `<style>` tag. Replace `'unsafe-inline'` with `'nonce-<value>'`. Caddy can do this via the `templates` directive.
  2. **Medium-term** (when backend exists): extract every inline `onclick=`, `onsubmit=` from `compose.html`, `vote.html`, and the carousel JS in `index.html` into addEventListener handlers in external `.js` files.
  3. **Audit list of inline handlers to extract**: see `grep -rEn 'onclick=|onsubmit=|onload=|onerror=' --include="*.html" counsel-day-complete/`. Currently 9 occurrences across 4 files.
- **Owner**: frontend · ETA this week for short-term, this month for medium.

### H2 · No Subresource Integrity on third-party scripts

- **Finding**: Three external scripts load without `integrity=` and `crossorigin=` attributes:
  - `https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js` (admin.html only)
  - `https://www.google.com/recaptcha/api.js?render=…` (signup.html)
  - `https://fonts.googleapis.com/css2?family=…` (every page · CSS, but the same risk)
- **Impact**: If jsDelivr, Google reCAPTCHA, or Google Fonts is ever compromised, an attacker gets full XSS on every Counsel.day page that loads them. Real attack: in 2020 a jsDelivr-hosted package was tampered for ~36 hours before takedown.
- **Fix**:
  - **chart.js**: pin to a specific SHA-384 hash via `integrity` attribute. Generate via `curl -s URL | openssl dgst -sha384 -binary | openssl base64 -A`. Add `crossorigin="anonymous"`.
  - **reCAPTCHA**: Google publishes no stable SRI hash because the script is request-specific. **Live with this** · it's the documented Google pattern. Mitigation: ensure CSP `script-src` allow-lists exactly `https://www.google.com/recaptcha/` and nothing broader on google.com.
  - **Google Fonts**: same problem (dynamic CSS). Best fix: **self-host the fonts**. Already on the backlog as TIER C performance work (`docs/INTEGRATION_BACKLOG.md` mentions a fonts.css conversion). Doing this kills the SRI gap AND eliminates 2 DNS lookups + 2 TLS handshakes per page load.
- **Owner**: frontend · ETA self-hosted fonts this week.

### H3 · /signup form silently "succeeds" against a nonexistent backend

- **Finding**: `POST /api/signup` returns 404 (no such endpoint). The signup.html JS catches the failure and shows the "Check your inbox" success slip anyway, so the form appears to work.
- **Impact**: 
  1. Deceptive UX · users believe they've signed up but no record exists.
  2. Once the live URL is shared, every submission is silently discarded; no signups captured.
  3. Bots can submit at unlimited rate without detection.
- **Why it happened**: The local-fallback was added so the demo flow completes during static-site testing.
- **Fix**: 
  1. **Immediate**: change the catch handler to show a real error message ("Signup is not yet live. Drop us a note at hello@counsel.day and we'll add you to the early-access list.") rather than the success slip.
  2. **Real fix**: ship `/api/signup` (see `docs/INTEGRATION_BACKLOG.md` § 1).
- **Owner**: frontend · ETA today for the error message; full fix awaits backend stack decision.

### H4 · No CSRF protection on forms

- **Finding**: `signup.html`, `compose.html`, `contact.html` all submit forms via `<form action=… method="post">` with no CSRF token field. Same-origin policy is the only defence today.
- **Impact**: When backend ships, any of these endpoints is vulnerable to cross-site request forgery from a malicious page the user visits while logged in. Account takeover via password change is the classic worst case.
- **Fix**: Once backend exists, every state-changing form needs either:
  - A hidden `csrf_token` field populated by the server per-session, or
  - The `SameSite=Lax` cookie attribute on the session cookie (covers most cases · Supabase Auth sets this by default), plus an `Origin` / `Referer` check on the server.
- **Owner**: backend · ETA when backend ships. Not exploitable today (no backend).

### H5 · Heavy inline event handlers couple to H1

- **Finding**: 9 inline `onclick=` and 1 `onsubmit=` on `compose.html` plus 1 `onclick=` on `verdict.html` (demo toggle).
- **Impact**: As long as CSP allows `'unsafe-inline'` for scripts, these work. The day we tighten CSP (H1), they all break.
- **Fix**: Refactor each into `addEventListener` in a per-page `.js` file. Bundle with H1's CSP tightening.
- **Owner**: frontend · ETA this week.

---

## MEDIUM · fix this month

### M1 · CSP missing reCAPTCHA sources

- **Finding**: `signup.html` loads reCAPTCHA from `https://www.google.com/recaptcha/api.js` and the iframe calls back to `https://www.google.com/recaptcha/api2/…`. Current CSP allows only `googletagmanager.com` and `google-analytics.com` under `script-src`, neither covers `www.google.com/recaptcha`. The reCAPTCHA script currently 400s anyway because the site key is the placeholder `YOUR_RECAPTCHA_V3_SITE_KEY`; the day a real key is pasted, CSP will silently block it.
- **Fix**: Update Caddyfile `Content-Security-Policy` header to add:
  ```
  script-src ... https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/
  frame-src https://www.google.com/recaptcha/
  ```
- **Owner**: ops · ETA before the first real reCAPTCHA site key is deployed.

### M2 · No Cache-Control headers anywhere

- **Finding**: No `Cache-Control`, `Expires`, or `Age` headers on any asset (HTML, CSS, JS, font). Browsers fall back to heuristic caching (typically 10 % of `Last-Modified` age), so behaviour is unpredictable.
- **Impact**: Performance (worse repeat-load times) and security (stale content can serve after a critical update; harder to invalidate a compromised CDN entry).
- **Fix**: Add a Caddyfile block:
  ```caddy
  # Long-cache content-addressed assets
  @fonts path *.woff2 *.woff *.ttf
  header @fonts Cache-Control "public, max-age=31536000, immutable"
  @hashed_assets path *.css *.js *.svg *.png *.jpg *.webp
  header @hashed_assets Cache-Control "public, max-age=2592000, stale-while-revalidate=86400"
  # Short-cache HTML so updates show up
  @html path *.html /
  header @html Cache-Control "public, max-age=300, must-revalidate"
  ```
- **Owner**: ops · ETA this month. Already noted in `docs/INTEGRATION_BACKLOG.md` § 10 as Tier B.

### M3 · `Server: Caddy` banner leak

- **Finding**: `Server: Caddy` returned on every response.
- **Impact**: Minor info disclosure; tells attackers which CVEs and config quirks to target.
- **Fix**: Add to Caddyfile globals:
  ```caddy
  servers {
    metrics
  }
  header {
    -Server
  }
  ```
- **Owner**: ops · ETA this month.

### M4 · No method filtering on static files

- **Finding**: `PUT`, `DELETE`, `PATCH`, `POST` against any static URL returns 200 (Caddy serves the file regardless of method).
- **Impact**: Cosmetic on a static site; scanners flag it as method-not-allowed misconfiguration. Becomes a real issue once `/api/*` exists and one of those paths overlaps.
- **Fix**: Caddyfile matcher:
  ```caddy
  @methods method GET HEAD OPTIONS
  respond / 405 {
    close
  }
  ```
  (apply only to the static-file location; not to `/api/*` once it exists).
- **Owner**: ops · ETA this month.

### M5 · No `/.well-known/security.txt`

- **Finding**: 404 on `https://counsel.day/.well-known/security.txt`. No documented channel for security researchers to disclose findings.
- **Impact**: Researchers who find a vulnerability have no contact path. Encourages public disclosure on Twitter / Mastodon instead of responsible disclosure.
- **Fix**: Create [counsel-day-complete/.well-known/security.txt](../counsel-day-complete/.well-known/security.txt) per [securitytxt.org](https://securitytxt.org):
  ```
  Contact: mailto:security@counsel.day
  Expires: 2027-05-17T00:00:00Z
  Preferred-Languages: en
  Canonical: https://counsel.day/.well-known/security.txt
  Policy: https://counsel.day/security
  ```
- **Owner**: ops · ETA this month. **30 min task.**

### M6 · `innerHTML` used for DOM construction

- **Finding**: 16 occurrences of `innerHTML` across `admin-app.js` (admin-only), `ga4.js` (consent banner injection), `components.html` (demo), and `signup.html` (none · uses safe DOM API; verified). All current callers pass static strings; no user-supplied data is interpolated.
- **Impact**: Safe today. Becomes XSS-vulnerable the moment any of these calls is wired to API response data without strict server-side escaping.
- **Fix**: 
  1. Add lint rule in CI: `grep -rEn 'innerHTML\s*=\s*[^"\047]*\$' --include="*.js"` blocks merges where `innerHTML` is set with a template literal containing `${…}`.
  2. Refactor the worst offenders to use `textContent`, `createElement`, and `appendChild`.
- **Owner**: frontend · ETA when the corresponding pages get real data wired (admin first).

### M7 · CSP has no `report-uri` or `report-to`

- **Finding**: No CSP violation reporting destination configured.
- **Impact**: We are blind to CSP violations in production (legitimate or attempted attacks). When we tighten CSP (H1), this is the only way to know we have not broken legitimate page features.
- **Fix**: Add `report-uri /csp-report` to the CSP. Build a `POST /csp-report` endpoint (or use an external aggregator like report-uri.com) to collect.
- **Owner**: backend · ETA when backend exists.

---

## LOW · fix when convenient or when backend exists

### L1 · Per-IP rate limiting on /api/* · **RESOLVED 18 May 2026**

- **Finding (original)**: Caddy by default does not rate-limit. The signup form, when wired, is open to credential-stuffing and spam-signup volumes.
- **Resolution**: Implemented at the application layer in Next.js middleware ([counsel-day-app/src/middleware.ts](../counsel-day-app/src/middleware.ts)). Per-IP sliding-window counters keyed by route group. Verified end-to-end: 8 rapid POSTs to `/api/signin` from one IP → 5 pass, 3 return 429 + Retry-After.
- **Limits per minute per IP**:
  - `/api/signin`, `/api/signup`, `/api/verify`, `/api/set-password`, `/api/password-reset/consume`: **5/min**
  - `/api/password-reset/request`: **3/min** (email bombing protection)
  - `/api/checkout/create`, `/api/billing/portal`, `/api/compose`, `/api/invite/accept`: **10/min**
  - `/api/vote`: **30/min** (legitimate use is ~1/day per decision; generous for retry edge cases)
  - `/api/invite/preview`: **30/min**
  - `/api/*` default catch-all: **120/min**
- **Bypasses**: `/api/stripe/webhook` (Stripe retries aggressively; idempotency at the handler dedupes), `/api/auth-check` (called by Caddy on every protected page render), `/api/health` (monitoring liveness).
- **Storage**: in-memory Map per instance, GC'd every 5 min. Counters reset on app restart (acceptable for single-instance · an attacker still hits the limit per restart cycle).
- **Follow-up (low priority)**: When we go multi-instance, swap the Map for Postgres or Redis. Edge-level rate limiting in Cloudflare (currently DNS-only) is a future defence-in-depth layer; not blocking.

### L2 · PostgreSQL listening on the Hetzner box

- **Finding**: `ss -tln` shows `127.0.0.1:5432` (postgres). Bound to localhost only · not externally exposed.
- **Impact**: None today (localhost-only). Note for backlog: if anyone changes `listen_addresses` in `postgresql.conf` it becomes public. Hetzner Cloud Firewall does not currently allow 5432 inbound; verify before any change.
- **Fix**: Document the binding intent in `docs/INTEGRATION_BACKLOG.md` (already there under § Stack); add a Hetzner firewall rule that explicitly denies 5432 from the public internet.
- **Owner**: backend · when DB provisioning is formalised.

### L3 · `Permissions-Policy` could enumerate more sensors

- **Finding**: Current: `interest-cohort=(), camera=(), microphone=(), geolocation=()`. Missing: `usb=(), payment=(), accelerometer=(), gyroscope=(), magnetometer=(), midi=(), serial=(), fullscreen=()`.
- **Impact**: Negligible for a decision tool. Good-hygiene addition.
- **Fix**: Extend the Caddyfile `Permissions-Policy` header to include every sensor we know we will never use.
- **Owner**: ops · ETA this month.

### L4 · No CAA DNS record

- **Finding**: `dig CAA counsel.day` returns empty. Any CA can issue a cert for `counsel.day` (subject only to the CA's own ACME challenges).
- **Impact**: An attacker who briefly controls DNS could issue a cert from another CA without anyone noticing.
- **Fix**: Add `counsel.day. IN CAA 0 issue "letsencrypt.org"` and `0 iodef "mailto:security@counsel.day"` at Cloudflare.
- **Owner**: ops · ETA this month. **5 min task.**

### L5 · Backups · **RESOLVED 18 May 2026 · two layers**

- **Finding (original)**: Static site is in git, but no automated server-side backup of `/var/www`, Caddy config, certs cache, future Postgres data.

**Layer 1 · Postgres logical backups (app-level, on-box):**
- Script: [counsel-day-app/scripts/pg-dump.sh](../counsel-day-app/scripts/pg-dump.sh) · runs `pg_dump --no-owner --no-acl --clean --if-exists` piped to `gzip -9`, writes to `/var/backups/counsel-day/postgres-YYYYMMDD-HHMMSS.sql.gz`.
- systemd: [counsel-day-app/ops/counsel-day-backup.service](../counsel-day-app/ops/counsel-day-backup.service) + [.timer](../counsel-day-app/ops/counsel-day-backup.timer) · triggers daily at 03:15 UTC, `Persistent=true` (catches up after reboot).
- Retention: 14 days (`-mtime +14 -delete`).
- Sanity check: aborts if dump < 1 KB (catches silent pg_dump failures).
- Hardened: NoNewPrivileges, ProtectSystem=strict, ReadWritePaths limited to `/var/backups/counsel-day`.
- Verified: manual run produced a 5.4 KB dump.
- **Restore**: `gunzip -c /var/backups/counsel-day/postgres-…sql.gz | psql "$DATABASE_URL"` (idempotent · `--clean --if-exists` drops existing objects first).
- **Purpose**: fast point-in-time restore of just the database (granular, single-table restores possible by editing the SQL before piping to psql).

**Layer 2 · Hetzner Cloud Backups (server-level, offsite):**
- **Already enabled** on `counsel-day-prod-01` (verified 18 May 2026). 7 daily slots, oldest auto-deleted, ~0.97 GB image size.
- Cost: ~20% of CAX11 plan, approximately €1.20/month, already billing.
- Hetzner runs daily snapshots automatically. Recent confirmed: 15/16/17 May 2026.
- **Restore**: Hetzner Console → server → Backups tab → click any snapshot → Restore. Takes ~5 min downtime, restores the entire disk (OS + app + Postgres data + /var/backups).
- **Purpose**: whole-box recovery if the Hetzner box is deleted by accident, disk corruption hits both Postgres and /var/backups, or the OS is unbootable. Offsite (Hetzner storage cluster, separate from the live disk).

**Why both layers**: pg_dump is fast + granular but lives on the same disk as the live database. Hetzner Cloud Backups are offsite + whole-box but coarse-grained (you restore the entire disk to a point-in-time, can't pick out one table). The two together cover both the "I dropped a column by accident" case (pg_dump) and the "the box is gone" case (Hetzner).

### L6 · No HSTS preload list submission

- **Finding**: `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload` header is set, but the domain has not been submitted to the [HSTS preload list](https://hstspreload.org). Browsers won't enforce preload until it's on the list.
- **Impact**: Minor · most browsers will respect the header after the first visit anyway.
- **Fix**: Submit at hstspreload.org once you're confident no HTTP traffic anywhere on counsel.day is intentional.
- **Owner**: ops · ETA when the site has been live with HSTS for 3+ months without rollback.

### L7 · No log retention policy

- **Finding**: Caddy access logs exist on the server but no rotation or shipping is documented. No application logs yet (no backend).
- **Fix**: Document retention windows. GDPR-relevant: PII in access logs (IP addresses) is personal data. Recommended: 90 days for access logs, 30 days for application logs (debug), permanent for audit logs.
- **Owner**: ops · ETA when GDPR posture is reviewed (likely before EU launch).

### L8 · No 2FA / passkey on SSH

- **Finding**: SSH access uses a single ed25519 key (`id_ed25519_counsel_day`). No second factor.
- **Impact**: Single point of compromise: if the private key on the local machine is exfiltrated, attacker has full root-equivalent access.
- **Fix**: Add a TOTP requirement for SSH via libpam-google-authenticator OR move to Tailscale + SSO. The ed25519 key file should at minimum have a passphrase (verify locally).
- **Owner**: ops · ETA before the first paying customer.

---

## KNOWN HARDENING GAPS · accepted, not fixable today

These are systemd / kernel hardening options that we **intentionally do not enable** because they break the application. Each entry is here so a future security review does not "fix" them by accident.

### K1 · `MemoryDenyWriteExecute=true` cannot be set on the Node.js unit

- **Why blocked**: V8's JIT compiler requires writable + executable memory pages to compile JavaScript at runtime. `MemoryDenyWriteExecute=true` causes V8 to SIGTRAP on the first `mmap(PROT_WRITE | PROT_EXEC)` call, killing the Node process before any code runs.
- **What we do instead**: every OTHER systemd hardening directive is enabled on `counsel-day-app.service` · `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome=true`, `ProtectKernelTunables`, `ProtectKernelModules`, `ProtectControlGroups`, `RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6`, `LockPersonality`, `RestrictRealtime`, `RestrictSUIDSGID`, `PrivateDevices`, `PrivateTmp`. Memory cap is `MemoryMax=1536M`.
- **What this means in practice**: an attacker who achieves code execution inside the Node process can JIT-compile arbitrary code. The mitigations above limit blast radius (no /home access, no /etc write, no new privileges, no kernel module loads), but JIT-time code generation cannot be prevented.
- **Future**: there is no fix that keeps V8. Long-term, server-side JS that does not need JIT (`--jitless` Node, or moving to a non-JIT runtime like Cloudflare Workers) would close this gap. Not on the roadmap.

### K2 · `'unsafe-inline'` retained in script-src and style-src

- See **H1** above. Same constraint; tightening is on the roadmap once nonce-injection lands in Caddy.

### K3 · Dev-only npm audit residuals (6 moderate, accepted) · **logged 18 May 2026**

After bumping `next` 15.1.3 → 15.5.18, `drizzle-orm` 0.36.4 → 0.45.2, `drizzle-kit` 0.30.0 → 0.31.10, `tsx` 4.19.2 → 4.20.6, all CRITICAL and HIGH advisories are eliminated. The 6 remaining moderate findings in `npm audit` are all **dev/build-tool transitive deps with no production attack surface**:

| Path | Advisory | Why no prod impact |
|---|---|---|
| `tsx → @esbuild-kit → esbuild ≤ 0.24.2` (via drizzle-kit) | [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) · esbuild dev-server CORS | esbuild's dev server is never run in production. Production serves `.next/standalone`. `drizzle-kit` is a developer-machine tool for generating migrations; it does not run on the prod box and never starts a dev server. |
| `next → postcss < 8.5.10` | [GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93) · postcss XSS in CSS stringify | postcss is build-time only. We process our own CSS, never third-party / user-provided CSS. The XSS is in the stringify output; we never expose stringified CSS to end users. |

npm's suggested "fixes" (`drizzle-kit@0.18.1`, `next@9.3.3`) are absurd downgrades · they're a clue that there is no current upstream version of these tools that uses a patched esbuild / postcss in the dependency tree. Accepted until upstream `drizzle-kit` migrates off `@esbuild-kit/*` (the package merged into `tsx` per the deprecation notice; `drizzle-kit` will follow).

**Action when reviewing:** run `npm audit --audit-level=high` (the deploy script does this). Should always return zero findings. Moderates that match this table are documented; any new moderate or any high+ is a real finding.

---

## INFORMATIONAL · monitor but no fix needed today

- **I1** · HSTS preload header set; not yet on browser preload list. See L6.
- **I2** · IPv6 listening on Caddy. IPv6 firewall posture not yet tested. Add IPv6 to any future port-scan baseline.
- **I3** · Cookie consent stored in localStorage as `cd_consent_v1`. Not transmitted to a server. For GDPR audit purposes you cannot prove consent was given · consider adding a `POST /consent` endpoint to log the decision once backend exists.
- **I4** · Live reCAPTCHA site key is a placeholder. Currently doing nothing. When activated, bots are unchecked.
- **I5** · No CSP `frame-src` directive set. We block `iframe` embedding of our site via `frame-ancestors 'none'` (good). The day reCAPTCHA goes live we'll need `frame-src https://www.google.com/recaptcha/` · see M1.
- **I6** · `Cross-Origin-Embedder-Policy` and `Cross-Origin-Resource-Policy` headers not set. Required only if we adopt SharedArrayBuffer or specific isolation patterns (not on roadmap).
- **I7** · `Server: Caddy` could become a "low" if a Caddy CVE is published; revisit then.

---

## What's already good · keep doing this

The audit found these positive defences already in place; do not regress them:

- TLS 1.2+ enforced (no SSLv3, no TLS 1.0/1.1).
- HSTS `max-age=31536000; includeSubDomains; preload` ✔
- `X-Frame-Options: DENY` ✔ (plus `frame-ancestors 'none'` in CSP · belt + braces)
- `X-Content-Type-Options: nosniff` ✔
- `Referrer-Policy: strict-origin-when-cross-origin` ✔
- `Permissions-Policy: interest-cohort=()` (FLoC opted out) ✔
- `Cross-Origin-Opener-Policy: same-origin` ✔
- HTTP→HTTPS 308 redirect ✔
- Let's Encrypt cert with auto-renewal ✔
- No hardcoded secrets, API keys, or PII in the codebase ✔
- No personal/test emails leaking via admin placeholder data ✔
- PostgreSQL bound to localhost only ✔
- GA4 consent-gated; honours GPC/DNT silently ✔
- No marketing pixels, no advertising trackers ✔

---

## Quick-win execution order

If you have one hour today:

1. **15 min** · Delete `/admin.html`, `/admin-app.js`, `/og-image-generator.html`, `/scripts/brand-verify.ps1` from `/var/www/counsel.day/` on the server (C1, C2, C3). One `ssh deploy@host "rm -f …"` command.
2. **15 min** · Add the Caddyfile `@blocked` snippet from C3. Reload Caddy.
3. **15 min** · Change the signup.html catch handler to show an "early access" message instead of fake success (H3).
4. **15 min** · Drop a `.well-known/security.txt` into `counsel-day-complete/.well-known/` (M5) and deploy.

That removes the four critical/high information-disclosure issues and the deceptive signup, and adds a researcher contact path. Total: one hour.

---

*Source recon transcripts captured 17 May 2026. Re-run baseline annually or after any infra change.*
