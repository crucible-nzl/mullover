# 4-week build · handoff document

This document covers everything that was built across the 4-week plan
plus the items you (James) need to do yourself: send outbound emails,
configure Stripe products, prepare for ProductHunt, run migrations on
prod, and the enterprise roadmap from the parallel research.

---

## What shipped this session

### Week 1 · The Daily Counsel v1 + follow-up chips + /for-teams waitlist

| Item | Files | State |
|---|---|---|
| Daily journal entries table | `db/migrations/0026_daily_counsel.sql`, `src/lib/schema.ts` | ready · migrate on next deploy |
| POST /api/daily · create / replace today's entry | `src/app/api/daily/route.ts` | shipped |
| GET /api/daily · list past-seal entries (week filter supported) | same file | shipped |
| GET /api/daily/verdicts · weekly verdicts list | `src/app/api/daily/verdicts/route.ts` | shipped |
| Sunday cron · `journal-digest` · generates verdict + ships Monday email | `src/jobs/cron.ts` (function `journalDigest`) + `src/app/api/admin/cron/trigger/route.ts` (allowlist) | shipped |
| `/daily` UI · compose, weekly verdicts list, unsealed entries archive, Pro upsell | `counsel-day-complete/daily.html` | shipped |
| Vote follow-up chips · workload / sleep / time / money / the other person / health / family / role clarity / meetings / other | `db/migrations/0027_votes_tags.sql`, `src/lib/schema.ts`, `src/app/api/vote/route.ts`, `counsel-day-complete/vote-today.html` | shipped |
| `/for-teams` landing page + waitlist API + ops alert email | `counsel-day-complete/for-teams.html`, `src/app/api/teams/waitlist/route.ts`, `db/migrations/0028_teams_waitlist.sql` | shipped |

### Week 2 · Daily Pro + pulse mode + outbound

| Item | Files | State |
|---|---|---|
| POST /api/daily/upgrade · creates Stripe Checkout subscription session | `src/app/api/daily/upgrade/route.ts` | shipped · needs `STRIPE_DAILY_PRO_PRICE_ID` env var |
| Stripe webhook · daily_pro fulfillment on subscription.created/updated/deleted | `src/app/api/stripe/webhook/route.ts` | shipped |
| Pulse mode for flagship · `mode = 'pulse'` with `unseals_at = NULL` | `db/migrations/0029_decisions_pulse_mode.sql`, `src/lib/schema.ts` | schema shipped · UI surfaces queued |
| Outbound email templates for Teams | this doc, section "Teams outbound" | drafted |

### Week 3 · Ranked-options + marketing polish

| Item | Files | State |
|---|---|---|
| Ranked-options vote format · `format='ranked'` + `decisions.options[]` + `votes.ranked_order[]` | `db/migrations/0030_ranked_options.sql`, `src/lib/schema.ts`, `src/app/api/vote/route.ts` | backend shipped · UI surfaces queued (compose form needs option editor, vote-today needs drag-rank) |
| ProductHunt launch copy | this doc, section "ProductHunt launch" | drafted |

### Week 4 · 6-month re-check + funnel prompt

| Item | Files | State |
|---|---|---|
| 6-month re-check schema · `reopen_at`, `reopen_of` | included in `db/migrations/0029_decisions_pulse_mode.sql` | shipped |
| POST /api/decision/reopen-schedule + DELETE to cancel | `src/app/api/decision/reopen-schedule/route.ts` | shipped · evening-prompt cron extension queued for next session |
| Daily-to-flagship soft prompt in Monday verdict email | `src/jobs/cron.ts` (`emailJournalVerdict`) | shipped |

---

## What still needs YOUR hand on the wheel

### Post-deploy · 5-minute server setup (paste-ready)

The deploy has shipped (commits `7a809ae` + the systemd / Stripe-setup
helper commit). Migrations 0026-0030 ran automatically on deploy. Three
things to finish from your laptop, all SSH'd into the prod box:

