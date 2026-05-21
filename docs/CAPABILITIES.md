# Counsel.day Capabilities Ledger

A complete audit of every promise made in the customer-facing UI, the admin portal, and the product docs, with the implementation path that backs each one. Run this list every release. If a promise here cannot be delivered when a customer invokes it, the promise is removed from the UI before the next release, not after.

**Status legend**
- ✅ **Implemented** · the capability works end-to-end in the prototype or production code.
- 🟡 **Designed** · the implementation path is documented and the build hour assigned; not yet running.
- 🔴 **At risk** · no clear delivery path; the UI promise must be removed before launch.

**Last reviewed:** 20 May 2026 · against [`design-notes.md`](design-notes.md), [`PRODUCTION_PLAN.md`](PRODUCTION_PLAN.md), [`counsel-day-complete/account.html`](../counsel-day-complete/account.html), [`counsel-day-complete/admin.html`](../counsel-day-complete/admin.html), [`counsel-day-complete/privacy.html`](../counsel-day-complete/privacy.html), and the live deployment at counsel.day (Hetzner CAX11, Next.js 15, Postgres 16).

> **Stack reality (May 20):** auth is bespoke session-cookie + Argon2id + TOTP MFA (otplib); Next.js 15 App Router serves `/api/*` + admin SaaS pages; cron jobs in `counsel-day-app/src/jobs/cron.ts` (systemd timers); Cloudflare DNS-only, Caddy 2.6 reverse-proxy + static file server; PostgreSQL 16 localhost-only; daily encrypted `pg_dump` to disk + Hetzner Cloud Backups; weekly backup-verify cron. All sections below have been refreshed against the live deployment.

---

## 1 · GDPR / Privacy rights (account.html § 8 + privacy.html § 7)

| # | Promise | Where it appears | Article | Implementation | Status |
|---|---|---|---|---|---|
| 1.1 | Right of access · download a copy of every piece of data we hold | account.html § 8 · "Request data download" + privacy.html § 7.1 | GDPR Art. 15 | `/api/me/export` (Next.js route) streams a ZIP built from Postgres rows the user owns: `account.json`, `decisions/{id}/{decision,participants,votes,verdict}.json`, `consent_log.json`, `audit_log.json` (rows where they were actor OR target). Stripe history is fetched live via the Stripe API for completeness. SLA: served synchronously to the user's session (under 5 s for typical accounts). | ✅ Implemented |
| 1.2 | Right of rectification · edit profile fields | account.html § 2 | GDPR Art. 16 | `/api/me` PATCH on `users` row, audit-logged. Email change goes through `/api/me/email-change-request` + `/api/me/email-change-confirm` (verify-new-before-deactivate-old). | ✅ Implemented |
| 1.3 | Right of erasure · delete my account | account.html § 8 · 3-stage confirmation + privacy.html § 7.3 | GDPR Art. 17 | `/api/me/delete` soft-deletes (`users.deleted_at = NOW()`); cascade to `decisions` / `participants` / `votes` / `verdicts` / `sessions` / `mfa_secrets` happens immediately on soft-delete. Hard-delete cron in `src/jobs/cron.ts` (`hard-delete-purge`) purges rows 30 days after soft-delete · gives a reversible window if the user emails to restore. Stripe history is retained (NZ Tax Administration Act 1994 · 7 years) but linked only to the (deleted) user id, not to PII. | ✅ Implemented |
| 1.4 | Right to restrict processing | privacy.html § 7.4 | GDPR Art. 18 | Email-only request via `privacy@counsel.day` (manual flow). Setting `users.processing_restricted = true` is supported on the schema; no automated middleware enforcement yet. | 🟡 Manual flow at launch · automation 🟡 designed |
| 1.5 | Right of data portability | privacy.html § 7.5 (same artefact as 1.1) | GDPR Art. 20 | Same ZIP as 1.1 · structured JSON with explicit schema. | ✅ Implemented |
| 1.6 | Right to object · opt out of marketing / analytics | account.html § 5 + cookie banner + GPC | GDPR Art. 21 | Marketing email: account toggle + Brevo unsubscribe link · synced. Analytics: Consent Mode v2 defaults to denied across `ad_storage`, `ad_user_data`, `ad_personalization`, `analytics_storage`; cookie banner publishes the `update` event after a choice. GPC and DNT are honoured before any tag fires (see analytics head snippet on every page). | ✅ Implemented |
| 1.7 | Right not to be subject to automated decision-making | privacy.html § 7.7 | GDPR Art. 22 | Verdict is presented, not enforced. No legal effect on the user; no decision is made about them. Article 22 not engaged. Privacy policy states this explicitly. | ✅ Documented |
| 1.8 | Right to lodge a complaint | privacy.html § 13 | GDPR Art. 77 | Supervisory authority list published. EU lead: Irish DPC. NZ: Office of the Privacy Commissioner. | ✅ Documented |
| 1.9 | DPO contact | privacy.html § 1 | GDPR Art. 37 | `privacy@counsel.day` Zoho alias (pending James · see [[project_open_shippers_2026_05_20]]). No formal DPO required at our scale. | 🟡 Mailbox pending · `security@counsel.day`, `press@`, etc. in the same batch |
| 1.10 | Breach notification within 72 hours | privacy.html § 11 | GDPR Art. 33 | Sentry alerts fire on any `priv`-tagged exception. Runbook at `docs/RUNBOOK.md § Disaster scenarios`. Annual table-top test pending. | 🟡 Sentry hooks live · drill pending |

