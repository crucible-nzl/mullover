# Counsel.day · Launch checklist

> The one-page punch list that gates public launch. Live, dated, and the only thing you have to read on launch morning.
>
> Authored 2026-05-24 · supersedes the open-shippers memories for any item below.

Legend: `[ ]` open · `[x]` shipped · `[~]` partial / waiting on external action

---

## Hard blockers · launch cannot happen until these are done

### Auth / security
- [ ] **Remove `DEV_BYPASS_AUTH_EMAIL` from server env.** `ssh counsel-day-prod-01 "sudo sed -i '/DEV_BYPASS_AUTH_EMAIL/d' /etc/counsel-day-app/env.local && sudo systemctl restart counsel-day-app"`. Server now logs a startup banner whenever it is set (instrumentation.ts) so it cannot ship silently. Verify on next deploy that the banner is absent from `journalctl -u counsel-day-app -n 50`.
- [ ] **Rotate Brevo API key** in Brevo console · paste new value into `/etc/counsel-day-app/env.local` · `sudo systemctl restart counsel-day-app`. Old key exposed in chat transcripts.
- [ ] **Rotate Stripe live secret key** in Stripe Dashboard · same env install + restart. Old key exposed in chat transcripts.
- [ ] **Rotate Stripe webhook secret** · regenerate in Stripe Dashboard → Webhooks → counsel.day endpoint · same install path.
- [ ] **Confirm MFA enrolled for `admin@counsel.day`** via `/account.html` security panel. Step-up MFA (`requireFreshMfa`) silently falls through when the actor has no MFA enrolled, so a forgotten MFA enrolment = no actual step-up protection.

### Email deliverability
- [x] **DMARC record published** · `_dmarc.counsel.day TXT "v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com"` (Brevo aggregator).
- [ ] **Upgrade DMARC policy to `p=quarantine`** after 2 weeks of clean aggregate reports.
- [ ] **Zoho aliases configured** for `security@`, `press@`, `corrections@`, `therapists@`, `privacy@`, `james@`, `hello@` (all referenced from `/contact.html` JSON-LD + `/.well-known/security.txt`). Verify by sending to each address.

### Push / notifications
- [ ] **VAPID keys generated and installed.** `npx web-push generate-vapid-keys` → paste `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` + `VAPID_SUBJECT=mailto:admin@counsel.day` into server env + restart. Without these, `lib/push.ts` no-ops and verdict-day push notifications never fire.

### Analytics
- [ ] **Real GA4 measurement ID** in `counsel-day-complete/ga4.js` (currently a placeholder per `project_ga4_funnel.md`). Verify in GA4 DebugView that all 10 funnel events fire.
- [ ] **GA4 service account JSON** in server env (`GA4_SERVICE_ACCOUNT_JSON` + `GA4_PROPERTY_ID`). Without this, `/admin-traffic.html` renders the setup prompt instead of real data.

### CI / deploy
- [ ] **GitHub Actions secrets configured** · `SSH_PRIVATE_KEY`, `SSH_HOST`, `SSH_USER`, `SSH_KNOWN_HOSTS`. Verify the next push to main triggers a green workflow.

### Legal / trust
- [ ] **Privacy policy reviewed** for Whisper (Daily Counsel) once that feature ships · not blocking the decision-tool MVP.
- [ ] **Cookie banner regional logic** verified for EU + UK + California visitors.

---

## Soft blockers · ship before but launch could go without

### Performance
- [ ] Lighthouse mobile score ≥ 90 on `index`, `pricing`, `method`, `verdict`, `offer-a`-`offer-g`, `offer-e2`, `offer-e-{facebook,instagram,google,tiktok}`. See § Lighthouse below.
- [ ] Preconnect to fonts.googleapis.com on first-paint pages.
- [ ] WebP/AVIF where currently using PNG/JPG.

### Conversion
- [ ] A/B framework rotates between offer variants and writes the variant to a GA4 custom dimension. See `scripts/ab-rotator.js`.
- [ ] One paid sign-up tested end-to-end against Stripe **live** mode with a real card (test mode does not catch live-key misconfigurations).

### Accessibility
- [ ] axe-core scan clean on every public page (see `npm run a11y` once wired).
- [ ] Tab through `index → /offer-e → /signin → /compose` with no mouse · every focus state visible against the white background.
- [ ] Wine accent `#722F37` checked against white background for WCAG AA (4.5:1 for body text, 3:1 for large text).

### Cron / operations
- [x] Daily security-audit cron (`30 4 * * *`) installed on counsel-day-prod-01.
- [ ] Verdict-generation cron healthcheck (an alert if no verdicts have been generated in 48 hours when there should be).
- [ ] Hetzner offsite DB backup verified by restoring last night's dump into a throwaway database.

### Brand
- [ ] Brand-verify exits 0 from a clean checkout: `pwsh counsel-day-complete/scripts/brand-verify.ps1`.

---

## Post-launch (week 1)

- [ ] Promote DMARC `p=none` → `p=quarantine` after 14 clean aggregate reports.
- [ ] Add Sentry alert routing to a real channel (Slack webhook or PagerDuty trial).
- [ ] First-week retention email to anyone who filed a decision but didn't return for vote 1.
- [ ] Manual Stripe payout dry-run.
- [ ] First-week incident log started (one file per incident in `docs/incidents/`).

---

## How to use this list

1. On launch morning, every box above must be `[x]` or explicitly accepted as a known gap.
2. When you close an item, change `[ ]` → `[x]` in this file AND in the same commit reference the change in the relevant code/config.
3. When a new pre-launch task appears, add it here · do not start another open-shippers memory. This file is now the canonical place.
4. After launch, archive this file to `docs/launch-2026-MM-DD-checklist.md` and start a fresh `docs/POST_LAUNCH_CHECKLIST.md` for ongoing operations.

Related: [project_locked_settings.md] memory · [docs/RUNBOOK.md] for the actual run-this-command-then-this-command steps.