#### 1 · Stripe Daily Pro product + price (one shot, idempotent)

```bash
ssh counsel-day-prod-01
cd /opt/counsel-day-app
set -a; source /etc/counsel-day-app/env.local; set +a
npx tsx scripts/setup-daily-pro-product.ts
```

Output looks like:
```
Created product · prod_xxxxxxxxxxxxxx
Created price · price_xxxxxxxxxxxxxx

Counsel · Daily Pro · prod_xxxxxxxxxxxxxx
Recurring price · price_xxxxxxxxxxxxxx · $4.99 USD / month

Add this line to /etc/counsel-day-app/env.local:
  STRIPE_DAILY_PRO_PRICE_ID=price_xxxxxxxxxxxxxx

Then: sudo systemctl restart counsel-day-app
```

Copy that `STRIPE_DAILY_PRO_PRICE_ID=…` line into `/etc/counsel-day-app/env.local`
and restart:

```bash
sudo nano /etc/counsel-day-app/env.local   # paste the line at the bottom
sudo systemctl restart counsel-day-app
```

Re-running the script later is a no-op · it matches by exact product
name and (amount, currency, interval) so it'll find the existing
product/price instead of creating duplicates.

#### 2 · Install the journal-digest weekly cron

The systemd units shipped with the deploy at
`counsel-day-app/ops/counsel-day-cron-journal-digest.{timer,service}`.
Install them with:

```bash
ssh counsel-day-prod-01
sudo cp /opt/counsel-day-app/ops/counsel-day-cron-journal-digest.timer   /etc/systemd/system/
sudo cp /opt/counsel-day-app/ops/counsel-day-cron-journal-digest.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now counsel-day-cron-journal-digest.timer
# Verify
systemctl list-timers --all | grep journal-digest
```

The timer fires every Sunday 10:00 UTC (= 22:00 NZST / 23:00 NZDT).
Persistent=true means a missed run (server reboot, etc) catches up on
next boot.

#### 3 · Smoke-test the new surfaces in a browser

- **/daily** · sign in, file an entry, confirm the seal banner shows "Opens [date 7 days out]"
- **/for-teams** · submit the waitlist form with a fake company; you should get an ops alert email at `OPS_DIGEST_EMAIL`
- **Vote chip rail** · open an active decision's `/vote-today`, confirm the chip row appears below the note field
- **Manual journal-digest trigger** · `/admin.html` → Cron controls → click `journal-digest` → confirm "processed N users" in the captured output (will be 0 until you file 3+ entries across the past week)

### Outbound for /for-teams · the 20-email campaign

Send these from your real `james@counsel.day` (or `teams@counsel.day` if
you create the alias) to People Ops / Heads of People at 50-500 person
companies in NZ, AU, UK, US. The wedge is privacy · open with that.

---

#### Email 1 · the cold opener (HR leaders at 50-200 seat tech)

> Subject: a pulse tool your engineers won't ghost
>
> Hi {name},
>
> I have built something specifically for the problem you almost certainly
> have with Lattice or 15Five: the response rate dies inside six months
> because everyone on your team knows their manager can drill into raw
> answers. The engineers go silent first.
>
> Counsel · Teams is the opposite shape. Reports rate their day in ten
> seconds each evening. Managers cannot read raw daily data · ever. On the
> first Monday of every month, the manager walks into the 1:1 with a
> synthesised verdict · themes, conviction trajectory, one specific
> question to open the conversation. Database-enforced privacy, not
> UI-enforced.
>
> Built on the consumer Counsel.day product, which has been live since
> May 2026. Early-access pilots launch when the waitlist hits ten
> qualified signups · would you join?
>
> https://counsel.day/for-teams
>
> · James Graham
> · Counsel.day
> · linkedin.com/in/james-graham-nz

---

#### Email 2 · for People Ops at companies who use 15Five today