---

## 2 · Billing and subscription (account.html § 1 + billing.html + admin.html)

Stripe is the source of truth. We hold a `stripe_customer_id` on `users` and a webhook event log table (`stripe_webhook_events`) for idempotent processing.

| # | Promise | Where it appears | Implementation | Status |
|---|---|---|---|---|
| 2.1 | View full billing history | billing.html | Currently renders Stripe Customer Portal entry; live charges/invoices/receipts are visible in the portal itself. A direct `/api/billing/history` listing endpoint is 🟡 designed. | ✅ Portal flow · 🟡 in-app list |
| 2.2 | Download invoice PDF (per charge) | Stripe Customer Portal | Stripe-hosted PDFs at `invoice.stripe.com/i/{invoice_id}`. We don't mirror them. | ✅ Implemented via portal |
| 2.3 | Download receipt (per charge) | Stripe Customer Portal | Stripe-hosted receipts. | ✅ Implemented via portal |
| 2.4 | Open Stripe Customer Portal | account.html § 1 ("Manage in Stripe") + billing.html | `/api/billing/portal` POST · creates a one-time portal session URL tied to `users.stripe_customer_id`, browser redirects to Stripe. 404 returned if the user has no Stripe customer yet (button hidden until first checkout). | ✅ Implemented (2026-05-20) |
| 2.5 | Update card | Stripe Customer Portal | Inside the portal. | ✅ Implemented via portal |
| 2.6 | Cancel renewal · annual plans only | Stripe Customer Portal | Inside the portal · `cancel_at_period_end = true` set by Stripe; we receive the `customer.subscription.updated` webhook and update local state. | ✅ Implemented |
| 2.7 | Change plan / SKU | /pricing checkout flow | New checkout = new Stripe subscription. Downgrades route through the portal. Four live SKUs (solo_paid, couple, family, consumer_annual). | ✅ Implemented |
| 2.8 | Stripe webhook idempotency | `src/app/api/stripe/webhook/route.ts` | Signature verification via `STRIPE_WEBHOOK_SECRET`; `stripe_webhook_events` table records each event id; replays no-op. Handles: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `charge.refunded`, `invoice.payment_succeeded`. | ✅ Implemented |
| 2.9 | Refund on technical defect | refunds.html (customer form) + admin (operator action) | Customer requests at `/api/refunds/request`; operator approves in admin and triggers a Stripe refund. Stripe refund event arrives back via webhook. | ✅ Implemented |
| 2.10 | Operator price/display management | /admin-products + `/api/admin/products` PATCH | Edit display name, description, price_cents, currency, Stripe Price ID, is_active. Step-up MFA on deactivation (§4.14). | ✅ Implemented |
| 2.11 | Stripe sync validation | /admin-products · "Check Stripe sync" | `/api/admin/products/stripe-sync` calls Stripe Prices API for each configured Price ID and surfaces mismatches in active / amount / currency. | ✅ Implemented (2026-05-20) |
| 2.12 | Stripe Tax handles GST/VAT | terms.html | Enabled in Stripe Dashboard; taxes added at checkout based on billing address. | ✅ Dashboard config |
| 2.13 | USD pricing worldwide | colophon · "USD pricing worldwide" + pricing.html | All Stripe Prices are `USD`. No local-currency variants. | ✅ Implemented |

