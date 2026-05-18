# Counsel.day · Integration & backend backlog

Snapshot as of **18 May 2026**. The static site + Next.js app on Hetzner now run end-to-end for: signup + email verify, signin (password OR magic link), session cookies, password reset, compose decision (incl. invite emails), Stripe Checkout (live mode, 4 SKUs), Stripe webhook, vote-today, decisions list, single-decision view, verdict-reveal (sealed metadata only until cron generates), invite preview + accept.

Below: what's done, what's open, and what's needed before pen-test sign-off / public launch.

---

## A · Status by domain (one-line per surface)

### Auth + identity · **DONE**
- `POST /api/signup` · validates, hashes (argon2id), mints verify token, sends Brevo email.
- `GET /api/verify` · consumes token, creates session, redirects to /account.
- `POST /api/signin` · password OR magic link fallback.
- `POST /api/signout` · clears cookie.
- `POST /api/set-password` · invalidates all other sessions.
- `GET /api/auth-check` · used by Caddy `forward_auth` on protected paths.
- `POST /api/password-reset/request` · no enumeration, 30-min token, Brevo email.
- `POST /api/password-reset/consume` · sets password, kills ALL sessions.
- Cookie: SameSite=Lax, HttpOnly, Secure. 30-day sliding window. Server-side session store.

