# Counsel.day · Production Build Plan

> Working plan for taking Counsel.day from prototype to live, paying-customer product. Authored 2026-05-12 with James as the sole operator at 8 hours in Week 1 and ~1 hour/week sustained thereafter.
>
> The full design and business specifications live in `docs/design-notes.md` and `docs/product-brief.md`. This document is the *operational* plan that turns those specifications into running code on a real domain with real money flowing.

---

## Executive summary

**Product.** Counsel.day: a private-voting product for couples and two-person partnerships making a meaningful joint decision over a period the participants choose. USD 9.99 per paid decision, USD 99 per year for unlimited. Worldwide market, USD pricing, charged once per decision, partner invited free via magic-link.

**Operator.** Solo, James Graham (NZ). 8 hours of focused work in Week 1, ~1 hour/week sustained after that for operations.

**Stack.** Cloudflare Pages (marketing) + Hetzner CPX31 (backend) + PostgreSQL with row-level security + FastAPI + Redis + RQ + Expo / React Native (mobile in Phase 3) + Anthropic Claude (Opus 4.7 + Sonnet 4.6) + Stripe + Brevo + Sentry + Plausible.

**Build philosophy.** Aggressively simple. Managed services where they save time. Automation rails so that 1 hour/week of human oversight is genuinely enough to operate the product safely. Every shortcut taken in Week 1 is documented with a date by which it is reversed.

**First-customer milestone.** End of Week 1: the marketing site is live at counsel.day, the web product takes real Stripe payments worldwide, and a real customer can complete a real thirty-day Yes/No or Strong/Lean decision end-to-end and receive a Claude-generated verdict on day thirty.

---

## Locked stack decisions