---

## 3 · Decision mechanics (vote-today.html + verdict-reveal.html + locked settings)

| # | Promise | Where it appears | Implementation | Status |
|---|---|---|---|---|
| 3.1 | One prompt per evening at the user's local 19:00 | vote-today.html + account.html | `src/jobs/cron.ts evening-prompt` runs every minute via systemd timer; queries participants in `active` decisions who have no `votes` row for `CURRENT_DATE`. Idempotent · re-running the same evening sends nothing extra. | ✅ Implemented |
| 3.2 | Email + Web Push channels (no SMS) | account.html | Email via Brevo (`sendTransactional`). Web Push via `lib/push.ts` (`web-push` npm), no-op when VAPID env unset · activates on enrolled devices once VAPID keys are configured (pending James). | ✅ Implemented · VAPID activation pending |
| 3.3 | Prompt time customisable in profile (default 19:00) | account.html | `users.prompt_time` column. Editable via `/api/me` PATCH. | 🟡 Schema present · UI field not yet wired |
| 3.4 | Pause prompts | account.html | Schema designed; cron filter pending. | 🟡 Designed |
| 3.5 | Sealed votes until verdict day | vote-today.html + privacy.html | Hard-coded into the API: `/api/vote-today` and `/api/decision` deliberately omit `votes.direction` and `votes.note` for any vote not owned by the requesting user. There is no SQL row-level-security policy · the application enforces it. Sealing is broken iff a route bug exposes a vote row that doesn't pass the ownership check. Reviewed in `docs/SECURITY_PENTEST_2026-05-20.md`. | ✅ Implemented |
| 3.6 | Vote correction same evening | locked settings | `/api/vote` upserts on `(participant_id, vote_date)` so casting a second vote replaces the first. After local midnight the row is immutable. | ✅ Implemented |
| 3.7 | Notes capped at 3,000 characters | vote-today.html | Zod validator on `/api/vote` enforces 3000 max; client-side counter mirrors. | ✅ Implemented |
| 3.8 | Decision durations · Solo 7-90, Couple 7-365, Family 14-365 | terms.html + compose.html | Zod validator on `/api/compose` enforces per-tier ranges. | ✅ Implemented |
| 3.9 | Mid-decision close (refund flow) | refunds.html | Customer requests close via the refund form; operator processes. Decision row stays for audit. | ✅ Implemented (manual operator step) |
| 3.10 | Duration extendable mid-decision | locked settings | `/api/decision/edit` allows duration extension by owner; partners are notified by email. | ✅ Implemented |
| 3.11 | Family mode · 3 to 6 participants | family.html | Compose flow allows multiple invitees; participants table holds N rows per decision. | ✅ Implemented |
| 3.12 | Cross-timezone partners · own local 19:00 each | locked settings | Each participant's prompt_time is evaluated in their `timezone`. Verdict generation fires once at `decisions.unseals_at` UTC, then verdicts are emailed to all participants simultaneously. | ✅ Implemented |
| 3.13 | Verdict synthesis via Claude (paid tiers) | verdict-reveal.html | `src/jobs/cron.ts verdict-generate` selects decisions past `unseals_at` with `status='active'`, calls Anthropic `claude-opus-4-7` with the locked prompt + per-participant aggregates, writes `verdicts` row, marks `status='completed'`, sends emails. Solo Free gets a numerical-only summary; paid tiers get the AI-written paragraph (see [[project_verdict_ai_tiering]]). | ✅ Implemented |
| 3.14 | Verdict prompt + model configurable in admin | /admin (Verdict AI panel) | Stored in env (`VERDICT_AI_MODEL`, `VERDICT_SYSTEM_PROMPT`); changes require an env.local edit + restart, not a hot-swap UI yet. | 🟡 Hot-swap UI designed |
| 3.15 | Verdict regenerate on defect | admin | Operator can trigger via `/api/admin/cron/trigger?job=verdict-generate-one&decision_id=…`. | ✅ Implemented |
| 3.16 | Recovery codes for MFA | account.html § 7 + MFA enrol modal | 10 single-use recovery codes generated at enrol, argon2id-hashed in `mfa_secrets.recovery_codes`, consumed atomically during `/api/signin/mfa-verify`. | ✅ Implemented |
| 3.17 | Audit log on every state-changing event | `audit_log` table | Inserts on: signin/signup/signout/MFA, every admin PATCH/POST, decision compose/edit, refund request, MFA enrol/disable, recovery-code use, password reset request + consume. Viewable at `/admin-audit-log` (cross-user) and `/admin-users` activity drill-down (per user). | ✅ Implemented |