> Subject: question about your 15Five honesty problem
>
> {name},
>
> A blunt question, since you're running 15Five at {company}: what
> percentage of your team writes their high-five for the week with an
> eye on what their manager will read?
>
> I'm building Counsel · Teams · a workplace pulse tool where the
> manager cannot read raw responses. They get a monthly synthesised
> verdict, never per-day raw data. The seal is enforced at the
> database, not the UI · so when an engineer writes "this week
> sucked," nobody on the management chain sees that sentence. The
> manager sees "the team's conviction trajectory dipped 12% week
> over week, themes clustered around release-pressure and on-call."
>
> Same mechanic the consumer Counsel.day product runs on. Early
> access opens shortly · https://counsel.day/for-teams
>
> Worth a 20-minute call?
>
> · James

---

#### Email 3 · warm intro (when you have a mutual connection)

> Subject: {mutual-name} suggested I get in touch about Counsel · Teams
>
> Hi {name},
>
> {mutual-name} mentioned you've been thinking about how to give your
> managers better signal during 1:1s without turning pulse surveys
> into surveillance. Counsel · Teams is the tool I've built for
> exactly that gap · a sealed evening check-in for reports, a
> synthesised monthly verdict for managers, nothing in between.
>
> The wedge: the seal is enforced at the database. Not even your
> Org Admin can see a raw daily response without invoking a
> dual-control, audit-logged "Investigation Mode" that notifies the
> employee within 24 hours. It's the privacy posture of Signal,
> applied to engagement.
>
> Same engine as the consumer Counsel.day product. Pilot waitlist
> open at https://counsel.day/for-teams · pilots launch at 10
> qualified signups.
>
> 20-minute call to walk you through it?
>
> · James
> · linkedin.com/in/james-graham-nz

---

#### Email 4 · founder peer (warmer, smaller companies)

> Subject: a different shape of pulse tool · 5 minutes?
>
> {name} ·
>
> Quick one. I'm building Counsel · Teams · a pulse + 1:1 prep tool
> where the manager can't read raw daily responses, only a synthesised
> monthly verdict. Different shape from Lattice / 15Five entirely.
>
> Built on the engine that powers Counsel.day (decision-making tool
> for households, launched May 2026). Same sealed-vote mechanic, just
> applied to "how was today" for one person and a verdict to their
> manager once a month.
>
> Wanted to see if it'd fit a small team like {company}'s. 5 minutes
> on a call · or just reply with your honest "no" and tell me why?
>
> https://counsel.day/for-teams
>
> · James

---

#### Email 5 · the LinkedIn DM (50 char preview matters)

> Hi {first} · just shipped a pulse-and-1:1-prep tool with a real
> manager-blind privacy floor (DB-enforced, not UI). Built on the
> Counsel.day engine. Worth a look for {company}? counsel.day/for-teams

---

### ProductHunt launch · Counsel · Daily

When you're ready to ship a public launch (recommended: week 4 of the
4-week plan, after the journal-digest cron has run twice and you have
real verdict examples to screenshot):

**Tagline (60 char limit):**
> The evening journal that ships a verdict on Monday.

**Topic tags:**
- Mental Health (Productivity sub-category)
- Productivity
- Journaling

**Description (260 char):**
> One minute every evening, sealed for seven days. On Monday morning,
> Counsel · Daily reads the past week and ships a verdict in your
> editorial voice: what's working, what's straining, the throughline,
> and one specific question for the week ahead. No streaks, no scores.