| Layer | Choice | Rationale |
|---|---|---|
| Marketing site host | Cloudflare Pages (Free tier) | Free, fast, automatic SSL, deploys on git push. Zero load on the API box. The Free tier is genuinely free; we do NOT use Pro ($25/month) or any paid Cloudflare add-ons. |
| Domain & DNS | Cloudflare Registrar + Cloudflare DNS (Free tier) | `.day` is a Google-registered TLD; Cloudflare Registrar supports it at near-cost (~USD 20-30/year, no markup). Consolidates registrar + DNS + Pages + R2 in one vendor; one fewer account to manage. Cloudflare Free adds CDN, edge DDoS protection, WAF basics, and origin-IP hiding at $0/month. |
| Backend compute | Hetzner CPX31 (€14/month, 4 vCPU, 8GB, 160GB SSD) | EU data residency by default (good for GDPR), competitive pricing, plenty of headroom for the first thousand users. |
| Database | PostgreSQL on the Hetzner box, with row-level security policies | Per design-notes; schema-level privacy enforcement. |
| Backend framework | FastAPI (Python 3.12) | Per design-notes; familiar; strong type-safety via Pydantic. |
| Workers | RQ + Redis | Simpler than Celery for solo. Verdict-generation jobs, scheduled tasks, notification dispatch. |
| Reverse proxy | Caddy | Auto-SSL via Cloudflare DNS challenge; one config file; reliable. |
| Process manager | systemd | Built-in, well-understood, no Docker overhead for v0.1. (Optionally Coolify on top later.) |
| Offsite backups | Cloudflare R2 (encrypted Postgres dumps) | Pennies per month at small scale; egress-free for Cloudflare-fronted traffic. |
| Frontend (web + mobile, Phase 1+) | Expo + React Native Web | One codebase ships to web, iOS, Android. Apple Sign-In, native push, App Store presence all available when needed. |
| Auth | **Auth0** as the identity provider. Auth0 hosts the Universal Login at `auth.counsel.day` (custom domain CNAME to the Auth0 tenant) and exposes Magic-link email + Google + Facebook + Apple Sign-In as the four connection types. Sessions are JWTs signed by Auth0 (RS256), verified in FastAPI against Auth0's JWKS endpoint. Our Postgres `users` table carries an `auth0_sub` foreign key; no password column on our side. Free tier (7,500 MAUs) covers Year 1; ~USD 25-240/month at higher scale. Auth0 is a documented sub-processor in the privacy policy. |
| Payments | Stripe (Counsel.day account), Stripe Tax enabled | Per design-notes; one-time charge per decision; partner invited free. |
| AI | Anthropic Claude Opus 4.7 (synthesis), Sonnet 4.6 (theme clustering), prompt caching enabled | Per design-notes. |
| Transactional email | Brevo (50% off coupon) | Magic links, verdict-day notifications, partner invites, daily prompts, customer support. EU-based provider, good for the GDPR data-residency story. Also handles marketing email from the same account, useful once the SEO content engine starts capturing newsletter signups. |
| Push notifications | Expo Push (wraps APNS + FCM); web push later | Only relevant once the React Native app ships in Phase 3. Email-only at launch. |
| Observability | Sentry + Plausible + Better Stack | Errors, privacy-respecting analytics, logs and uptime. |
| Source + CI | GitHub + GitHub Actions | Standard. |
| Secrets | **Infisical** (open-source, self-hosted on the same Hetzner box in a sibling Docker container). All secrets (Anthropic API key, Stripe live + test keys, Auth0 client secret + Management API token, Brevo API key, Postgres password, per-decision encryption keys, R2 backup credentials) live in Infisical. FastAPI reads them via the Infisical Python SDK at boot and on webhook-triggered rotation events. Rotation cadence: 60 days for Anthropic, 90 days for Stripe + Auth0 + Brevo, on every personnel change for everything. No `.env` files in production; the Hetzner filesystem holds only the Infisical service-token, which itself is rotated quarterly. | Self-hosted means no third-party SaaS sees any secret. Web UI handles rotation, audit log, and access policies. Free forever for solo use; we can layer 1Password on top later if we want a human-facing vault. |
| Admin dashboard charts | **Chart.js 4** (currently via jsDelivr CDN in the prototype; production self-hosts it via Vite bundling). Used for the operator-facing line/bar/donut charts on `admin.counsel.day`. | Industry-standard admin CMS chart library, ~70 KB minified, ships native dark mode, accessible by default. The customer-facing site never loads it. |
| Legal templates | Claude-generated v1 (this week), half-yearly self-review, professional review when revenue exceeds USD 5,000/month | Documented override of the design-notes "ship pen-test-ready" rule for the pre-revenue phase. |

---

## Phase 0 · Week 1 · 8 hours · The beachhead

The goal of Week 1 is **a real product, taking real payments worldwide, from a real domain**, with the rails in place that make 1-hour-per-week operation safe. Two formats out of nine, email-only notifications, web-only (no native apps), Auth0 with Google + magic-link enabled at launch (Facebook and Apple connections configured in Auth0 but toggled off until Meta and Apple verifications clear, which is a one-click change rather than a code change). Real but narrow.

### Hour-by-hour schedule

**Hour 1 (James) · Domain and marketing site.** Register `counsel.day` via Cloudflare Registrar. DNS lives on the same Cloudflare account by default; no separate nameserver migration needed. Create Cloudflare Pages project pointed at the `counsel-day-complete/` directory of the GitHub repo. Verify Plausible analytics + Google Search Console + Bing Webmaster Tools. Ship `og-image.png` (1200×630, editorial style, Claude generates this) and `favicon.ico` (The Knot mark, 32×32 + 192×192 + 512×512). Submit `sitemap.xml` to Search Console.

**Hour 2 (James) · Hetzner box and infrastructure.** Provision a CPX31 in Falkenstein or Helsinki (closest to NZ across the available regions). SSH key-only authentication, root login disabled, `fail2ban` watching SSH, `ufw` firewall locked to ports 22, 80, 443 only. Install Caddy, Docker, Postgres 16 (in a container with persistent volume), Redis 7 (container). Create Cloudflare R2 bucket for offsite Postgres backups. Configure encrypted nightly `pg_dump` to R2 with seven-day rolling retention.