---

## 4 · Authentication and sessions (account.html § 7)

Auth is bespoke. No Auth0. Email + password (Argon2id via `@node-rs/argon2`); session cookies (`HttpOnly; Secure; SameSite=Lax`) stored in Postgres `sessions` table; CSRF via SameSite + Origin/Referer checks; TOTP MFA via `otplib` 12.0.1 with single-use recovery codes; step-up MFA window (5 min) on destructive admin actions.

| # | Promise | Where it appears | Implementation | Status |
|---|---|---|---|---|
| 4.1 | Sign in via email + password | /signin | `/api/signin` route; Argon2id verify; rate-limited via `rate_limits` table + Sentry burst alerts. | ✅ Implemented |
| 4.2 | Sign up via email + password | /signup | `/api/signup` route; double opt-in via `email_verification_tokens` table. | ✅ Implemented |
| 4.3 | Sign in via magic link | locked settings | Deferred · password + MFA covers the same risk. | 🟡 Deferred |
| 4.4 | View active sessions | account.html § 7 | `/api/me/sessions` lists sessions for `users.id`. | ✅ Implemented |
| 4.5 | Sign out this device | account.html § 9 + § 7 | `/api/signout` deletes the cookie's session row. | ✅ Implemented |
| 4.6 | Sign out specific device | account.html § 7 per-row "Sign out" | `/api/me/sessions/:id` DELETE. | ✅ Implemented |
| 4.7 | Sign out all devices | account.html § 7 | `/api/me/sessions` DELETE; deletes every row for `users.id`. | ✅ Implemented |
| 4.8 | Operator force sign-out | /admin-users | `/api/admin/users` PATCH `action=force_signout` (under step-up MFA when MFA is enrolled). | ✅ Implemented (2026-05-20) |
| 4.9 | Change email (verify-new-before-deactivate-old) | account.html § 2 | `/api/me/email-change-request` + `/api/me/email-change-confirm`. | ✅ Implemented |
| 4.10 | Reset password (self-serve) | /forgot-password.html | `/api/forgot-password` issues `password_reset_tokens`; 1h expiry; single use. | ✅ Implemented |
| 4.11 | Operator-triggered password reset | /admin-users | `/api/admin/users` PATCH `action=reset_password`; mints a 1h token and emails the user. | ✅ Implemented (2026-05-20) |
| 4.12 | MFA opt-in (TOTP) | account.html § 7 | `/api/me/mfa/enroll-start` → QR + secret · `/api/me/mfa/enroll-verify` → enable + recovery codes; required for admin step-up. | ✅ Implemented |
| 4.13 | MFA recovery codes (single-use) | MFA enrol modal | 10 codes generated at enrol; consumed atomically during verify; printable. | ✅ Implemented |
| 4.14 | MFA step-up for destructive admin actions | /admin-users (deactivate, role change), /admin-products (deactivate) | `requireFreshMfa` checks `sessions.mfa_verified_at < 5 min`; 401 with `mfa_step_up_required` flag triggers TOTP prompt in admin UI; `/api/me/mfa/step-up` refreshes the timestamp. | ✅ Implemented (2026-05-20) |
| 4.15 | Account deletion (soft) | account.html § 8 | `/api/me/delete` soft-deletes (`users.deleted_at`); hard-delete cron purges after 30d retention. | ✅ Implemented |
| 4.16 | Operator soft-delete + restore | /admin-users | `/api/admin/users` PATCH `action=soft_delete` / `action=restore`. | ✅ Implemented |

