# Counsel.day Security Audit and Mini Penetration Test

A structured audit of every attack surface, the defence in depth that exists, the test that verifies the defence works, and the known gaps. Written to be run as a self-pen-test before every release and as the brief that a third-party tester would work against once we commission one.

This document is **not** a customer-facing artefact. It lives in `docs/SECURITY_AUDIT.md` and is the operator's working ledger.

**Threat model summary** (full version in [`engineering/the-privacy-mechanism.html`](../counsel-day-complete/engineering/the-privacy-mechanism.html) § 1):

1. **Partner-vs-partner** · one participant tries to read the other's votes before verdict day. The most product-critical threat.
2. **Insider-vs-customer** · a Counsel.day operator tries to read decision content.
3. **Outsider-vs-customer** · an unauthenticated or under-authenticated attacker tries to reach decision content.
4. **Subpoena-vs-customer** · lawful compulsion to produce data.

**OWASP ASVS Level 2** is the target for the self-audit. Items below are tagged with the relevant ASVS section where it applies.

**Status legend**
- ✅ **Tested** · automated test exists and passes in CI.
- 🟡 **Implemented** · defence is in place but has no automated test yet.
- 🔴 **Gap** · defence is incomplete or missing.

**Last reviewed:** 14 May 2026.

---

## A · Authentication (ASVS V2)

### A.1 · Identity provider is Auth0; we never see passwords

| Attack vector | Defence | Test | Status |
|---|---|---|---|
| Brute-force credential stuffing | Auth0 handles all credentials; their rate limiting + anomaly detection apply. We never see or store a password. | Auth0 telemetry; alert if `failed_login` rate > 5x baseline. | 🟡 |
| Credential reuse from breach databases | Auth0 Have-I-Been-Pwned integration; users prompted to change a compromised password. | Auth0 dashboard setting verified at deploy. | 🟡 |
| Session token theft | Sessions are JWTs signed by Auth0 (RS256), short-lived (24h), validated against JWKS on every request. HttpOnly + Secure + SameSite=Lax cookie. | Cypress E2E test asserts cookie attributes. | 🔴 (test not yet written) |
| Magic-link phishing | Single-use magic links, 1-hour expiry, bound to the originating browser session. | Manual test in staging. | 🟡 |
| OAuth callback hijack | Auth0 enforces strict callback URL allow-list. State parameter validated. | Auth0 dashboard setting verified. | 🟡 |
| Forced sign-in to an attacker's account | Auth0 PKCE on the OAuth flow. State + nonce validated. | Auth0 default + manual test. | 🟡 |

### A.2 · MFA

| Attack vector | Defence | Test | Status |
|---|---|---|---|
| Stolen password + no MFA | End users can opt into TOTP via Auth0. Operators required to use hardware-key WebAuthn from Phase 2 onwards. | Manual enrolment test before Phase 2 release. | 🟡 |
| SMS-based MFA intercepted via SIM-swap | We do not offer SMS-based MFA. Hardware key + TOTP only. | Auth0 dashboard verified: SMS factor disabled. | 🟡 |
| MFA bypass via "remember this device" | Auth0 setting: device trust at most 30 days; revoked on password change. | Auth0 dashboard setting verified. | 🟡 |

---

## B · Authorisation (ASVS V4)

### B.1 · Row-level security in PostgreSQL

The load-bearing defence for partner-vs-partner threats. Full SQL in [`engineering/the-privacy-mechanism.html`](../counsel-day-complete/engineering/the-privacy-mechanism.html) § 2.

| Attack vector | Defence | Test | Status |
|---|---|---|---|
| User A reads User B's votes in the same decision before verdict day | RLS policy on `votes`: only own votes visible until `verdict_revealed_at IS NOT NULL`. | Automated test: assert non-owner SELECT returns 0 rows for every vote before verdict day. Run on every PR. | 🔴 (test not yet written) |
| User reads notes from a decision they are not in | RLS policy on `notes`: user_id must appear in `decision_participants` for the decision. | Automated test: cross-decision read attempt returns 0 rows. | 🔴 |
| User reads verdict before verdict day | RLS policy on `verdicts`: requires `verdict_revealed_at IS NOT NULL`. | Automated test: pre-verdict-day SELECT returns 0 rows. | 🔴 |
| User reads decision they were never invited to | RLS policy on `decisions`: visibility joined through `decision_participants`. | Automated test: random-uuid SELECT returns 0 rows. | 🔴 |
| BYPASSRLS escalation by application bug | `app_user` role has no BYPASSRLS. Only `verdict_worker` role has BYPASSRLS, and only on three tables, only on the day of the scheduled verdict, only for the specific decision_id in flight. | Automated test: query the system catalogue, assert `app_user.rolbypassrls = false`. | 🔴 |
| Session-variable spoofing (forging app.current_user_id) | The session variable is set by FastAPI middleware from a verified Auth0 JWT. The application connection cannot SET ROLE; the variable cannot be overridden from request bodies. | Code review + integration test. | 🟡 |