**Hour 3 (Claude Code) · Backend scaffolding.** FastAPI project scaffolded in a new GitHub repo (`counsel.day/app`). Postgres schema migrations with the row-level security policies from `docs/design-notes.md` § Database architecture. GitHub Actions CI on every push: lint (`ruff`), type-check (`mypy`), unit tests (`pytest`), deploy to Hetzner on `main` via SSH. Sentry SDK integrated. Structured logging (JSON, scrubbed of vote/note content) shipping to Better Stack.

**Hour 4 (Claude Code) · Authentication via Auth0.** Provision an Auth0 tenant for Counsel.day (free tier). Configure the Universal Login page with the Counsel.day branding (logo, palette, Newsreader wherever Auth0's template engine supports custom fonts; system serif fallback otherwise). Configure four connections: Email magic-link (no passwords), Google, Facebook (toggled off until Meta verification), Apple (toggled off until iOS app ships). Custom domain `auth.counsel.day` set up via Cloudflare CNAME pointing at the Auth0 tenant. Register the FastAPI backend as an Auth0 Application (Regular Web Application) with callback URLs `https://counsel.day/auth/callback` and `http://localhost:3000/auth/callback`. Implement JWT validation middleware in FastAPI using `python-jose` against Auth0's JWKS endpoint with RS256. Postgres `users` table created with `auth0_sub` as the unique foreign key; a Post-Login Auth0 Action fires on every login and ensures a row exists in our `users` table (lazy-create on first sign-in). Account-deletion endpoint deletes both the Auth0 user via Management API and our Postgres row (honoured within 24h; tombstone-free).

**Hour 5 (Claude Code) · Decision flow.** Decision composition endpoint (Yes/No and Strong/Lean formats only at launch). Partner-invite magic-link endpoint. Sealed daily vote endpoint with per-decision encryption keys held in Hetzner-local KMS-equivalent (initially: encrypted file in a restricted directory; later: dedicated KMS service). Notes endpoint, encrypted at rest with same per-decision key.

**Hour 6 (Claude Code) · Verdict pipeline and Stripe.** RQ scheduled job that fires at the verdict-reveal moment for each decision. Reads votes + notes, calls Claude Sonnet 4.6 for theme clustering, calls Claude Opus 4.7 for synthesis with prompt caching, validates output against expected schema (three retries before paging the operator), assembles the verdict document. Stripe upfront charge at decision composition (no pre-auth pattern, because Stripe authorisations cannot be held across the 7-to-365 day decision duration). Stripe Tax enabled for worldwide VAT/GST/sales tax. Operator-issued refund on technical defect (Claude API failure, schema validation failure, Stripe failure) after operator review.

**Hour 7 (Claude Code) · Legal, email, settings.** Claude-generated Privacy Policy, Terms of Service, Cookie Policy, Refund Policy (the "no refunds except on technical defect" policy), DPA shell, sub-processor list, all deployed at `counsel.day/privacy`, `/terms`, etc. Brevo account configured with `counsel.day` sender domain. SPF, DKIM, and DMARC records published on Cloudflare DNS and verified in Brevo before any production email sends; bounce and spam rates monitored against the Brevo dashboard during the first month. Transactional email templates created: magic-link, partner-invite, verdict-day-reveal, decision-day-1, missed-three-days-reminder, refund-issued. Settings page on the web app for notification time + timezone (defaults to 19:00 local, auto-detected).

**Hour 8 (James + Claude Code) · End-to-end test and live cutover.** James opens a real decision with a real test card. Claude runs a script that fast-forwards thirty days of simulated votes and notes, triggers the verdict job, captures the Stripe charge, delivers the PDF via email, processes a test refund. Verify offsite backup ran and a restore-test succeeds. Verify Sentry captures a deliberately-triggered error. Flip the marketing CTA from "Begin a decision" linking to `vote.html` (demo) to linking to the real decision-composer at `app.counsel.day/new`. Tag `v0.1.0` in git.

### Operational rails being built into v0.1

The premise of low-touch operation rests on these automated guardrails. Each one is implemented in Week 1 and tested before launch.

1. **Sentry-triggered kill switch.** Any error tagged `priv` (privacy-sensitive: a query returning rows it should not have, a decryption failure, a row-level-security policy bypass attempt) automatically sets the app into maintenance mode (new signups and new decisions paused, existing decisions continue) and pages the operator. Existing data is never compromised by the kill switch firing; it just stops accepting new exposure.

2. **Stripe error-rate kill switch.** If Stripe charge attempts fail at >5% over a 30-minute rolling window, payment capture pauses and the operator is paged. Customers see a "we're sorting payments out" notice instead of failed charges.

3. **Anthropic API kill switch.** If three consecutive verdict-generation attempts fail (after the three internal retries each), the verdict job pauses delivery, sends the affected customers a "your verdict is delayed by 24 hours while we resolve a technical issue" email, and pages the operator.

4. **Automated refund on technical defect.** If a verdict job fails permanently (after kill switch + manual intervention window), the Stripe charge is refunded automatically with an apology email. The customer never needs to email asking for a refund on a broken delivery.

5. **Weekly operations digest.** Every Sunday evening (operator's timezone), an automated email summarises: new signups this week, decisions started, decisions completed, revenue collected, Sentry errors by severity, one randomly-sampled verdict text (with names scrubbed for the operator's quality review).

6. **Customer-support auto-reply.** `hello@counsel.day` auto-replies with: "We read every message. We reply within three business days. For urgent issues with a decision currently running, mark the subject with [URGENT] and we will reply within one business day." Sets realistic expectations and reduces inbound follow-up.

7. **Quarterly Claude-model deprecation calendar reminders.** Calendar entries pre-created for each of the next eight quarters; each one is a 30-minute task to verify the configured Claude model versions are still available, update if not, retest the prompt template.

8. **Half-yearly legal-template self-review reminder.** Calendar entry every six months to re-read the Privacy Policy and Terms against the current implementation, ensure they still describe what the system actually does.

### Corners cut in Week 1, with date by which each is reversed

| Severity | Corner | Mitigation | Reversed by |
|---|---|---|---|
| 🔴 | No professional legal review of Privacy/ToS | Claude-generated, self-reviewed half-yearly; professional NZ commercial lawyer review (NZ$1000-2000) commissioned when monthly revenue exceeds USD 5,000 | Month with first USD 5K of revenue, or end of Year 1, whichever first |
| 🔴 | No independent penetration test before launch | Self-audit using OWASP ASVS Level 2 checklist; rely on managed-service audited components (Stripe, Brevo, Anthropic) for the hardest surfaces | Mandatory before the 50th paying customer; budget USD 5-10K with Aura Information Security or equivalent NZ provider |
| 🟠 | Email-only notifications at launch (no web push, no APNS, no FCM) | Brevo handles transactional email reliably with proper SPF/DKIM/DMARC hygiene; time-zone handling implemented carefully with `zoneinfo` from day one | Phase 2: web push in months 4-5; native push in Phase 3 |
| 🟠 | Two formats out of nine (Yes/No, Strong/Lean) | The 70-80% case per the brief; other formats labelled "coming soon" in the format picker | Phase 2: A vs B, Photo A vs B, Pros vs Cons added; Phase 3: rest |
| 🟠 | No native apps (web-only) | The web product works on mobile browsers; users can add to home screen for an app-like experience | Phase 3: native iOS + Android via Expo |
| 🟠 | Offsite backups configured but unverified at launch | Verified successful restore-test runs in hour 8 before live cutover | N/A (verified in Week 1) |
| 🟡 | Facebook connection toggled off in Auth0 | Magic-link + Google covers 90%+ of target customer authentications; Auth0's Facebook connection is configured but flipped off until Meta Developer app review clears, then flipped on with no code change | Phase 2: Meta Developer app review begins in Week 2 |
| 🟡 | Apple Sign-In connection toggled off in Auth0 | Required only once we ship an iOS native app (App Store mandates Apple Sign-In if other SSO is offered); Auth0's Apple connection is configured but flipped off until then | Phase 3 |
| 🟡 | No therapist portal | Marketing copy describes it; therapists can email `therapists@counsel.day` for now and receive a hand-rolled discount code | Phase 3 |
| 🟡 | No SEO content engine (just the cornerstone pages) | The marketing site as currently structured already has the four cornerstone keywords represented; long-tail pages slot in 2-3 per week through Phase 2-3 | Phase 2 onwards |
| 🟡 | Round-robin pairwise format described in copy but not implemented | "Coming soon" badge in the format picker | Phase 2 |
| 🟡 | The current homepage "From a couple who used the product" quote is fictional | Either remove the quote block or label as illustrative | In hour 1 of Week 1 |

---

## Phase 1 · Weeks 2-12 · The full web product

The Week 1 build is the floor. Phase 1 turns it into something a customer would describe as a real product.

**Goals:**
- All nine question formats live (including round-robin pairwise).
- Photo A vs B working end-to-end with image upload, optimisation, and storage.
- Web push notifications via service worker (the first non-email notification channel).
- Facebook connection flipped on in Auth0 (assuming the Meta Developer app review clears). No code change required, just an Auth0 dashboard toggle.
- Theme-clustering and synthesis prompts iterated against the first ten real verdicts.
- Three more long-tail SEO landing pages per month (start of the content engine).
- Onboarding polish: a brief explainer when a new user signs up, a clearer "what happens on day thirty" expectation-setter.
- Branded PDF verdict polished beyond the v0.1 template.

**Cadence at 1h/week:** ~50 hours of focused operator time across Phase 1's eleven weeks. Realistic deliverable: format expansion + notifications + Facebook auth + verdict-quality iteration. Native apps and the therapist portal do not fit in Phase 1; they slot into Phase 2.

**Trigger to start Phase 1:** 50 successful Week-1 paying decisions, OR end of Week 4, whichever comes first.

---

## Phase 2 · Months 4-6 · PWA, full notifications, therapist portal

**Goals:**
- Installable PWA with manifest, service worker, offline support for vote composition (offline votes sync on next connection).
- Web push for the daily prompt (the design-notes flawless-UX rule kicks in here; cross-device testing across iOS Safari, Android Chrome, Desktop Chrome/Firefox/Safari).
- Therapist portal at `/therapists` with referral code generation, discounted annual access, twice-yearly virtual workshop registration.
- First 30 long-tail SEO landing pages live (from the SEO strategy doc's Cluster 1 and Cluster 2).
- First pen test commissioned and remediated to closure.
- Professional legal-template review commissioned (~NZ$1500) if monthly revenue is sustaining USD 5K+.

**Trigger to start Phase 2:** Phase 1 complete; first ten paying decisions verified as quality-acceptable per operator review.

---

## Phase 3 · Months 7-9 · Native apps and group decisions

**Goals:**
- React Native (Expo) iOS app shipped to App Store, with Apple Sign-In flipped on in Auth0 alongside.
- React Native (Expo) Android app shipped to Play Store.
- Native push notifications via Expo Push (replacing web push for native-app users).
- Group-decision format (3-6 participants) shipped: the long-anticipated B2B Teams pilot.
- Vector search across past verdicts (annual-plan feature (Couple Annual / Family Annual)).
- Sixty-plus long-tail SEO landing pages live; targeting the four cornerstone keywords + the Cluster 4 high-CPC commercial-intent set.

**Trigger to start Phase 3:** Phase 2 complete; one hundred paying decisions completed; verdict-quality rating averaging above 4.0/5 across operator review.

---

## Phase 4 · Year 2 · Scale

**Goals:**
- Paid Meta acquisition opens against lookalike audiences of the Phase 1-3 paying users.
- Therapist program expands beyond founder-network referrals; targeted outreach to NZ/AU psych associations.
- The eighty-plus long-tail SEO content engine is sustained at 2-3 pages per week.
- The annual plans (Solo Annual, Couple Annual, Family Annual) are pushed harder as the value proposition; aim for 20% of revenue from annual subscribers by end of Year 2.
- Potentially: localised content for non-English markets; first contractor hire if revenue supports it.

---

## Operational architecture: making 1 hour/week sufficient

The product takes private vote data from real customers, charges them real money, and generates AI-driven synthesis on private content. The operator has one hour per week. The way these two things coexist safely is through systematic automation, defensive kill switches, and aggressive use of managed services.

### What is fully automated (no human required)

- Customer signup, including OAuth and magic-link auth.
- Decision composition for any of the supported formats.
- Partner invitation (single-use magic-link sent on owner's instruction).
- Daily vote prompt sending (email at Week 1; web push in Phase 2; native push in Phase 3).
- Vote and note storage, encrypted at rest with per-decision keys.
- Verdict-day scheduling, theme clustering, Claude synthesis, schema validation, PDF generation.
- Stripe upfront charge on composition (no pre-auth + capture); operator-issued refund on technical defect after review (per refunds.html).
- Transactional email delivery for every customer-facing event.
- Daily encrypted Postgres backup to Hetzner-local storage + offsite to Cloudflare R2.
- Account deletion (24-hour SLA), including 30-day backup propagation.
- Stripe Tax calculations at checkout for VAT/GST/sales tax.
- Customer-support auto-reply with realistic expectations.
- Weekly operations digest email to the operator.
- Three operational kill switches (Sentry-privacy, Stripe-error-rate, Anthropic-failure-rate).

### What needs the operator's hour per week

- Reading the weekly digest email; clicking through to a randomly-sampled scrubbed verdict and rating it 1-5 for quality.
- Replying to the few customer support emails that the auto-reply does not resolve (target: ≤5 per week).
- Investigating any Sentry alerts that fired the previous week.
- One small action item from the quarterly calendar (Claude model upgrade check, legal template self-review, etc.).

### What needs ad-hoc operator time outside the 1h/week budget

- Kill-switch responses (rare but high-priority; pause everything else if one fires).
- Anthropic or Stripe API outages affecting customers in real time.
- A regulator inquiry or a security disclosure.
- App Store rejections (only relevant once native apps ship in Phase 3).
- A major Claude model upgrade requiring prompt template re-tuning.

The 1h/week budget assumes zero events from the ad-hoc category. The plan is realistic when those events average ≤1 per quarter.

---

## Risk register

The plan has known gaps. Documenting them so they are visible and reviewable.

| Risk | Severity | Likelihood | Mitigation | Owner |
|---|---|---|---|---|
| Privacy policy turns out to misdescribe data flows; regulator complaint | High | Low at small scale | Half-yearly self-review; professional review at first revenue milestone; conservative data practices | James |
| Anthropic model deprecation breaks verdict pipeline | Medium | Medium | Quarterly calendar reminders; fall-back model configured (Sonnet if Opus deprecates without notice) | James |
| Stripe account flagged for review and frozen | High | Low | Comply with Stripe risk policies; do not aggressively scale ad spend on Day 1; respond to any Stripe request within 24h | James |
| First verdict feels generic to first customer; bad-mouthed publicly | High | Medium | Operator reviews every verdict for the first 50 customers; iterate prompt template aggressively early | James |
| Hetzner box compromised | High | Low | SSH key-only, fail2ban, ufw, no public ports beyond Caddy, no shared accounts, OS security updates auto-applied via `unattended-upgrades` | James |
| Backup-restore fails when needed | Critical | Low | Verified restore-test in hour 8 of Week 1, then automatically every fortnight | James (script) |
| 1h/week proves insufficient; product degrades | Medium | Medium | Built-in metrics show degradation early (verdict quality slipping below 4.0/5 average triggers a "pause acquisition" recommendation in the weekly digest) | Operator + automation |
| Customer cancels mid-decision and asks for data export | Medium | Medium | Account deletion endpoint includes a data export option for the requester's own contributions before deletion | James |
| Pen test (Phase 2) discovers a significant vulnerability post-launch | High | Medium | Honest disclosure to affected users; rapid remediation; structured incident-response runbook | James |
| App Store rejection of the iOS native app (Phase 3) | Medium | Medium | Apple Sign-In implemented per their requirements; submission planned with buffer time before any marketed launch date | James |

---

## Cost projection

### One-time costs (Phase 0)

- Domain registration: USD 20-30 (Cloudflare Registrar, `.day`, one year, near-cost).
- Apple Developer Program: USD 99 (annual; relevant for Phase 3).
- Total: ~USD 160 in Week 1.

### Recurring costs (steady state, Phase 1)

| Item | Monthly |
|---|---|
| Hetzner CPX31 + Storage Box | €19 (~USD 21) |
| Cloudflare Free tier (DNS + Pages + WAF + edge DDoS) | $0 |
| Cloudflare R2 storage (offsite backups, ~30GB) | ~$0.30 |
| Auth0 (free tier covers ≤7,500 MAUs; Counsel.day projected ≤1,000 in Year 1) | $0 |
| Brevo (Business tier with 50% off coupon, ~10K transactional emails/month) | USD 8-9 |
| Plausible | EUR 9 (~USD 10) |
| Sentry | USD 0-26 |
| Better Stack | EUR 20 (~USD 22) |
| Anthropic API (per-verdict, ~USD 0.10-0.30) | Variable |
| **Fixed steady-state operating cost** | **~USD 95-100/month** |

### Revenue model

- Solo: free; cost to serve ~USD 0.30-0.50/month per solo decision (Brevo, Cloudflare, AI for the limited solo-version analysis).
- Couple: USD 9.99 per paid decision. Gross margin after Anthropic and Stripe: ~92% (~USD 9.20).
- Couple Annual: USD 99 per year. Gross margin after Anthropic (assumed 8 decisions/year): ~95% (~USD 94).

**Breakeven on operating cost: 11 paid decisions per month.** Eleven paying customers and the product runs in the black.

---

## First-customer milestone definition

"We have shipped" is achieved when, by end of Week 1:

1. `https://counsel.day/` resolves to the marketing site with valid SSL, og-image, favicon, sitemap, robots.txt, schema markup validating clean, analytics firing.
2. `https://app.counsel.day/` (or `https://counsel.day/app/`) resolves to the product app with a real signup flow.
3. A new user (not the operator) can:
   a. Sign up via Auth0 Universal Login (magic link or Google).
   b. Compose a Yes/No or Strong/Lean decision with a duration of their choosing.
   c. Invite a partner via magic-link email.
   d. Set their notification preferences in their account settings.
   e. Receive a real daily prompt email at their chosen time, in their timezone.
   f. Cast a vote and write a note daily.
   g. On day N (configurable via fast-forward for testing; real wallclock for production), receive both verdicts plus the Claude-generated five-layer analysis.
   h. Be charged USD 9.99 via Stripe on the verdict-reveal day, including local taxes.
   i. Download the branded PDF verdict.
   j. Delete their account and have all data removed within 24 hours.
4. Operator can flip Counsel.day into maintenance mode in one click from a private admin endpoint.
5. Backup restore from yesterday's R2 backup completes successfully.

Once all eleven of those check, the product is live and the marketing CTA points to the real signup flow.

---

## Change log

| Date | Author | Change |
|---|---|---|
| 2026-05-12 | James + Claude | Plan authored; locked stack decisions; Week 1 hour-by-hour scheduled; corners-cut register documented |

---

*End of document.*