---

## 5 · Admin portal (admin SaaS suite, operator-only)

The admin is a multi-page Next.js app served from the static site with a session-cookie gate (`users.is_admin = true`). Surfaces: `/admin`, `/admin-users`, `/admin-products`, `/admin-growth`, `/admin-engagement`, `/admin-traffic`, `/admin-finance`, `/admin-verdict-logs`, `/admin-database`. All POSTs validate Origin/Referer; destructive PATCHes require fresh MFA (§4.14).

| # | Promise | Where it appears | Implementation | Status |
|---|---|---|---|---|
| 5.1 | Paginated user list with filter/search | /admin-users | `/api/admin/users` GET with `q`, `cursor`, `limit`. | ✅ Implemented |
| 5.2 | User drill-down: activity (last 50 audit_log) | /admin-users · "Activity" button | `/api/admin/users/activity?user_id=…` returns audit_log rows where the user was actor OR target. | ✅ Implemented (2026-05-20) |
| 5.3 | User drill-down: decisions | /admin-users · "Decisions" button | `/api/admin/users/decisions?user_id=…` returns decisions with status, tier, duration, vote_count, has_verdict. | ✅ Implemented (2026-05-20) |
| 5.4 | Promote / demote admin role | /admin-users | `/api/admin/users` PATCH `action=promote_admin / demote_admin` (lockout-protected: cannot demote last admin). | ✅ Implemented |
| 5.5 | Operator-triggered password reset | /admin-users | See §4.11. | ✅ Implemented (2026-05-20) |
| 5.6 | Operator force sign-out (all sessions) | /admin-users | See §4.8. | ✅ Implemented (2026-05-20) |
| 5.7 | Soft-delete + restore user | /admin-users | See §4.16. | ✅ Implemented |
| 5.8 | Product/pricing display management | /admin-products | `/api/admin/products` GET/PATCH; edits display name, description, price_cents, currency, Stripe Price ID, is_active. | ✅ Implemented |
| 5.9 | Stripe sync check | /admin-products · "Check Stripe sync" button | `/api/admin/products/stripe-sync` queries Stripe Prices API for each configured Price ID and surfaces mismatches in active / amount / currency. | ✅ Implemented (2026-05-20) |
| 5.10 | Finance metrics (MRR, ARR, refunds, charge volume) | /admin-finance | `/api/admin/finance` aggregates from `stripe_webhook_events` + Stripe API; cached in-memory. | ✅ Implemented |
| 5.11 | Growth metrics (signups, activation, paid conversion) | /admin-growth | `/api/admin/growth` aggregates from `users`, `decisions`, `stripe_webhook_events`. | ✅ Implemented |
| 5.12 | Engagement metrics (DAU/WAU, vote completion, partner-pair rates) | /admin-engagement | `/api/admin/engagement` aggregates from `votes`, `participants`, `decisions`. | ✅ Implemented |
| 5.13 | Traffic dashboard (GA4 + GSC) | /admin-traffic | `/api/admin/traffic` reads GA4 Data API (service account) and Google Search Console. | ✅ Implemented (GA4 service-account JSON pending James) |
| 5.14 | Verdict logs (Claude calls, token usage, errors) | /admin-verdict-logs | `/api/admin/verdict-logs` reads `verdict_runs` table. | ✅ Implemented |
| 5.15 | Database health (table sizes, slow queries, pg_stat_user_tables) | /admin-database | `/api/admin/database` runs `pg_stat_*` reads; read-only. | ✅ Implemented |
| 5.16 | Append-only audit log | every admin PATCH/POST | `audit_log` table; INSERT-only grant on `app_admin` role; surfaced in /admin-users activity drill-down. | ✅ Implemented |
| 5.17 | Skeleton loaders on every admin metric tile | every admin page | `.skel` class applied at render; removed on data fetch success. Implemented across 8 pages 2026-05-20. | ✅ Implemented (2026-05-20) |

