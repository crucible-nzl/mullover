# Counsel.day Capabilities Ledger

A complete audit of every promise made in the customer-facing UI, the admin portal, and the product docs, with the implementation path that backs each one. Run this list every release. If a promise here cannot be delivered when a customer invokes it, the promise is removed from the UI before the next release, not after.

**Status legend**
- ✅ **Implemented** · the capability works end-to-end in the prototype or production code.
- 🟡 **Designed** · the implementation path is documented and the build hour assigned; not yet running.
- 🔴 **At risk** · no clear delivery path; the UI promise must be removed before launch.

**Last reviewed:** 20 May 2026 · against [`design-notes.md`](design-notes.md), [`PRODUCTION_PLAN.md`](PRODUCTION_PLAN.md), [`counsel-day-complete/account.html`](../counsel-day-complete/account.html), [`counsel-day-complete/admin.html`](../counsel-day-complete/admin.html), [`counsel-day-complete/privacy.html`](../counsel-day-complete/privacy.html), and the live deployment at counsel.day (Hetzner CAX11, Next.js 15, Postgres 16).

> **Stack changes since the original draft (May 14):** auth moved off Auth0 to bespoke session-cookie + Argon2id + TOTP MFA (otplib); FastAPI/RQ replaced by Next.js 15 App Router + cron jobs in `counsel-day-app/src/jobs/cron.ts`; Cloudflare R2 replaced by Hetzner Cloud Backups (server-level rolling snapshots) plus daily encrypted `pg_dump`; static site lives at `counsel-day-complete/` served by Caddy 2.6 with forward-auth. Items in §4 and §5 below reflect the new stack; older sections still cite legacy plans pending a full rewrite.

---

## 1 · GDPR / Privacy rights (account.html § 8 + privacy.html § 7)

| # | Promise | Where it appears | Article | Implementation | Status |
|---|---|---|---|---|---|
| 1.1 | Right of access · download a copy of every piece of data we hold | account.html § 8 · "Request data download" + privacy.html § 7.1 | GDPR Art. 15 | Background job reads from Postgres (decrypts per-decision keys via Infisical) + Stripe Customer API; assembles ZIP with `account.json`, `decisions/{id}/{decision,votes,notes,verdict}.json`, `verdict.pdf`, `billing/charges.json`, `schema.md`; uploads to Cloudflare R2 with a 7-day signed URL; emails the URL to the user. SLA: 30 days max, target 24 hours. | 🟡 Designed · backed by data-architecture post §7 export shape |
| 1.2 | Right of rectification · edit profile fields | account.html § 2 · Display name + country dropdowns | GDPR Art. 16 | Direct UPDATE on `users` row via FastAPI authenticated endpoint, audit-logged. Email change goes through Auth0 (verify-new-before-deactivate-old). | 🟡 Designed |
| 1.3 | Right of erasure · delete my account | account.html § 8 · 3-stage confirmation + privacy.html § 7.3 | GDPR Art. 17 | Three-stage UI confirmation already implemented in account.html. On final confirm: enqueue a 24-hour-deferred deletion job; cascade through `users` / `decision_participants` / `votes` / `notes` / `verdicts` / `invitations` / `notification_log` / `cookie_consents` plus Auth0 user deletion via Management API. Billing rows in `stripe_charges` have user_id severed but retained 7 years (NZ Tax Administration Act 1994). Backups expire within 30 days. | ✅ UI prototype · 🟡 Backend designed |
| 1.4 | Right to restrict processing | privacy.html § 7.4 | GDPR Art. 18 | Email-only request flow. On receipt: set `users.processing_restricted = true`; FastAPI middleware rejects any non-read endpoint while flag is set. 5-business-day response SLA. | 🟡 Designed |
| 1.5 | Right of data portability | privacy.html § 7.5 (same artefact as 1.1) | GDPR Art. 20 | Same ZIP as 1.1; JSON schema published at `/engineering/the-data-architecture` so a future tool could import it. | 🟡 Designed |
| 1.6 | Right to object · opt out of marketing / analytics | account.html § 5 + cookie banner | GDPR Art. 21 | Marketing email: Brevo unsubscribe + account toggle, syncs via Brevo webhook. Analytics: cookie banner sets `counselday_consent='reject'` in localStorage; GTM container reads consent before firing any non-essential tags. Consent Mode v2 on. | ✅ UI prototype · 🟡 Backend designed |
| 1.7 | Right not to be subject to automated decision-making | privacy.html § 7.7 | GDPR Art. 22 | Verdict is presented, not enforced. No legal effect on the user; no decision is made about them. Article 22 not engaged. Privacy policy states this explicitly. | ✅ Documented |
| 1.8 | Right to lodge a complaint | privacy.html § 13 | GDPR Art. 77 | Supervisory authority list published. EU lead: Irish DPC. NZ: Office of the Privacy Commissioner. | ✅ Documented |
| 1.9 | DPO contact | privacy.html § 1 | GDPR Art. 37 | `privacy@counsel.day` routed to operator. No formal DPO required at our scale. | 🟡 Mailbox to configure in Brevo |
| 1.10 | Breach notification within 72 hours | privacy.html § 11 | GDPR Art. 33 | Runbook in `/docs/INCIDENT_RUNBOOK.md` (to be written before launch). Test annually. | 🔴 Runbook not yet written |