### B.2 · Endpoint-level authorisation

| Attack vector | Defence | Test | Status |
|---|---|---|---|
| IDOR (insecure direct object reference) on `/api/decisions/{id}` | Every endpoint that takes a `decision_id` re-verifies participation server-side, not by trusting the URL. Plus RLS catches it at the DB layer if the app forgets. | Automated test: try to GET another user's decision by id; assert 404 (not 403, to avoid existence leak). | 🔴 |
| Privilege escalation to operator role | Operator claim is checked from the Auth0 JWT custom claim, signed by Auth0, validated against JWKS. No "is admin" flag readable or writable from user-controllable input. | Test: forged JWT with `operator: true` rejected by signature check. | 🔴 |
| Mass-assignment attack on PATCH endpoints | Pydantic schemas explicitly list allowed fields; extra fields rejected with 422. | Test: send extra fields, assert 422. | 🔴 |

---

## C · Cryptography (ASVS V6)

### C.1 · Per-decision encryption keys

| Attack vector | Defence | Test | Status |
|---|---|---|---|
| Database backup leak exposes all decision content | Vote payloads, note bodies, verdict bodies encrypted column-level with AES-256-GCM, keyed per-decision. The data key is wrapped by a master key in Infisical; the wrapped key sits in the `decisions` row. Backup contains ciphertext only. | Automated test: dump a backup, assert no plaintext vote content appears anywhere in the file. | 🔴 |
| Lost Infisical service-token exposes master key | The service-token is read-only on the production project's secrets. A rotation invalidates the old token. Service-token is itself rotated every 90 days. | Manual rotation test on staging quarterly. | 🟡 |
| Single-key compromise exposes all decisions | Per-decision keys limit blast radius. A compromised decision-key exposes exactly one decision. | Conceptual; tested by reviewing the key-derivation code. | 🟡 |
| Key derivation predictable | `crypto.urandom(32)` for each new decision data key. No deterministic derivation from user data. | Code review. | 🟡 |
| Master key cached in plaintext in a log | Audit log scrubbing strips any string matching the key shape before write. Logs ship to Better Stack scrubbed; raw logs never persisted. | Test: emit a synthetic key-shaped string at INFO level; assert it does not appear in the shipped log. | 🔴 |

### C.2 · Filesystem encryption at rest (PostgreSQL data volume)

Layered defence beneath the per-decision column-level encryption in C.1. The column keys protect *value-level* secrecy (a stolen backup yields ciphertext only); the filesystem-level encryption protects everything else Postgres writes · WAL segments, indexes, query plans, system catalogues, temp files, and any unencrypted operational columns · against physical-medium recovery.

**Implementation:** LUKS2 / dm-crypt on the dedicated Postgres data volume of the Hetzner CPX31. The Postgres `data_directory`, the WAL archive directory, and the daily-base-backup directory all live on the same encrypted volume. Cipher: AES-256-XTS, default LUKS2 settings (Argon2id key derivation, anti-forensic stripes enabled).