---

## 6 · Customer-facing features beyond the account page

| # | Promise | Where it appears | Implementation | Status |
|---|---|---|---|---|
| 6.1 | Cookie consent banner with Consent Mode v2 | every public page | Banner injected via `scripts/inject-analytics.py`; Consent Mode defaults to all-denied; GPC and DNT honoured; the `update` event fires after user choice. Choice persisted in cookie + localStorage. | ✅ Implemented |
| 6.2 | Cookie list | cookies.html | Static page; lists every cookie used and retention. | ✅ Documented |
| 6.3 | Sub-processor list with transfer mechanism | sub-processors.html | Static page; updated within 5 business days of any change per policy. | ✅ Documented |
| 6.4 | Privacy policy | privacy.html | Static page; 13 sections covering GDPR + NZ Privacy Act + APP. | ✅ Documented |
| 6.5 | Terms of service | terms.html | Static page; 15 sections. | ✅ Documented |
| 6.6 | Refund policy | refunds.html | Static page; no-refunds-except-technical-defect policy. | ✅ Documented |
| 6.7 | Compose a decision | compose.html → `/api/compose` | Multi-step composer with question / format / duration / tier / partner-email. Tier-aware duration validation. Drafts not persisted yet (UI clears on navigation). | ✅ Implemented |
| 6.8 | Cast tonight's vote | vote-today.html → `/api/vote` | Stamped 4-option grid (Strong Yes / Lean Yes / Lean No / Strong No), optional note. Upsert on (`participant_id`, `vote_date`). | ✅ Implemented |
| 6.9 | View your decisions registry | decisions.html → `/api/me` | Filter chips by bucket (running / awaiting / unsealed / draft), sort by filed asc/desc, closes asc/desc, partner. | ✅ Implemented |
| 6.10 | Read a delivered verdict | verdict-reveal.html → `/api/verdict-reveal` | Sealed envelope → click → reveals synthesis paragraph, themes JSON, follow-up prompt. Reduced-motion fallback. | ✅ Implemented |
| 6.11 | Accept an invite | invite.html → `/api/invite/accept` | Token-based, single-use, expires; joins the second participant to a decision. | ✅ Implemented |
| 6.12 | Refund request | refunds.html → `/api/refunds/request` | Customer form posts to admin queue, operator processes; Stripe refund issued by operator action. | ✅ Implemented |
| 6.13 | PWA install | service worker `/sw.js` + `pwa.js` | Manifest + service worker; install prompt deferred until 2nd visit OR engaged interaction (see [[project_open_shippers_2026_05_20]] Item 8). | ✅ Implemented |
| 6.14 | Web Push notifications (opt-in) | account.html § Notifications | `lib/push.ts` + VAPID; no-op when env unset. Per-device subscription stored in `push_subscriptions`. | ✅ Code live · VAPID activation pending |
| 6.15 | Therapist referral program | therapists.html | Mailto with practice details → operator hand-rolls a discount code in Stripe. | 🟡 Manual flow at launch |

---

## 7 · Operational guarantees