### Decisions · **DONE**
- `POST /api/compose` · validates, creates decision + participants, mints per-invitee tokens, **sends invite emails (today's change)**.
- `POST /api/vote` · idempotent per (participant, date), scoped to today's slot.
- `GET /api/vote-today` · returns active decision + voted-today flag.
- `GET /api/me` · user + decisions list.
- `GET /api/decision?id=` · single-decision detail incl. day-strip, counters, participants (today's change).
- `GET /api/verdict-reveal?id=` · sealed metadata before unseal; unsealed verdict after.
- `GET /api/invite/preview` · public, no enumeration.
- `POST /api/invite/accept` · session-required, flips decision to active when last invite lands.

### Payments · **DONE (live mode, 4 SKUs)**
- `POST /api/checkout/create` · creates Stripe Checkout session (`mode: payment` for per-decision, `subscription` for annual).
- `POST /api/stripe/webhook` · signature verified; handles `checkout.session.completed` + subscription events.
- SKUs: Solo $9.99 USD, Couple $25 USD, Family $40 USD, Consumer Annual recurring. Practitioner Annual removed (DB migration 0002).
- All prices USD; no automatic tax until NZ GST registration triggers.

### Email · **DONE**
- Brevo transactional. Sender `admin@counsel.day` (validated). DKIM + SPF + DMARC live on Cloudflare.
- Templates: verification, magic-link, password-reset, **invite (today's change)**, evening-vote-prompt, verdict-ready.

### Cron jobs · **DONE**
- `cron-evening` daily at 06:00 UTC · sends evening-vote-prompt emails per timezone.
- `cron-verdict` every 30 min · runs verdict-generate + session-purge.
- Both via systemd timers on Hetzner. Logs to journalctl.

### Site · **DONE**
- 50+ static pages on Caddy. GTM `GTM-PFFSDN3M` + GA4 `G-SX20BZZP59` on every public page (brand-verify Check 12 + live probe of 14 pages, all OK).
- Consent Mode v2 defaults to denied, honours GPC / DNT.
- HSTS / CSP / X-Frame / X-Content-Type / Referrer-Policy / Permissions-Policy all set in Caddyfile.
- Protected app surface (`/account /billing /decisions /decision /compose /vote-today /verdict-reveal`) gated by Caddy `forward_auth`. `/invite` deliberately public for preview.

---

## B · Still to do (the actual backlog)

### Critical · ship-blocking
1. **`ANTHROPIC_API_KEY` install on prod.** Without it, the verdict-generate cron logs "no key" and writes nothing. Instructions are in `docs/RUNBOOK.md` § Anthropic. **Action:** SSH to box, append to `/etc/counsel-day-app/env.local`, restart counsel-day-app.service.
2. **Rotate keys leaked in chat transcript.** Brevo API key + Stripe live secret + Stripe webhook secret have all appeared in this conversation. Rotate before public launch. (Pen-test would catch this.)
3. **Stripe Customer Portal wiring on `/billing.html`.** Today the page is static. `POST /api/billing/portal` → create portal session → 302 to Stripe-hosted invoices + subscription management. ~30 min.
4. **Edge rate limiting on `/api/*`.** Caddy `rate_limit` plugin or nginx-style token bucket. Today there's no per-IP throttle on signup/signin/password-reset/checkout. Brevo will absorb a burst but Stripe will not. **Action:** install caddy with `rate_limit` module, add to Caddyfile. ~1 h.
5. **reCAPTCHA v3 real site key.** Placeholder is in signup.html. Today's signup endpoint does not verify the token. Add `RECAPTCHA_SECRET` env, verify in `/api/signup` before creating user. ~1 h.
6. **Hetzner snapshot + `pg_dump` cron.** No backups today. Add nightly snapshot via Hetzner API + `pg_dump --no-owner` to /backups/ rotated 14 days. ~1 h.
7. **HSTS preload submission.** HSTS header is already shipping with `preload` directive. Submit `counsel.day` to https://hstspreload.org/ once we're confident we'll never serve plain HTTP. ~10 min.
8. **CAA DNS record.** `counsel.day. CAA 0 issue "letsencrypt.org"` on Cloudflare. Stops any other CA from issuing a cert for the domain. ~5 min.

### Important · pre-launch hygiene
9. **Stripe webhook idempotency table.** Today the webhook handler trusts `event.id` is unique. If Stripe retries, we'd double-credit. Add a `stripe_webhook_events` table that `INSERT ON CONFLICT DO NOTHING`s the event id and only processes if the insert succeeded. ~30 min.
10. **Invite-token expiry cron.** Tokens never expire today. Add to `cron-verdict`: `DELETE participants WHERE invite_token IS NOT NULL AND invite_accepted_at IS NULL AND created_at < NOW() - INTERVAL '30 days'`. ~10 min.
11. **Partner-invite reminder cron.** If invitee hasn't accepted after 48 h, send a single reminder via Brevo. Stop after one. ~30 min.
12. **Sentry (server) + Sentry-browser (client).** Today errors only show in journalctl + browser console. Set up Sentry with `SENTRY_DSN` env on the Next.js side + `<script>` on public pages. Free tier covers expected volume. ~1 h.
13. **Uptime monitoring.** Hetzner has nothing built-in. Use UptimeRobot free tier on `/`, `/api/auth-check` (will return 401, that's fine as a liveness signal), and `/admin`. ~15 min.
14. **DMARC report aggregator.** `rua=mailto:rua@dmarc.brevo.com` is set, but no human reads them. Free tier of postmark.com or dmarc.report. ~10 min.
15. **`security@counsel.day` email alias + a security.txt.** Add the alias to Zoho. Add `/.well-known/security.txt` with contact + acknowledgements policy. ~15 min.
16. **GitHub Actions deploy.** Today deploys are `tar | ssh`. Add a workflow that runs on push to `main`: `npm run build`, `tsc --noEmit`, `tar`, `scp`, `ssh "systemctl reload counsel-day-app"`. Gated by a manual approval for the first month. ~2 h.
17. **`/api/me/export` (GDPR data export).** Streams a JSON zip of all rows tied to the user_id. ~1 h.
18. **`DELETE /api/me` (GDPR data deletion).** 14-day soft-delete window; hard delete via cleanup cron. ~1 h.
19. **`/api/contact` form.** `/contact.html` today links to mailto. Build a real form that posts to `/api/contact` → forwards to `hello@counsel.day`. Includes Brevo auto-reply. ~1 h.

### Nice-to-have · post-launch
20. **PostHog (or Mixpanel) product analytics.** GA4 covers acquisition; PostHog covers funnels (`decision_created → first_vote → verdict_revealed → second_decision`). Free tier 1M events/mo. ~2 h.
21. **Self-host fonts.** Today Public Sans + Newsreader load from Google Fonts. Self-host woff2 → CSP can drop `https://fonts.googleapis.com` / `gstatic.com`, faster LCP, full GDPR purity. ~1 h.
22. **Status page automation.** `/status.html` is static. Wire to UptimeRobot's public status page (or Better Stack). ~30 min.
23. **Cache-Control header tuning in Caddyfile.** CSS/JS/PNG/woff2 = `public, max-age=31536000, immutable`; HTML = `no-cache`. ~10 min.
24. **MFA / TOTP.** Spec'd but not built. Add `users.mfa_secret`, enroll/verify endpoints, `/account` UI. ~3 h.
25. **Cookie-consent compliance log.** Today consent is `localStorage` only. Log each grant to `consent_log` with anon_id → user_id linking on signup, per GDPR audit trail. ~1 h.

---

## C · Operational

- **Production env file:** `/etc/counsel-day-app/env.local` (mode 600, owned by `deploy`). NEVER paste in chat. Generate secrets on the box: `openssl rand -hex 32`.
- **Brand verifier:** `pwsh ./counsel-day-complete/scripts/brand-verify.ps1` · must exit 0 before every commit.
- **Single-file lint:** `pwsh ./counsel-day-complete/scripts/brand-verify.ps1 -Path counsel-day-complete/help.html`.
- **Deploy:** `./counsel-day-app/scripts/deploy.sh` (tar over ssh). Rebuilds lockfile when package.json changes.

---

*Memory references: [project_admin_stack.md], [project_verdict_ai_tiering.md], [project_locked_settings.md], [feedback_security_hardening.md], [project_zoho_workspace.md], [project_ga4_funnel.md].*