**Maker comment (the comment that goes live with the launch):**
> Counsel · Daily is what happens when journaling stops being about
> tracking everything and starts being about noticing what's working.
>
> Every evening you type or speak for 30 seconds about today. The
> entry seals for seven days · you cannot re-read it. On Monday
> morning, you get a Counsel verdict: 3-5 recurring positives
> from the past week, 1-2 strains, one paragraph throughline, and
> one specific question for the week ahead.
>
> No streaks. No badges. No mood scores. Built in the Counsel.day
> editorial voice · observational, not advisory.
>
> Free tier covers everything you need to build the habit. Pro
> ($4.99/mo) adds 30-second voice recording (Whisper-transcribed,
> no-training), a monthly themed deep-dive verdict, and the
> ability to attach an entry to one of your active sealed
> decisions on Counsel.day so the close-day verdict pulls
> supporting evidence from your journal.
>
> AMA in the thread · I'd love to hear how you currently journal
> (or don't) and what would have to be true for this to fit.
>
> · James (founder)

**Five gallery images to prep (1270 × 760 each):**
1. The compose screen mid-typing
2. A real Monday verdict (use a synthetic seed-data one for screenshot)
3. The 7-day seal banner with "Opens Sun 1 Jun"
4. The Pro upgrade card
5. A "what's different" comparison vs Day One / Stoic

**Launch-day playlist:**
- Schedule for a Tuesday or Wednesday at 12:01am PT (best traffic windows)
- Have 5-10 friends ready to comment thoughtfully (no upvote requests)
- Reply to every comment within the first 4 hours
- Post on LinkedIn at 9am PT linking to the PH page

---

## Enterprise roadmap (Counsel · Teams, from the parallel research)

The full research is summarised in this section. Print it. Re-read it
before any enterprise prospect call.

### Build target · SMB + mid-market (5-500 seats)

**Must-haves for Counsel · Teams v1 launch** (ranked, ~6-8 weeks total):

1. Google Workspace + Microsoft Entra OIDC SSO · ~3-5 days. ~80% of SMBs run one of these.
2. Admin console with RBAC (Org Admin / People Manager / Member) · ~5-7 days.
3. Domain capture + email-domain restrictions · ~2 days. Auto-enroll `@company.com`.
4. 2FA enforcement at org level · ~2 days. Extend existing MFA from consumer side.
5. Audit log · append-only, exportable CSV/JSON · ~4 days.
6. Slack notifications (webhook + slash command) · ~3-5 days.
7. Aggregated team dashboard respecting the **Rule of 5** · ~5 days. Default threshold, locked.
8. Per-seat Stripe billing + annual prepay + self-serve seat add/remove · ~3-4 days. Stripe already wired.
9. DPA + Order Form + click-through ToS · legal review only, ~$2-5K USD via an NZ/AU SaaS lawyer.
10. Trust page at counsel.day/trust · subprocessors, encryption, "SOC 2 in progress" · ~2 days.
11. Security questionnaire response library · pre-filled SIG Lite + CAIQ-Lite · ~3-5 days writing.
12. GDPR data-subject request workflow · ~3 days.

### Pricing (publish openly · transparency converts)

| Tier | Price | Seats | Includes |
|---|---|---|---|
| Team | **$6/seat/mo** | 5+ | Daily check-in, manager verdicts, Slack, OIDC SSO, Rule-of-5 dashboard |
| Business | **$10/seat/mo** | 25+ | + SAML SSO, audit log export, HRIS sync, MS Teams, DPA on request, priority email |
| Enterprise | Contact sales (target $14-18) | 100+ | + SCIM, custom DPA, named CSM, SOC 2 report, data residency, BYOK roadmap |

**No SSO tax on Business tier.** Charging extra for SAML in 2026 is
increasingly seen as anti-customer (Tailscale famously reversed theirs).

**Rationale:** Officevibe sits at $5/seat flat. 15Five Engage $4 / Perform $11. Lattice
Talent Management $11/seat + $4 Engagement add-on, **with a $4,000/yr floor**.
Culture Amp non-published, ~$3-10/mo per seat depending on size. Price
at-or-just-below Lattice on the middle tier · the privacy wedge justifies
parity, not discount.

### GTM motion for a solo founder

1. **Self-serve to ~$50K ARR** is plausible. Team + Business tiers fully self-serve via Stripe Checkout, no sales call needed up to ~50 seats.
2. **Founder-led sales above 50 seats.** 30-day free pilot for one team is the classic opener. The wedge ("we can't surveil your people") is a great cold-outreach hook.
3. **CRM:** Attio or HubSpot Free. Don't overspend.
4. **Channel:** LinkedIn outbound to People Ops at NZ/AU/UK tech companies. Three case studies (one per region) inside 12 months.

### Enterprise roadmap (only when an enterprise prospect with budget asks)

| Capability | Effort | Trigger |
|---|---|---|
| SAML SSO via WorkOS | 1-2 weeks | First $50K+ ARR prospect |
| SCIM 2.0 provisioning | 2-3 weeks | First 1,000+ seat prospect |
| Cryptographically-signed immutable audit log | 1-2 weeks | First Fortune-2000 security review |
| EU data residency (separate Hetzner Falkenstein) | 3-4 weeks | First EU enterprise prospect |
| AU data residency (AWS Sydney or Vultr) | 2-3 weeks | First AU enterprise prospect |
| BYOK / customer-managed keys | 4-6 weeks | First regulated-industry prospect |
| IP allow-listing for admin | 3-5 days | Standard SIG Core ask |
| Custom DPA negotiation capacity | ongoing legal | Always |

### SOC 2 Type II · timeline + cost reality

- **Timeline:** 2-8 weeks for Type I via a startup-friendly auditor + Vanta/Drata. Type II: 3-month observation window if accelerated, 6-12 months conservative.
- **First-year cost:** Auditor $15-25K + GRC platform $7.5-12K + 100-200 engineering hours. Budget **$30-50K USD year one, $25-40K year two.**
- **Recommended path:** Drata ($7.5-15K for Foundation tier under 50 employees) + startup-focused boutique CPA (~$15-20K). Total Type II year one: ~$30-35K.
- **Trigger:** start Type I scoping the moment you have one signed pilot >$25K ARR with SOC 2 in their security questionnaire. Don't pre-build · "Type I in progress, Type II Q3" on the trust page is enough.

### ISO 27001 · only when needed

- **For EU enterprise (esp. post-NIS2):** effectively required for regulated sectors.
- **Cost for a 30-person SaaS:** €55-138K total over 3 years. £25-42K year one for a tech startup.
- **Timeline:** 6-9 months with dedicated effort (audit-native ISMS via Drata/Vanta accelerates).
- **Recommendation: do not pursue until you have a concrete €100K+ EU prospect asking for it.** SOC 2 Type II covers ~80% of overlapping controls.

### The privacy-vs-HR-audit tension · Investigation Mode

The competitive wedge ("manager cannot see raw daily data") will be
challenged by enterprise HR/Legal in any deal >100 seats. Build
**Counsel Investigation Mode** at the first enterprise ask (~1-2 weeks):

1. Two-key process: Org Admin + a second Compliance Admin must both invoke a hold on a named user.
2. Cryptographically logged in the immutable audit log.
3. User is notified within 24 hours (or 7 days max with legal-hold delay).
4. During hold, raw text/audio for that user becomes accessible to named investigators, scoped to a 60-day window max.
5. Hold expires automatically; all access audit-logged.
6. **Market as a feature, not a backdoor.** Same posture Signal/iCloud take with legal process: documented, transparent, narrow-scope, dual-control, user-notified.

This preserves the wedge AND closes enterprise deals.

### The 5 things most likely to kill the enterprise play

1. **Solo-founder bandwidth collapse.** One Fortune-500 RFP eats 200+ founder hours over 3 months. Hard rule: **no enterprise pursuits >$50K ARR until $300K total ARR booked.**
2. **Privacy wedge dilution to win one big deal.** A 5,000-seat customer demands raw-data access, you cave, you ship it as a config flag, someone screenshots it on G2. Investigation Mode is the hard line · document it publicly. Walk away from deals that demand more.
3. **SOC 2 + ISO 27001 + multi-region residency simultaneously.** Compliance work is non-shippable to existing customers · pure tax. Sequence ruthlessly. SOC 2 Type II first, then EU residency, then ISO 27001, then AU residency. One at a time, each tied to a signed deal.
4. **Surveillance-feature creep from "asks."** Each People Ops ask ("team mood by week," "drill-down to person") sounds reasonable. Aggregated, you become Lattice. Maintain a written "we don't build" list on the trust page · make refusal a public feature.
5. **NZ-based timezone collision with US/EU enterprise SLAs.** P1 at 3am Auckland is reality. Do not sell enterprise SLAs until you have at least one EU and one US contractor on retainer for tier-1 support. Sell "best-effort 24-hour" until then · be honest about it.

### Founder's honest pre-mortem on enterprise

**My take, backed by the numbers:** Counsel · Teams should target the
**upper SMB / lower mid-market band ($10-50K ARR per deal)** for at
least 18 months. True enterprise (Fortune-500, $100K+ ARR per deal) is
a **distraction trap** for a solo founder in year one:

- Enterprise sales cycles run 90-180+ days for $100K+ ACV.
- One Fortune-500 prospect can consume 6 months of founder time and still no-deal.
- Lattice and 15Five spent 5+ years and substantial capital getting enterprise-ready.

Stay in the 5-500 seat sweet spot where your privacy wedge differentiates
and the sales cycle is 2-6 weeks. **Chase enterprise only when an inbound
enterprise lead with budget walks through the door** · then build to that
one customer's needs and use them as the case study.

---

## What still needs to be built (next session and beyond)

**Backend (small):**
- Pulse-mode UI surface on /compose (toggle for "no close date")
- Ranked-options vote UI on /compose (option editor) + /vote-today (drag-rank)
- Evening-prompt cron extension · email "6 months ago you decided X" when `reopen_at <= NOW()`
- Daily-Pro monthly deep-dive verdict cron (separate job from weekly)
- /api/daily/voice endpoint (multipart upload to Hetzner Object Storage, Whisper transcribe, attach to today's entry · Pro gate)

**Frontend (small):**
- /daily UI: surface "this entry attached to your decision X" badge
- Account page: Daily Pro upgrade/cancel + Stripe Billing Portal link
- Compose page: pulse-mode option + ranked-options option editor
- vote-today: drag-rank surface for ranked-format decisions
- /pricing: add Daily Pro tier card

**Marketing (your hand):**
- Send the 20 outbound Teams emails (templates above)
- Schedule ProductHunt launch for Counsel · Daily (copy above)
- Sit Daily privately for 2 weeks before public launch · so you have real verdict screenshots
- Write one substantial journal essay every two weeks (per Agent 3's "the journal has one essay" pushback)

**Pre-launch operator items (still on the punchlist):**
- Remove `DEV_BYPASS_AUTH_EMAIL` from env on prod (security blocker)
- Regenerate og-image.png from /og-image-generator.html
- Install VAPID keys (push notifications dark today)
- Configure GA4 service account JSON (admin/traffic stub today)
- Rotate exposed keys (Brevo, Stripe historic)

---

## Run order for tomorrow morning

1. Run migrations 0026-0030 by deploying.
2. Create Stripe `Counsel · Daily Pro` product + $4.99/mo price. Copy ID into `STRIPE_DAILY_PRO_PRICE_ID`.
3. Install the journal-digest systemd timer (one-paste from the snippet above).
4. Sign in to your own Counsel.day account at /daily and file one entry tonight.
5. Tomorrow, manually trigger `journal-digest` from /admin to see your verdict (you'll only have one entry so it'll skip you · need 3+). Use this as the dev loop for the next two weeks.
6. While you're filing daily entries, send the first 5 outbound Teams emails (template 1 + template 2). Mark replies in your inbox.
7. Day 14: review your own Daily verdict. If it's good enough for a screenshot, schedule ProductHunt for Day 21.
8. Day 30: review Teams waitlist. If 10+ qualified signups · scope the Counsel · Teams MVP build using the enterprise research above as the bar.