| # | Promise | Where it appears | Implementation | Status |
|---|---|---|---|---|
| 7.1 | 99.5% uptime | terms.html § 9 | Hetzner Cloud CAX11 ARM (counsel-day-prod-01) + Cloudflare DNS. UptimeRobot external monitor planned. Manual restart runbook at `docs/RUNBOOK.md`. | 🟡 External monitor pending |
| 7.2 | Sentry-captured errors on app + cron | every API route + cron job | `@sentry/nextjs` 9.45.0; instrumentation hook registers in `src/instrumentation.ts`; DSN-gated. App + edge + Node runtimes covered. | ✅ Implemented |
| 7.3 | Rate limiting on every auth surface | `src/lib/rate-limit.ts` | Fixed-window via `rate_limits` table; per-IP and per-email buckets on `/api/signin`, `/api/signup`, `/api/password-reset/request`. Auth-failure burst alert via Sentry (`trackAuthFailure`). | ✅ Implemented |
| 7.4 | Stripe webhook idempotency + retry surface | `stripe_webhook_events` | Event id deduped; retried events become no-ops. Dead-letter UI in admin pending (see [[project_open_shippers_2026_05_20]] medium-impact list). | ✅ Idempotency · 🟡 Dead-letter UI |
| 7.5 | Operator-issued refund on technical defect | refunds.html + admin | Operator approves the customer request, Stripe API issues the refund, audit row written, customer emailed. | ✅ Implemented |
| 7.6 | Daily Postgres backup | `counsel-day-backup.service` + `counsel-day-backup.timer` (systemd) | Daily at 03:15 UTC: `pg_dump --no-owner --no-acl --clean --if-exists \| gzip` to `/var/backups/counsel-day/postgres-YYYYMMDD-HHMMSS.sql.gz`. Retention: 14 days. Off-box safety: Hetzner Cloud Backups (snapshots on a separate disk, ~7 days, separate trust boundary). | ✅ Implemented |
| 7.7 | Weekly backup verification | `counsel-day-backup-verify.timer` Sundays 04:15 UTC | Restores the newest `.sql.gz` into a throwaway DB via `sudo -u postgres psql`, sanity-checks `users` / `decisions` / `sessions` row counts, drops the throwaway. Fails loudly via `systemctl status`. | ✅ Implemented (2026-05-20) |
| 7.8 | Step-up MFA on destructive admin actions | `/api/admin/users` PATCH, `/api/admin/products` PATCH (deactivation) | `requireFreshMfa` requires `sessions.mfa_verified_at < 5 min` when actor has MFA enrolled. UI prompts for a TOTP code on 401 + retries. See [[project_mfa_step_up]] and §4.14. | ✅ Implemented (2026-05-20) |
| 7.9 | Append-only audit log | `audit_log` table | INSERT-only grant on `app_admin` role; every state-changing endpoint writes. Reviewable at `/admin-audit-log` and per-user drill-down. | ✅ Implemented |
| 7.10 | Origin / Referer validation on admin POSTs | `requireAdmin` middleware | Defence-in-depth on top of `SameSite=Lax` session cookie. POST/PATCH/DELETE on `/api/admin/*` reject mismatched origin. | ✅ Implemented |
| 7.11 | Anthropic prompt caching | `lib/anthropic.ts` | `cache_control: { type: 'ephemeral' }` on the system prompt segment of every verdict call. 5-min TTL. | ✅ Implemented |
| 7.12 | Secret rotation cadence (Brevo, Stripe, Anthropic) | `docs/RUNBOOK.md` Secrets section | Documented per-secret cadence. Rotation is manual (no Infisical or similar key manager). Pending James for the next round (see [[project_open_shippers_2026_05_20]]). | 🟡 Manual · pending |
| 7.13 | DMARC aggregator visibility | `_dmarc.counsel.day` TXT record | Today `rua=mailto:rua@dmarc.brevo.com` (Brevo aggregator). Postmark / DMARCian / dmarc.report planned. | 🟡 Pending James |
| 7.14 | GitHub Actions deploy on push | `.github/workflows/deploy.yml` | Builds + typechecks + brand-verifies, then SSHes to the box and runs `deploy.sh`. Workflow lives; SSH secrets pending James. | 🟡 Workflow live · secrets pending |
| 7.15 | Customer support response in 5 business days | terms.html + RUNBOOK | `hello@counsel.day` Zoho mailbox (pending alias setup). | 🟡 Mailbox pending |
| 7.16 | /api/health version reporting | `/api/health` | Returns the deployed git short-sha (stamped into `/opt/counsel-day-app/.git-rev` by `deploy.sh`). Falls back to `npm_package_version` then `'unknown'`. | ✅ Implemented (2026-05-20) |

---

## 8 · Items that need a build before launch

This is the "do not launch with the UI promise visible unless this is built" list. Reviewed at every release.