**Key custody:** the LUKS passphrase is held in Infisical under `infra/postgres/luks-passphrase`. It is delivered at boot by a one-shot systemd unit that reads from Infisical (via the host's Infisical service-token) and pipes the passphrase into `cryptsetup open` before `postgresql.service` starts. The passphrase never lands on disk in plaintext; the Infisical service-token is the only persisted credential, and it is read-only on the production `infra` project. Rotation: passphrase rotated annually (or immediately on any operator-credential incident); service-token rotated every 90 days alongside the rest of the secrets rotation schedule.

**Why not Postgres TDE:** community PostgreSQL has no in-tree Transparent Data Encryption as of 16. The two third-party patches (EDB TDE, Cybertec TDE) require a forked Postgres build, which we do not run for supply-chain reasons. Filesystem-level encryption gives the same threat coverage with a stock Postgres binary.

| Attack vector | Defence | Test | Status |
|---|---|---|---|
| Disk stolen from the Hetzner rack (or DC-employee snapshot of the raw volume) | LUKS2/AES-256-XTS on the data volume; an attacker without the Infisical passphrase sees only ciphertext blocks. | Boot a forensic image of the data volume on a clean host without the passphrase; confirm `cryptsetup luksDump` shows the header but `mount` fails, and a raw scan with `strings | grep` finds no plaintext vote/note/verdict content. | 🔴 (LUKS not yet provisioned) |
| Cloud snapshot of the volume leaks (Hetzner staff, supply-chain compromise of the backup pipeline) | Snapshots are taken at the block level beneath LUKS; the resulting image is ciphertext. Restoration requires the Infisical passphrase, which Hetzner does not hold. | Restore a recent snapshot to a fresh host with no passphrase; confirm restore fails. Then restore with the passphrase; confirm Postgres starts cleanly. | 🔴 |
| Memory-dump attack on running host (passphrase resident in kernel memory) | LUKS key material is held in kernel-locked memory and cleared on `cryptsetup close`. The host runs with `kernel.kexec_load_disabled=1` and `kernel.unprivileged_userns_clone=0` to reduce memory-read surface; full-disk swap is on the same encrypted volume so no swap exposure. | Kernel sysctl audit at deploy. | 🟡 (sysctls drafted, host not yet built) |
| Reboot races the passphrase fetch (Postgres tries to start before the volume is unlocked, falls back to an unencrypted scratch path) | systemd `RequiresMountsFor=/var/lib/postgresql` plus an `After=cryptsetup-postgres-data.service` dependency ensures Postgres starts only after the encrypted volume is mounted. There is no fallback path; Postgres fails to start rather than start on an unencrypted volume. | Boot test: kill the Infisical-passphrase service before reboot; confirm Postgres stays down, `pg_isready` fails, monitoring pages oncall, and no scratch data is written. | 🔴 |
| WAL archives shipped to R2 in plaintext | WAL archives are encrypted *again* before upload, using a separate R2-archive key (also held in Infisical, rotated every 90 days). R2 itself is configured with server-side encryption, but we do not trust SSE-S3 alone; the archive is already ciphertext before it leaves the host. | Download a recent WAL segment from R2 with `rclone`; assert the file is encrypted (entropy ≥ 7.9 bits/byte; magic bytes absent). | 🔴 |
| Base backup downloaded by an attacker who has compromised an operator account but not the LUKS key | The base backup is taken from inside the running Postgres (which sees decrypted data), so a base-backup theft *bypasses* the LUKS layer. This is why C.1 (per-decision column-level encryption) exists. The attacker still gets only ciphertext for the load-bearing fields (votes, notes, verdicts). | Inspect a base backup with `pg_restore --schema-only` for shape, then `grep` for known plaintext patterns from a test decision; assert none found in vote/note/verdict columns. | 🔴 |
| Decommissioned disk returned to Hetzner without secure wipe | LUKS volume header destroyed by `cryptsetup erase` before decommission; even if the underlying disk is recovered, the key slots are unrecoverable and the data is cryptographically inaccessible. | Run `cryptsetup erase` in the decommission checklist; verify `luksDump` reports no usable key slots before disk return. | 🟡 |
| Backup of the LUKS header lost → cannot decrypt own data after a disaster | The LUKS header is backed up daily to a separate Infisical entry (`infra/postgres/luks-header-backup`, base64-encoded). DR runbook step 3 restores the header before attempting `cryptsetup open`. | DR drill: simulate header loss, restore from Infisical, confirm volume opens. Run on staging quarterly. | 🟡 |

**Threat model coverage matrix:**

| Threat | Column-level (C.1) | Filesystem (C.2) | Transport (C.3) |
|---|---|---|---|
| Stolen physical disk | ✓ for load-bearing columns | ✓ for entire volume | n/a |
| Cloud-snapshot leak | ✓ for load-bearing columns | ✓ for entire volume | n/a |
| Logical backup theft (`pg_dump` by compromised operator) | ✓ for load-bearing columns | ✗ (bypassed) | n/a |
| Network sniffing on backup-shipping | depends on transport | ✓ if WAL re-encrypted | ✓ TLS |
| Memory-scrape on running host | ✗ | ✗ (decrypted in RAM) | n/a |

The matrix is the audit answer to "is the database encrypted?" · yes, in two complementary layers, each covering threats the other cannot.

### C.3 · Transport security

| Attack vector | Defence | Test | Status |
|---|---|---|---|
| Downgrade attack | TLS 1.2+ only; HSTS preloaded; Strict-Transport-Security with includeSubDomains + preload. | SSL Labs A+ scan. | 🟡 (Caddy config drafted) |
| Cipher suite weakness | Caddy modern cipher list; no CBC, no RC4, no SHA-1. | SSL Labs scan. | 🟡 |
| Certificate trust path failure | Let's Encrypt cert auto-renewed by Caddy; renewal monitored in Better Stack. | Uptime check verifies cert chain. | 🟡 |

### C.4 · Hashing

| Attack vector | Defence | Test | Status |
|---|---|---|---|
| Password hashes leaked from our DB | We do not store passwords; Auth0 does. Not our risk. | N/A | ✅ |
| Email hashed for Meta CAPI without salt → rainbow table | Salted SHA-256 (per-Meta-event salt + global key). | Code review of the CAPI integration. | 🔴 (CAPI not yet coded) |

---

## D · Input validation and output encoding (ASVS V5)

| Attack vector | Defence | Test | Status |
|---|---|---|---|
| SQL injection | Parameterised queries everywhere via SQLAlchemy. String-built SQL banned in code review. | Static analyser in CI rejects `f"SELECT..."` patterns. | 🔴 (linter rule not yet added) |
| XSS via vote / note rendering on the in-app surface | Notes are escaped before display (Jinja autoescape on; React's default JSX escaping in the Expo app). | Manual fuzz with `<script>alert(1)</script>` in a note. | 🔴 |
| XSS via question text on the verdict page | Same escaping rules. Verdict body is markdown rendered through a strict allow-list parser. | Test: insert `<img src=x onerror=alert(1)>` in a question; assert sanitisation. | 🔴 |
| CSRF on state-changing endpoints | SameSite=Lax cookies + Origin header verification + CSRF token on form submits. | Test: cross-origin POST to `/api/decisions` rejected. | 🔴 |
| HTML injection in transactional email templates | Brevo template variables escaped before substitution; templates reviewed for unintended HTML interpolation. | Test: insert `<b>foo</b>` in a display name; assert rendered as text in the email. | 🔴 |
| Polyglot file upload (none of the attachment surface) | No user-file-upload surface in launch product. Avatar upload (Phase 2) will validate content-type + magic-bytes + size limit. | N/A at launch. | ✅ |
| Header injection (response splitting) | FastAPI rejects newlines in header values by default. | Conceptual. | ✅ |

---

## E · Session management (ASVS V3)

| Attack vector | Defence | Test | Status |
|---|---|---|---|
| Session fixation | Auth0 issues new session on every login; old session invalidated. | Auth0 default + manual test. | 🟡 |
| Session not rotated on privilege change | Operator-claim changes trigger Auth0 session revocation. | Manual test before operator escalation. | 🔴 |
| Cookie hijack via JS | HttpOnly cookie; not readable from `document.cookie`. | Cypress: `document.cookie` does not contain session value. | 🔴 |
| Logout incomplete (token still valid) | Sign-out revokes the Auth0 refresh token + clears the cookie + adds the access token's jti to a denylist with TTL = remaining lifetime. | Test: post-logout API call with the old token returns 401. | 🔴 |

---

## F · Configuration and infrastructure (ASVS V14)

| Attack vector | Defence | Test | Status |
|---|---|---|---|
| Open SSH port to internet | `ufw` allows 22 only from a small operator IP list; SSH key-only; root login disabled; `fail2ban` rate-limits failed attempts. | `nmap -p 22` from a non-operator IP confirms closed. | 🔴 |
| Public Postgres port | Postgres bound to 127.0.0.1 only; never exposed. | `nmap -p 5432` from outside confirms closed. | 🔴 |
| Caddy config has open admin endpoint | Caddy admin endpoint disabled on `--launch`. | Config review at deploy. | 🟡 |
| Docker socket exposed | Docker socket not mounted into any container; sibling pattern only. | Config review. | 🟡 |
| Public R2 bucket accidentally world-readable | R2 bucket has `public-read = false`; signed URLs only. | Test: hit the bucket root unauthenticated; assert 403. | 🔴 |
| Server-side request forgery (SSRF) to internal IPs | FastAPI uses an explicit egress allow-list; no user-supplied URLs are fetched. | Code review. | 🟡 |
| Dependency vulnerability exploit | Dependabot weekly; CI blocks merge on high/critical. No version older than 7 days for vulnerable packages. | GitHub Security tab. | 🟡 |
| Outdated container base image | Renovate weekly on `python:3.12-slim`. CI runs `trivy` scan on every image build. | Trivy scan in CI. | 🔴 (not yet added) |
| Misconfigured CORS allows credentials from any origin | CORS allow-list: `https://counsel.day`, `https://app.counsel.day`, `https://admin.counsel.day`. No wildcards with credentials. | Test: `Origin: https://evil.example.com` rejected. | 🔴 |
| Secrets in environment variables visible in process listing | Secrets read from Infisical into process memory; never set as env vars. | `ps -e ww` on the production box shows no secret. | 🟡 |
| Logs contain secrets | Log scrubbing layer strips known-shape tokens (`sk-`, `phc_`, `whsec_`, etc.) before emit. | Test: emit synthetic secret-shape strings; assert scrubbed. | 🔴 |

---

## G · API security (ASVS V13)

| Attack vector | Defence | Test | Status |
|---|---|---|---|
| Unauthenticated API access | All endpoints require a valid Auth0 JWT except `/auth/*` and `/api/health`. | Test: every endpoint returns 401 without a token. | 🔴 |
| Rate-limit bypass via API key sharing | Rate limits applied per Auth0 sub, not per IP. Default 60 req/min per user, configurable per endpoint. | Test: exceed limit, assert 429 with Retry-After header. | 🔴 |
| Mass enumeration of decision IDs | Decision IDs are UUIDv4. Listings always scoped to the authenticated user. | Test: GET a random UUID returns 404. | 🔴 |
| Webhook replay (Stripe) | Stripe webhook signature verification; reject events older than 5 minutes; idempotency on event id. | Test: replay a known-good webhook; second one is a no-op. | 🔴 |
| Webhook from spoofed source | Stripe webhook signing key from Infisical; Brevo webhooks via VPN + signed payload. | Code review. | 🟡 |
| Body size DoS | FastAPI body-size limit 1 MB on most endpoints; 3 KB hard limit on note content (3000 chars + JSON overhead). | Test: POST 10 MB body returns 413. | 🔴 |

---

## H · Business logic (ASVS V11)

The class of bug specific to Counsel.day's mechanism. Generic security tools catch none of these.

| Attack vector | Defence | Test | Status |
|---|---|---|---|
| Owner of a decision changes the question mid-period after seeing partner's notes (which they can't yet, but in case the API allowed) | Question text is immutable after composition. Schema constraint + endpoint refuses PATCH on the field. | Test: PATCH `/decisions/{id}` with new question; assert 422. | 🔴 |
| Owner reveals the verdict early by manipulating `verdict_scheduled_at` | The field is read-only from the application code path; only the scheduled job can advance it. | Test: PATCH the field directly; assert 422. | 🔴 |
| User submits the same vote multiple times per day to drown out their partner's signal | UNIQUE constraint on (decision_id, participant_id, day). Only the most-recent vote of the day counts (vote correction allowed until midnight per locked spec). | Test: assert one-row-per-day enforcement at the DB layer. | 🔴 |
| Family-mode owner adds 7+ participants to dilute one specific voice | Schema CHECK constraint: `participant_count BETWEEN 3 AND 6`. | Test: attempt to insert participant #7; assert 422. | 🔴 |
| Solo user creates a "first decision free" pattern across multiple accounts to never pay | Auth0 connection plus Stripe `customer_email` deduplication. The free-first-decision flag is on `users.first_free_decision_used`; once true it never resets, even if the account is deleted-then-recreated within 30 days (we keep a hash of the deleted email for 30 days for this exact reason). | Test: delete + recreate account with same email; assert flag is honoured. | 🔴 |
| Annual-plan abuse: user composes 101+ decisions in a single year on Solo Annual ($49) | Trigger on insert: if year-to-date count > 100 on an annual plan, the 101st decision is billed at the per-decision price ($4.99) automatically via Stripe one-time charge. | Test: insert 101st decision; assert one-time charge created. | 🔴 |
| Refund manipulation: user requests refund post-verdict claiming technical defect that did not occur | Refunds are operator-issued, not customer-issued. Operator reviews the audit log of the decision and the verdict generation pipeline before issuing. | Procedural; manual review. | 🟡 |
| Subscription downgrade mid-decision to evade pricing | Tier downgrades preserve any active decisions at the price they were composed at. Database row keeps the price at decision-composition time. | Test: downgrade mid-decision; assert verdict still generates at the original tier. | 🔴 |

---

## I · Privacy controls (ASVS V8)

| Attack vector | Defence | Test | Status |
|---|---|---|---|
| Notes content leaked via error message | Sentry error reports scrubbed of vote/note/question content before transmission. | Test: trigger an error inside a notes-read codepath; assert no plaintext note in Sentry. | 🔴 |
| Notes content leaked via support response | Support cannot see note content. Operator dashboard does not surface vote/note text. | Manual review of admin.html confirms no note-content rendering on the operator surface. | ✅ |
| Note text exposed to GA/Meta/PostHog via accidental analytics call inside the app surface | Routing middleware strips analytics injection for all `/app/*` and `/vote` / `/verdict` routes; fails closed for unknown routes. | Test: load the vote page with network capture; assert no analytics requests fire. | 🔴 |
| Cookie consent ignored | Banner reads `localStorage.counselday_consent` on every page load; GTM container only initialised after consent grant. | Test: reject cookies; reload; assert no GTM script in the DOM. | 🔴 |
| Privacy-tagged Sentry error does not pause new signups | Sentry alert webhook → FastAPI maintenance flag. | Test: emit synthetic priv-tagged error; assert new-signup endpoint returns 503. | 🔴 |
| Subpoena response leaks more than required | Operator runbook: produce ciphertext only unless court-ordered to provide the key. Anthropic API egress logged. | Procedural. | 🟡 |

---

## J · Audit and logs (ASVS V7)

| Attack vector | Defence | Test | Status |
|---|---|---|---|
| Operator action not logged | Every admin endpoint INSERTs into the `audit_log` table before returning. Failure to insert aborts the action. | Test: synthetic admin action; assert audit row exists. | 🔴 |
| Operator deletes audit log entries | `audit_log` table has INSERT-only grant for the admin role. No UPDATE/DELETE permission, not even for the operator. Scheduled cleanup uses a separate maintenance role and is itself logged. | Test: attempt DELETE from admin role; assert insufficient_privilege error. | 🔴 |
| Backup leaks the audit log to attacker who can read everything | Audit-log rows contain operator action category, not personal content. Useful for the operator's accountability, not as a data source. | Conceptual. | 🟡 |
| Log shipping endpoint compromised | Better Stack ingestion via TLS + per-environment API key in Infisical. Key rotated quarterly. | Manual rotation test. | 🟡 |

---

## K · Email and webhooks (extra surfaces)

| Attack vector | Defence | Test | Status |
|---|---|---|---|
| Sender-domain spoofing | SPF, DKIM, DMARC published on `counsel.day` in Cloudflare DNS. DMARC policy `reject` after 30 days of `quarantine` monitoring. | dmarcian or Postmark DMARC scan. | 🔴 |
| Phishing via fake magic-link email | Magic links signed by Auth0; the user can verify the URL matches `auth.counsel.day` before clicking; on click, Auth0 verifies. | UI copy in the magic-link email shows the expected origin. | 🟡 |
| Stripe webhook signature secret leaked | Stored in Infisical; rotated every 90 days via Stripe Dashboard + Infisical webhook. | Manual rotation test. | 🟡 |
| Brevo API key leaked | Stored in Infisical; rotated every 90 days. Brevo emails sent only via the API; SMTP path disabled. | Manual rotation test. | 🟡 |

---

## L · Third-party integrations

The non-negotiable rule: every third-party service we send data to is in the sub-processor list at [`sub-processors.html`](../counsel-day-complete/sub-processors.html) and has a signed DPA on file.

| Vendor | What we send | Risk | Mitigation | Status |
|---|---|---|---|---|
| Auth0 | Email, display name, Auth0 sub | Account-takeover at IdP level | Vendor's own SOC 2 + DPA; we do not store password material | 🟡 |
| Stripe | Card payload (held by Stripe), name, email, billing country, amount | Payment fraud, billing-data leak | PCI-DSS Level 1; signed webhooks; idempotency keys | 🟡 |
| Anthropic (verdict day only) | Decision question, sealed notes, no user identity | Model-side data retention | DPA signed; no-training flag set on every call | 🟡 |
| Brevo | Email address, display name, transactional template body | Email delivery compromise | DPA; SPF/DKIM/DMARC; in-EU data residency | 🟡 |
| Cloudflare | DNS, edge cache, marketing-page hosting | Traffic interception | TLS terminated end-to-end on Hetzner; Cloudflare is a passthrough for app subdomain | 🟡 |
| Hetzner | Full app DB + Postgres + Infisical | Provider outage / compromise | Daily encrypted backup to R2; intra-EU GDPR coverage | 🟡 |
| Sentry | Stack traces only; vote/note/question content scrubbed before send | Information leak via error reports | Scrubbing layer + test; DPA signed | 🔴 (scrubbing test not yet written) |
| Better Stack | Uptime probes + structured logs (scrubbed) | Log content leak | Scrubbed at source; DPA signed | 🔴 |
| Google (GA4, Tag Manager) | Marketing-site events only (cookie-consent gated); never app surface | Consent bypass | Routing middleware strips on app surfaces; tested | 🔴 |
| Meta (Pixel + CAPI) | Marketing-site events; CAPI sends salted-SHA256 hashed email | Consent bypass, hash-rainbow | Salt per-event; consent banner gates; test | 🔴 (CAPI not coded) |
| PostHog | Marketing-site events; pseudonymous distinct_id | Consent bypass | Same as Google; consent-gated | 🔴 |
| Plausible | Anonymised marketing analytics; no cookies | None significant | Per-vendor design | ✅ |

---

## M · The penetration-test script (run before every major release)

The actual sequence of checks to run, in order. Each step has a pass/fail outcome.

### M.1 · External recon (assume role of opportunistic attacker)

1. `nmap -sS -p- counsel.day` · expect ports 80/443 open, all others filtered.
2. `nmap -sS -p- app.counsel.day` · same.
3. `nmap -sS -p- admin.counsel.day` · same (or 403 from Cloudflare/Caddy edge).
4. SSL Labs scan of all three subdomains · expect A+.
5. `dig counsel.day TXT` · expect SPF + DMARC + DKIM records.
6. `curl -I https://counsel.day` · verify HSTS, X-Content-Type-Options, Referrer-Policy, X-Frame-Options.
7. `whatweb counsel.day` · note exposed software versions; minimise.

### M.2 · Authentication probing

8. Try to sign up with the same email twice · second attempt should be rejected gracefully.
9. Try to sign in with a malformed JWT · expect 401, no info leak.
10. Try to sign in with an expired JWT · expect 401.
11. Try to sign in with a JWT signed by a different key · expect 401.
12. Trigger 10 failed sign-ins from one IP · expect rate-limited.
13. Verify the magic-link URL contains a one-time token that cannot be reused.

### M.3 · Authorisation probing

14. Create two test users (A and B); compose a decision as A; from B's session, try to:
    a. GET A's decision via `/api/decisions/{id}` · expect 404.
    b. POST a vote to A's decision · expect 404.
    c. DELETE A's decision · expect 404.
    d. List all decisions and look for any of A's · expect not present.
15. Try to set `Authorization: Bearer <A's token>` from B's account · already covered by JWT signature, but verify.
16. Try the same with a forged `operator: true` claim · expect signature rejection.

### M.4 · Business-logic probing

17. As A, vote on day 1, then PATCH the vote on day 14 · expect 422 (corrections only same-day before midnight local).
18. As A, vote on day 1, then PATCH the vote on day 1 at 23:59 local · expect 200.
19. As A, try to read B's vote on day 10 of a 30-day decision · expect 404 (RLS).
20. As A, try to read B's vote on the verdict day · expect 200 (RLS allows post-reveal).
21. Try to compose a paid decision with `participant_count = 7` · expect 422.
22. Try to compose a decision with `duration_days = 400` on Couple plan · expect 422 (max 365).
23. Try to compose a decision with `duration_days = 5` · expect 422 (min 7).
24. Try to submit a 3001-character note · expect 422.
25. Try to submit two votes on the same day from the same participant · expect 409 or upsert.
26. Try the "first free decision" hop: create account A, use free decision, delete A, recreate A with same email · expect free flag still consumed.

### M.5 · Injection probing

27. Inject `<script>alert(1)</script>` in display name · expect escaped in every render path (vote page, verdict page, account page, admin page).
28. Inject `<img src=x onerror=alert(1)>` in note body · same.
29. Inject `'; DROP TABLE votes; --` in question text · expect parameterised binding; no SQL effect.
30. Submit a body with `__proto__` pollution payload · expect rejection by Pydantic.
31. CSRF: try to POST `/api/decisions` from `https://evil.example.com` with `credentials: include` · expect 403.

### M.6 · Infrastructure probing

32. Try to access `/admin/*` from a non-operator JWT · expect 403.
33. Try `GET /api/health` unauthenticated · expect 200.
34. Try to access Stripe webhook endpoint with a forged signature · expect 401.
35. Try to upload a file to the R2 bucket root unauthenticated · expect 403.
36. Try to read another customer's backup signed-URL after expiry · expect 403.

### M.7 · Privacy controls

37. Reject cookies on the marketing site; reload; capture network requests · expect no GA, no Meta, no PostHog hits.
38. Sign in and visit the in-app surface; capture network requests · expect no analytics hits regardless of consent state.
39. Trigger a synthetic `priv`-tagged Sentry error; attempt to compose a new decision · expect 503 maintenance mode.
40. Submit a data-export request as a test user · expect ZIP delivery within 24 hours (target) or 30 days (SLA).
41. Submit a deletion request as a test user; cancel within the 24h window · expect the account is restored.

### M.8 · Email and webhooks

42. Send a Stripe webhook with an old signature · expect rejection.
43. Replay a known-good Stripe webhook · expect idempotency (second one is a no-op).
44. Send a Brevo webhook from a spoofed source · expect rejection (per the integration's signature check).
45. Send an email from an unauthorised domain pretending to be `counsel.day` · expect quarantine by major receivers (DMARC).

### M.9 · Operational controls

46. Trigger the Stripe 5%-failure kill switch by simulating failed charges · expect new-payment endpoint returns 503.
47. Trigger the Anthropic 3-consecutive-failure kill switch by mocking failures · expect verdict-generation endpoint returns 503 and apology emails are queued.
48. Restore a backup to a clean Postgres instance and run the smoke-test suite · expect all tests pass.
49. Rotate the Anthropic API key during a live verdict-generation request · expect the in-flight request to succeed using the old key (24h overlap), and the next request to use the new key.

---

## N · Audit cadence

| Activity | Cadence | Owner | Last done |
|---|---|---|---|
| OWASP ASVS Level 2 self-checklist | Quarterly | Founder | Not yet |
| Run this script (sections M.1-M.9) | Quarterly + every major release | Founder | Not yet |
| Dependency vulnerability sweep | Weekly (automated via Dependabot) | CI | Continuous |
| Backup restore test | Weekly | Cron + alerting | Not yet |
| Secret rotation | Anthropic 60d, Stripe/Auth0/Brevo 90d | Infisical + cron | Not yet |
| Sub-processor list audit | Monthly | Founder | Not yet |
| Operator-action audit log review | Weekly (Sunday digest) | Founder | Not yet |
| Third-party penetration test | At every major release once revenue > USD 5K/month | Aura Information Security (NZ) or equivalent | Not yet |
| Incident runbook drill | Annually | Founder | Not yet |
| DMARC report review | Monthly | Founder | Not yet |

---

## O · Known gaps to close before launch

These items are 🔴 in the tables above and must be addressed before opening to paying customers.

1. **Automated tests** for the RLS policies on `votes`, `notes`, `decisions`, `verdicts`. No defence is real until a test asserts it.
2. **Cypress E2E** for session cookie attributes, CSRF protection, post-logout token revocation.
3. **CI dependency scan** with severity threshold; block merge on high/critical.
4. **Trivy** scan of every container image in CI.
5. **Linter rule** banning string-built SQL (no `f"SELECT ..."`).
6. **CORS allow-list** explicit configuration in FastAPI; no wildcard with credentials.
7. **Webhook idempotency** check in the Stripe handler.
8. **Sentry scrubbing test** that asserts vote/note/question content does not appear in error reports.
9. **R2 bucket public-access test** that asserts unauthenticated reads return 403.
10. **The incident runbook** at `docs/INCIDENT_RUNBOOK.md` (referenced by Privacy Policy § 11).
11. **The DPIA** at `docs/DPIA.md` (required because we process emotionally-sensitive data).
12. **The Record of Processing Activities** at `docs/RoPA.md` (GDPR Art. 30).
13. **First independent pen test** commissioned at revenue threshold.

The order of operations: write the tests first; the tests verify the defences; the defences then have observable proof.

---

## P · Reporting a vulnerability

External reports go to `security@counsel.day`. Acknowledged within one business day. Public disclosure 90 days after fix is deployed, in line with industry norms. No bug bounty at launch; informal recognition until revenue justifies a formal program.

---

## How this document is maintained

- Updated on every release.
- Reviewed in the weekly Sunday digest pass.
- 🔴 items get a target date for resolution; the date is tracked here in the table.
- 🟡 items get tested; when the test passes in CI, the status moves to ✅.
- This file is the operator's working ledger. It is not customer-facing; the customer-facing version is the engineering blog at [`/engineering/the-privacy-mechanism`](../counsel-day-complete/engineering/the-privacy-mechanism.html).