---

## 2 · Billing and subscription (account.html § 1 + admin.html § 3-4)

| # | Promise | Where it appears | Implementation | Status |
|---|---|---|---|---|
| 2.1 | View full billing history · all charges, refunds, invoices | account.html § 1 · "View full billing history" | Live read from Stripe Customer API via FastAPI `/api/billing`; cached 60 seconds. Modal already renders the Stripe-shape table. Filter chips, CSV export, "Open Stripe Customer Portal" all working in the prototype. | ✅ UI prototype · 🟡 API endpoint |
| 2.2 | Download invoice PDF (per charge) | Billing modal · "Invoice PDF" link per row | Direct link to Stripe-hosted PDF at `invoice.stripe.com/i/{invoice_id}`. We do not store invoice copies; Stripe is the system of record. | 🟡 Designed (no code, only links) |
| 2.3 | Download receipt (per charge) | Billing modal · "Receipt" link per row | Direct link to Stripe-hosted receipt at `receipt.stripe.com/r/{receipt_id}`. | 🟡 Designed |
| 2.4 | Download all invoices as ZIP | account.html § 1 · "Download all invoices (ZIP)" | Backend zips Stripe-hosted PDFs (fetch each, bundle, sign R2 URL, email link). | 🟡 Designed |
| 2.5 | Export billing as CSV | Billing modal footer | Implemented as a real Blob/download in the JS prototype. Production uses the same `/api/billing` data, server-rendered CSV. | ✅ UI prototype · 🟡 API endpoint |
| 2.6 | Open Stripe Customer Portal | Billing modal footer | Backend calls Stripe `billing_portal.sessions.create`, redirects user to the returned URL. | 🟡 Designed |
| 2.7 | Update card | account.html § 1 · "Update card" | Stripe Elements modal (or Customer Portal). | 🟡 Designed |
| 2.8 | Remove card | account.html § 1 · "Remove" | Blocked while annual subscription is active (warning toast). Otherwise direct Stripe API call. | ✅ UI logic · 🟡 Backend |
| 2.9 | Cancel renewal · annual plans only | account.html § 1 · "Cancel renewal" | Stripe `subscription.update(cancel_at_period_end=true)`. Period-end date and post-cancellation pricing fall-back explained in the cancel modal. | ✅ UI prototype · 🟡 Backend |
| 2.10 | Change plan · 6 SKUs | account.html § 1 · "Change plan" modal + admin.html operator action | Stripe Checkout for upgrades; Stripe Subscription update for downgrades; both audit-logged. All 6 plans wired in the prototype modal. | ✅ UI prototype · 🟡 Backend |
| 2.11 | Refund on technical defect | refunds.html + admin.html § 3 | Operator-issued only (not customer-initiated). Operator clicks refund in admin user-detail, FastAPI calls Stripe `refund.create`. Auto-email sent via Brevo. | 🟡 Designed |
| 2.12 | Change billing email | account.html § 1 · "Use a different email for billing" | Stripe Customer email update via API; does not change the Auth0 sign-in email. | 🟡 Designed |
| 2.13 | Stripe Tax handles GST/VAT | terms.html + account.html § 1 · "Tax region" | Stripe Tax enabled on the account; taxes added at checkout based on billing address. | 🟡 Stripe Dashboard setting |