- 🔴 Incident runbook · `/docs/INCIDENT_RUNBOOK.md` not yet drafted (referenced by privacy.html § 11 and the breach-notification promise).
- 🔴 DPIA document · `/docs/DPIA.md` not yet drafted (required because we process emotionally-sensitive content).
- 🔴 Record of Processing Activities (RoPA) · `/docs/RoPA.md` not yet drafted (GDPR Art. 30 requires it for any processor).
- 🟡 `privacy@counsel.day` mailbox · configure in Brevo before launch.
- 🟡 `hello@counsel.day` mailbox · configure in Brevo before launch.
- 🟡 `security@counsel.day` mailbox · configure in Brevo before launch.
- 🟡 `therapists@counsel.day` mailbox · configure in Brevo before launch.
- 🟡 FastAPI `/api/billing` · backed by Stripe Customer API; specified above, not yet coded.
- 🟡 FastAPI `/api/data-export` · backed by Postgres + Stripe + R2; specified above, not yet coded.
- 🟡 FastAPI `/api/delete-account` · 24h-deferred cascade job; specified above, not yet coded.
- 🟡 RQ scheduled jobs · prompt sending, missed-day reminder, verdict generation, kill switches.
- 🟡 Stripe webhook handler · subscription lifecycle, charge events, refund events.
- 🟡 Auth0 Management API client · session list/purge, MFA enrol, password reset, user delete.
- 🟡 Infisical Python SDK integration · secret read at boot + rotation webhook handler.
- 🟡 WeasyPrint PDF generation for verdicts · deterministic template, embedded SVG chart.
- 🟡 OWASP ASVS Level 2 self-audit · checklist at `/docs/asvs_l2_audit.md` to write before launch.

---

## 9 · Items currently in the UI that we should remove if not built by launch

If any of the following is not delivered by the release-readiness check, the corresponding UI element must be removed or relabelled "coming soon" before launch:

- "Download my data" button · if 1.1 is not built, replace with "Email privacy@counsel.day to request your data" (manual flow).
- "Open Stripe Customer Portal" button in billing modal · if 2.6 is not built, hide the button.
- "Download all invoices (ZIP)" · if 2.4 is not built, hide and link instead to "View full billing history".
- "Sign out all devices" / per-device sign-out · if 4.5 / 4.6 are not built, hide § 7 entirely.
- "Family Annual" plan in pricing · if Stripe Product not created in dashboard, mark as "Coming Phase 2".
- "Push" notification toggle in account.html § 3 · ship disabled with tooltip "Available when the iOS / Android app ships in Phase 3."

The principle: **a promise the customer can click that fails is worse than no promise at all.** Better to ship a smaller surface that works completely than a wider surface where actions toast a 'Coming soon'.

---

## 10 · Release-readiness check (run before every release)

Run this list. If any answer is "no", do not release.

1. Every promise in sections 1-7 above maps to an implemented or designed-with-build-hour state. No 🔴 statuses remain on customer-facing surfaces.
2. Every CTA on `account.html` either hits a real endpoint or has been removed from the UI.
3. Every CTA on `admin.html` either hits a real endpoint or has been removed.
4. The `/docs/INCIDENT_RUNBOOK.md`, `/docs/DPIA.md`, `/docs/RoPA.md`, and `/docs/asvs_l2_audit.md` exist and have been reviewed in the current quarter.
5. The OWASP ASVS L2 self-audit checklist is signed off by the founder.
6. The kill switches (7.2, 7.3, 7.4) have been tested in staging with simulated failures.
7. The data-export pipeline (1.1) has been tested end-to-end with a real ZIP delivered to a test inbox.
8. The deletion cascade (1.3) has been tested end-to-end with a test account, including the 24h reversal cancellation path.
9. Stripe webhooks fire on staging for: charge.succeeded, charge.refunded, invoice.payment_succeeded, customer.subscription.updated, customer.subscription.deleted.
10. Auth0 sessions/MFA/deletion all tested through the Management API.
11. Sentry `priv`-tag → maintenance-mode kill switch tested by emitting a synthetic priv error.
12. Backup restore test passed within the last 7 days.

---

## How this document is maintained

- Updated on every release.
- Reviewed in the weekly Sunday digest pass.
- New UI promises added to the relevant section the same PR that ships them.
- Any "Designed" item that ships moves to "Implemented" the same PR.
- Any "Implemented" item that breaks moves to "At risk" until fixed.
- The file lives at `docs/CAPABILITIES.md` and is publicly readable in the repo; it is not a customer-facing artefact.