---

## 3 · Decision mechanics (vote.html + verdict.html + locked settings)

| # | Promise | Where it appears | Implementation | Status |
|---|---|---|---|---|
| 3.1 | One prompt per evening, at your chosen time | vote.html + account.html § 3 | RQ scheduled job runs every minute; queries decisions whose `prompt_time` (in user's tz) matches the current minute; sends one notification per participant per decision per day. Idempotency check prevents duplicate sends. | 🟡 Designed |
| 3.2 | Prompt time customisable in profile (default 19:00) | account.html § 3 | `users.prompt_time` TIME column; user-editable; saved via PATCH. | 🟡 Designed |
| 3.3 | Quiet hours respected | account.html § 3 · "From / to" time pickers | Send job checks user's quiet-hours window before firing. If chosen prompt time falls inside quiet hours, the notification is suppressed for that day. | 🟡 Designed |
| 3.4 | Quiet days (Sat/Sun toggles) | account.html § 3 | Day-of-week checks in send job. | 🟡 Designed |
| 3.5 | Missed-three-days reminder (opt-out) | account.html § 3 | Send job checks engagement; fires once after 3 consecutive missed days; logged so it never fires twice. | 🟡 Designed |
| 3.6 | Pause prompts (travel / hard weeks) | account.html § 3 | `users.prompts_paused_until` DATE column; send job skips while in past. | 🟡 Designed |
| 3.7 | Email + push channels (no SMS) | account.html § 3 | Email via Brevo (transactional). Push via Expo Push (Phase 3 only; falls back to email if push fails). | 🟡 Email designed · Push Phase 3 |
| 3.8 | Sealed votes until verdict day | vote.html + privacy.html | PostgreSQL row-level-security policy on `votes` blocks read of partner's votes while `decisions.verdict_revealed_at IS NULL`. See [engineering/the-privacy-mechanism.html](../counsel-day-complete/engineering/the-privacy-mechanism.html) § 2 for the SQL. | ✅ Documented · 🟡 Coded in Phase 1 Hour 5 |
| 3.9 | Vote correction until midnight | locked settings | Vote UPDATEs allowed where `votes.created_at >= today_local AND verdict_revealed_at IS NULL`. RLS policy enforces. | 🟡 Designed |
| 3.10 | Notes capped at 3,000 characters | vote.html + design-notes § Notes | `CHECK (length(note_body) <= 3000)` on the column. Client-side counter shown live. | ✅ UI prototype · 🟡 Schema constraint |
| 3.11 | Decision durations · Solo 7-90, Couple 7-365, Family 14-365 | terms.html + family.html + locked settings | `CHECK (duration_days BETWEEN min AND max)` per plan in the schema. Composer UI enforces client-side; FastAPI validates server-side. | 🟡 Designed |
| 3.12 | Multi-stage close confirmation (mid-decision close) | locked settings | Three-stage UI confirm; final stage soft-deletes the decision (no refund per Refund Policy). | 🟡 Designed |
| 3.13 | Duration extendable mid-decision | locked settings | Owner can extend via account-page action; new `verdict_scheduled_at` computed; partner notified by email. | 🟡 Designed |
| 3.14 | Family mode · 3 to 6 participants | family.html | `CHECK (participant_count BETWEEN 3 AND 6)` on Family decisions. | 🟡 Designed |
| 3.15 | Cross-timezone partners · own local 19:00 each | locked settings | Each participant has own `prompt_time` + `timezone`. Send job evaluates per participant. Verdict reveal fires once globally at owner's tz midnight. | 🟡 Designed |
| 3.16 | Verdict delivered as HTML + designed PDF | locked settings + verdict.html | Verdict text returned to in-app HTML view; same content piped through WeasyPrint server-side to a designed PDF (Newsreader, Knot mark, embedded trajectory chart). Both delivered by email simultaneously to both participants. | 🟡 Designed |
| 3.17 | Both partners receive verdict at the same minute | locked settings | Single transactional Brevo send to both addresses, queued atomically. | 🟡 Designed |

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
| 6.1 | Cookie consent banner with granular categories | start.html + cookie banner on every marketing page | localStorage `counselday_consent`; reread on every page load before GTM init. | ✅ UI prototype · 🟡 GTM container wiring |
| 6.2 | Read full cookie list with retention | cookies.html | Static page; updated on every sub-processor change. | ✅ Documented |
| 6.3 | Read sub-processor list with transfer mechanism | sub-processors.html | Static page; updated within 5 business days of any change per the policy. | ✅ Documented |
| 6.4 | Read privacy policy | privacy.html | Static page; 13 sections covering GDPR + NZ Privacy Act + APP. | ✅ Documented |
| 6.5 | Read terms of service | terms.html | Static page; 15 sections. | ✅ Documented |
| 6.6 | Read refund policy | refunds.html | Static page; no-refunds-except-technical-defect policy. | ✅ Documented |
| 6.7 | Request a data download | account.html § 8 | See 1.1. | 🟡 Designed |
| 6.8 | Compose a decision | vote.html | FastAPI `/decisions` POST endpoint; multi-step composer UI in Expo (Phase 3). | 🟡 Designed |
| 6.9 | Resume a draft decision | account.html § 6 · "Resume" link | Drafts persisted in `decisions` with state='draft'; resumable from account page. | 🟡 Designed |
| 6.10 | Read a delivered verdict | account.html § 6 · "Read verdict" + verdict.html | HTML render in-app + downloadable PDF (see 3.16). | 🟡 Designed |
| 6.11 | View active decision status | account.html § 6 · "Active · day N of M" | Computed live from `decisions.composed_at` + `duration_days`. | 🟡 Designed |
| 6.12 | Therapist referral program | therapists.html | Mailto with practice details → operator hand-rolls a discount code in Stripe. | 🟡 Manual flow at launch |

---

## 7 · Operational guarantees (PRODUCTION_PLAN.md + design-notes)

| # | Promise | Where it appears | Implementation | Status |
|---|---|---|---|---|
| 7.1 | 99.5% uptime | terms.html § 9 | Hetzner + Cloudflare; Better Stack monitoring; manual restart runbook. | 🟡 Monitoring designed |
| 7.2 | Sentry-tagged privacy errors auto-pause new signups | PRODUCTION_PLAN § kill switches | Sentry webhook → FastAPI maintenance-mode flag. Existing decisions continue. | 🟡 Designed |
| 7.3 | Stripe failure rate > 5% over 30 min → pause payments | PRODUCTION_PLAN § kill switches | Stripe webhook + sliding window in Postgres + maintenance flag. | 🟡 Designed |
| 7.4 | 3 consecutive Anthropic failures → pause verdict delivery | PRODUCTION_PLAN § kill switches | Counter in Redis; reset on first success; on third fail pause + apology email. | 🟡 Designed |
| 7.5 | Operator-issued refund on technical defect (within SLA) | refunds.html | Operator clicks refund in admin; Stripe API call; email confirmation. | 🟡 Designed |
| 7.6 | Weekly Sunday digest email to operator | PRODUCTION_PLAN | RQ cron job aggregating week's metrics. | 🟡 Designed |
| 7.7 | Customer support reply within 5 business days (urgent within 2) | terms.html + locked settings | `hello@counsel.day` Brevo inbox; operator triages weekly. | 🟡 Mailbox to configure |
| 7.8 | Daily encrypted Postgres backup to R2 | PRODUCTION_PLAN Hour 2 | `pg_dump` piped through age-encrypt; uploaded to R2 with 30-day lifecycle. Weekly restore test. | 🟡 Designed |
| 7.9 | Quarterly secret rotation (Anthropic 60d, Stripe/Auth0/Brevo 90d) | design-notes Infisical section | Infisical rotation policy + webhook to FastAPI. | 🟡 Designed |
| 7.10 | Anthropic prompt caching enabled (5-min TTL) | locked settings | `cache_control: ephemeral` on the system prompt portion of every Anthropic call. | 🟡 Designed |
| 7.11 | Verdict regenerated manually within SLA on defect | locked settings + refunds.html | Operator action in admin; one-click rerun. | 🟡 Designed |

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
