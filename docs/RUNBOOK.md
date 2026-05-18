# Counsel.day · Operations Runbook

The canonical "how do I…" for running counsel.day in production. Read this before you need it.

**Infrastructure (May 2026)**:
- One Hetzner Cloud CAX11 ARM server · 2 vCPU · 4 GB RAM · 38 GB disk · Nuremberg (eu-central)
- IPv4: `46.225.133.203` · IPv6: `2a01:4f8:1c18:7dba::1`
- Ubuntu 24.04 LTS
- Caddy 2.6.2 (TLS, reverse-proxy, static file server)
- PostgreSQL 16.13 (localhost only, port 5432)
- Node.js 20.20.2
- `counsel-day-app` Next.js 15 service (systemd, bound 127.0.0.1:3000)
- Cloudflare DNS-only (no proxy)
- SSH key: `~/.ssh/id_ed25519_counsel_day`
- Caddy basic-auth gates `/admin*` (admin@counsel.day) and `/account*` (demo@counsel.day)

---

## Layout on the server

```
/var/www/counsel.day/        # static site (counsel-day-complete/) · served by Caddy
/opt/counsel-day-app/        # Next.js app · run by systemd
/etc/counsel-day-app/        # secrets (mode 700, owner deploy)
  ├── db.password            #   raw DB password (mode 600)
  └── env.local              #   full env file consumed by systemd EnvironmentFile (mode 600)
/etc/caddy/Caddyfile         # web server config (root-owned, mode 644)
/etc/systemd/system/         # service units
  └── counsel-day-app.service
```

---

## Common operations

### Deploy a code change

From a checkout of `counsel-day-app/`:

```bash
bash scripts/deploy.sh
```

The script does, in order: typecheck → rsync source → `npm ci` → `npm run build` → run migrations → restart systemd → curl `/api/health`.

Failure at any step aborts the deploy and leaves the previous version running.

### Deploy a static-site change

From a checkout of `counsel-day-complete/`:

```bash
cd counsel-day-complete
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./scripts/brand-verify.ps1   # required: 25+ pass, 0 fail
tar -czf - --exclude='og-image-generator.html' --exclude='homepage.html' \
           --exclude='*.zip' --exclude='scripts' --exclude='ops' . \
  | ssh -i $HOME/.ssh/id_ed25519_counsel_day deploy@46.225.133.203 \
    "tar -xzf - -C /var/www/counsel.day && find /var/www/counsel.day -type f -exec chmod 644 {} \;"
```

### Roll back the app

`systemd` does not auto-keep prior builds. Roll back via git:

```bash
git checkout <previous-good-sha>
bash scripts/deploy.sh
```

For a Caddyfile rollback, every previous version is preserved on the box at `/etc/caddy/Caddyfile.bak.<timestamp>`. Restore the most recent:

```bash
ssh deploy@46.225.133.203 "
  LATEST=\$(ls -t /etc/caddy/Caddyfile.bak.* | head -1)
  sudo cp \$LATEST /etc/caddy/Caddyfile
  sudo systemctl reload caddy
"
```

### Tail logs

```bash
# Next.js app
ssh deploy@46.225.133.203 "sudo journalctl -u counsel-day-app -n 200 -f"

# Caddy
ssh deploy@46.225.133.203 "sudo journalctl -u caddy -n 200 -f"

# Postgres
ssh deploy@46.225.133.203 "sudo journalctl -u postgresql -n 200 -f"
```

### Connect to the database

```bash
ssh deploy@46.225.133.203
sudo -u postgres psql counsel_day
```

Or from the app's perspective (uses the app role, exercises RLS-style constraints):

```bash
ssh deploy@46.225.133.203
set -a; source /etc/counsel-day-app/env.local; set +a
psql "$DATABASE_URL"
```

### Run an ad-hoc query

```bash
ssh deploy@46.225.133.203 "sudo -u postgres psql counsel_day -c 'SELECT count(*) FROM users;'"
```

### Create a one-off database backup

```bash
ssh deploy@46.225.133.203 "sudo -u postgres pg_dump -Fc counsel_day > /tmp/counsel-day-\$(date +%Y%m%d-%H%M%S).dump"
scp -i $HOME/.ssh/id_ed25519_counsel_day deploy@46.225.133.203:/tmp/counsel-day-*.dump ./backups/
ssh deploy@46.225.133.203 "rm /tmp/counsel-day-*.dump"
```

For scheduled backups, see "Hetzner Cloud snapshots" below.

### Restart the app without redeploying

```bash
ssh deploy@46.225.133.203 "sudo systemctl restart counsel-day-app && sudo systemctl is-active counsel-day-app"
```

### Reload Caddy after a config change

```bash
ssh deploy@46.225.133.203 "sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile && sudo systemctl reload caddy"
```

Always validate first; `reload` is zero-downtime, `restart` is not.

---

## First-time setup on a fresh server

These steps were run once on 17 May 2026; do not repeat unless rebuilding the box.

1. Provision the Hetzner CAX11, add the SSH key, lock down via Cloud Firewall (allow only 22/tcp, 80/tcp, 443/tcp).
2. Install Caddy + Postgres 16 via apt.
3. Create the `deploy` user; give it sudo for the operational commands documented above (not full root).
4. Install Node 20 via NodeSource (`scripts/first-time-install.sh` documents the apt step).
5. Create the `counsel_day` Postgres database + `counsel_day_app` role with a random password generated on the server.
6. Write `/etc/counsel-day-app/env.local` containing `DATABASE_URL=postgresql://counsel_day_app:<pw>@127.0.0.1:5432/counsel_day` plus the other env vars from `.env.example`. Mode 600, owner `deploy`.
7. Run `bash scripts/first-time-install.sh` to drop the systemd unit, enable on boot, create `/opt/counsel-day-app`.
8. Run `bash scripts/deploy.sh` to ship the code, run migrations, and start the service.
9. Confirm: `curl https://counsel.day/api/health` returns `{"ok":true,"db":"ok",...}`.

---

## Secrets · where they live, how to rotate

| Secret | Location | Rotation cadence |
|---|---|---|
| Postgres app-user password | `/etc/counsel-day-app/db.password` and `env.local` | Quarterly, or on any team change |
| Caddy admin basic-auth (admin@counsel.day) | `/etc/caddy/Caddyfile` (bcrypt hash inline) | Quarterly, immediately on team change |
| Caddy account basic-auth (demo@counsel.day) | `/etc/caddy/Caddyfile` | Quarterly |
| `BREVO_API_KEY` | `/etc/counsel-day-app/env.local` | When team changes; when key is in any leaked artefact |
| `STRIPE_SECRET_KEY` | `/etc/counsel-day-app/env.local` | When team changes; never log |
| `ANTHROPIC_API_KEY` | `/etc/counsel-day-app/env.local` | Every 60 days (per Anthropic best practice) |
| `RECAPTCHA_V3_SECRET_KEY` | `/etc/counsel-day-app/env.local` | Annual |
| `SESSION_SIGNING_KEY` | `/etc/counsel-day-app/env.local` | Quarterly. Rotation invalidates all sessions; users re-login. |
| SSH private key | `~/.ssh/id_ed25519_counsel_day` on operator laptops | Annual; on any laptop loss/compromise |

To rotate a value in `env.local`:

```bash
ssh deploy@46.225.133.203
sudo nano /etc/counsel-day-app/env.local         # edit the line
sudo systemctl restart counsel-day-app           # pick up the new value
sudo systemctl is-active counsel-day-app         # confirm
```

To rotate the Postgres app password:

```bash
ssh deploy@46.225.133.203
NEW=$(openssl rand -hex 32)
sudo -u postgres psql -c "ALTER USER counsel_day_app PASSWORD '${NEW}';"
echo "${NEW}" > /etc/counsel-day-app/db.password
# Update env.local DATABASE_URL line to use ${NEW}, then:
sudo systemctl restart counsel-day-app
```

---

## Backups

**Hetzner Cloud snapshots**: enable daily snapshots in the Hetzner console (Server → Backups → Enable). ~20% surcharge on the box price. Snapshots are kept ~7 days.

**Logical Postgres backups** (recommended in addition to snapshots, for point-in-time DB restores without rolling the OS state):

Add to `deploy` user's crontab on the server:

```cron
0 3 * * * /usr/bin/pg_dump -U counsel_day_app -h 127.0.0.1 counsel_day | gzip > /var/backups/counsel_day-$(date +\%Y\%m\%d).sql.gz && find /var/backups -name 'counsel_day-*.sql.gz' -mtime +14 -delete
```

(Off-box backup is a follow-up item; see security backlog L5.)

---

## Disaster scenarios

### The app process is up but `/api/health` returns 503

Cause is almost always the database. Check:

```bash
ssh deploy@46.225.133.203 "
  sudo systemctl status postgresql
  sudo -u postgres psql -c 'SELECT 1;'
"
```

If Postgres is down: `sudo systemctl restart postgresql`. If it stays down, check disk: `df -h`. If disk is full, the most common cause is uncapped log files in `/var/log/`.

### Caddy is responding but the app routes are 502

The Next.js process crashed. The systemd unit will auto-restart up to 5 times; after that it stays stopped.

```bash
ssh deploy@46.225.133.203 "
  sudo systemctl status counsel-day-app
  sudo journalctl -u counsel-day-app -n 100 --no-pager
"
```

Force-start:

```bash
sudo systemctl reset-failed counsel-day-app
sudo systemctl start counsel-day-app
```

### Cert expired / TLS broken

Caddy renews Let's Encrypt automatically. If the renewal failed:

```bash
ssh deploy@46.225.133.203 "
  sudo journalctl -u caddy --since '2 days ago' | grep -i 'acme\\|renew\\|cert' | tail -50
"
```

Usually a DNS issue (Cloudflare misconfiguration) or a rate-limit. Re-trigger:

```bash
ssh deploy@46.225.133.203 "sudo systemctl reload caddy"
```

### "I accidentally pushed admin.html without basic auth"

Inspect first:

```bash
curl -sI https://counsel.day/admin.html | head -3        # expect 401
```

If it returns 200, the Caddyfile got overwritten or the matcher fell out. Restore the canonical Caddyfile (in `counsel-day-complete/ops/Caddyfile`) and reload Caddy. The basic-auth block lives under the `counsel.day` site block; see `docs/SECURITY_HARDENING.md` for the canonical snippet.

---

## Known constraints · do not "fix" these

### V8 + `MemoryDenyWriteExecute=true` is incompatible

The systemd unit at `/etc/systemd/system/counsel-day-app.service` **must not** set `MemoryDenyWriteExecute=true`. Every Node.js process SIGTRAPs at startup with `Check failed: 12 == errno()` because V8's JIT compiler needs to map memory as RWX (write + execute) to compile JavaScript at runtime.

Symptom: the systemd unit shows `Active: activating (auto-restart) (Result: core-dump)` and `journalctl -u counsel-day-app` shows a long V8 fatal stack trace ending in `v8::base::OS::SetPermissions` and `BaselineCompiler::Build`.

The unit file ships with the line:

```ini
# MemoryDenyWriteExecute is incompatible with V8's JIT compilation; omit
# for Node processes or the process SIGTRAPs at startup.
```

Do not add it back even if a systemd hardening checklist tells you to. Discovered the hard way on 17 May 2026.

### Caddy `try_files {path} {path}.html` rewrites BEFORE matchers

The Caddyfile uses `try_files` to serve `/about` from `about.html` etc. Matchers in directives like `basicauth @admin` and `respond @blocked` evaluate AFTER the rewrite, so a matcher must reference the post-rewrite path (e.g. `/admin.html`) not the original. The current `@admin path /admin /admin.html /admin-app.js` covers both cases. If you add a new matcher, list both extensions.

### React 19 needs Next.js 15.1+

React 19 stable was pinned in `package.json`. Next.js 15.0.x peer-depends on React 18 or a specific React 19 RC, so the install fails with an ERESOLVE error. Next.js 15.1.0+ is the floor that supports React 19 stable. Discovered 17 May 2026 during scaffold.

### Brevo sender must be a validated address

Email sends fail with HTTP 200 + a `"reason": "sender not valid"` event in `/v3/smtp/statistics/events` if the sender is not in the validated-senders list at Brevo (Senders & IP → Senders). Today only `admin@counsel.day` is validated, so that's what `src/lib/email.ts` uses. To switch to `hello@counsel.day` (or any other), either add it as a validated sender in Brevo, or publish DKIM + SPF + DMARC on `counsel.day` so any address at the domain is auto-trusted.

---

## Where to look for X

| Question | Answer |
|---|---|
| What does the brand verifier check? | `counsel-day-complete/scripts/brand-verify.ps1` · 12 checks · run before every deploy |
| What integrations does the backend depend on? | `docs/INTEGRATION_BACKLOG.md` |
| What security issues are still open? | `docs/SECURITY_HARDENING.md` |
| What GA4 events exist? | `docs/GA4_FUNNEL.md` |
| What's the SEO posture per page? | `docs/COUNSEL_DAY_SEO_STRATEGY.md` |
| What's the brand discipline? | `docs/BRAND.md` |

---

## Operational signup checklist · external services that need user action

These are one-time external-account creations that the code cannot do for you. Each takes 5-15 minutes; do them in order. After each, the corresponding code in the repo activates automatically because every integration is gated on its env var being present.

### 1 · Sentry (error monitoring)

The `@sentry/nextjs` package is wired into [next.config.ts](../counsel-day-app/next.config.ts), [src/instrumentation.ts](../counsel-day-app/src/instrumentation.ts), and three `sentry.*.config.ts` files. When `SENTRY_DSN` is set, every uncaught exception in `/api/*` routes + middleware ships to Sentry with the request path, stack trace, and timing. PII is stripped (cookies, Authorization header, request body, Stripe signature).

**Setup:**
1. https://sentry.io/signup → create account (free tier: 5K errors/month, 50 replays/month)
2. Create a new project: platform = **Next.js**, alert frequency = "Default"
3. Copy the DSN (format: `https://abc123@o12345.ingest.us.sentry.io/67890`)
4. Install on the server:
   ```bash
   read -rsp "Paste SENTRY_DSN (input hidden), then press Enter: " SENTRY_DSN && echo && \
   ssh -i ~/.ssh/id_ed25519_counsel_day deploy@46.225.133.203 \
     "sudo sed -i '/^SENTRY_DSN=/d' /etc/counsel-day-app/env.local && \
      echo \"SENTRY_DSN=$SENTRY_DSN\" | sudo tee -a /etc/counsel-day-app/env.local > /dev/null && \
      sudo chmod 600 /etc/counsel-day-app/env.local && \
      sudo systemctl restart counsel-day-app && \
      sudo systemctl is-active counsel-day-app" && \
   unset SENTRY_DSN
   ```
5. Verify by triggering a test error (e.g. tail journalctl while making a malformed POST to `/api/compose`) and check Sentry's project dashboard.
6. Set up alerting in Sentry: Settings → Alerts → "Send a Slack/email message when an issue first happens".

**Optional · source-map upload at build time:**
Add `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` to `/etc/counsel-day-app/env.local` (auth token from Sentry → Settings → Auth Tokens, scope: `project:releases`). With those set, every build uploads source maps so stack traces deminify.

### 2 · UptimeRobot (external liveness monitoring)

Hetzner has no external uptime monitoring built in. UptimeRobot's free tier covers 50 monitors at 5-minute intervals · plenty for one site.

**Setup:**
1. https://uptimerobot.com/signUp → free account
2. **+ New Monitor** with three monitors:
   - **Type:** HTTPS, **URL:** `https://counsel.day/`, **Name:** "Counsel.day homepage", **Interval:** 5 min
   - **Type:** HTTPS keyword, **URL:** `https://counsel.day/api/health`, **Name:** "Counsel.day API", **Interval:** 5 min, **Keyword:** `"ok":true` (alert if absent)
   - **Type:** HTTPS, **URL:** `https://counsel.day/admin`, **Name:** "Counsel.day admin", **Interval:** 5 min, **Expected status:** 401 (admin is basic-auth gated; 401 means alive, 200 or 5xx means broken)
3. **Alert contacts:** add `admin@counsel.day` (and a phone number if you want SMS · free tier excludes SMS but includes email).
4. **Public status page** (optional, free): Status Pages → Add → "Counsel.day", attach the three monitors. Link the resulting `stats.uptimerobot.com/...` URL from `/status.html` so visitors see real uptime data.

### 3 · DMARC aggregator (read the daily reports)

Today the DMARC record points reports to `rua=mailto:rua@dmarc.brevo.com` (a Brevo-hosted aggregator). That works for Brevo emails but gives no visibility into spoofing attempts or third-party sends. Adding a real DMARC aggregator gives you a human-readable dashboard of who is sending email claiming to be `counsel.day`.

**Setup (any of these · pick one, all free for low volume):**
- **Postmark DMARC** at https://dmarc.postmarkapp.com/ · free, weekly email digest
- **DMARCian** at https://dmarcian.com/ · free up to 100K messages/month
- **dmarc.report** at https://dmarc.report/ · free, real-time dashboard

**Steps (Postmark example):**
1. Sign up at https://dmarc.postmarkapp.com/ with `admin@counsel.day`
2. They give you a `rua` email like `random-id@inbox-dmarc.postmarkapp.com`
3. Update the DNS record at Cloudflare → DNS → Records → `_dmarc.counsel.day` TXT record:
   ```
   v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com,mailto:random-id@inbox-dmarc.postmarkapp.com
   ```
   (comma-separated · keeps the Brevo aggregator AND adds the new one)
4. Wait 24-48 hours; the first daily digest arrives by email.
5. After a month of clean reports with `p=none`, escalate to `p=quarantine` then `p=reject` to actively block spoofing.

### 4 · `security@counsel.day` email alias (Zoho)

The `/.well-known/security.txt` and the CAA `iodef` record both reference `mailto:security@counsel.day`. That address must be deliverable.

**Steps:**
1. Log in to https://mailadmin.zoho.com/cpanel/index.do (Zoho Mail Admin)
2. **Mail Accounts** → click `admin@counsel.day`
3. **Email Aliases** tab → **+ Add Alias**
4. New alias: `security@counsel.day` → routes to `admin@counsel.day`
5. Save. Test by sending an email from a different account to `security@counsel.day` · should arrive in admin@'s inbox.

While you're there, do the same for: `press@`, `corrections@`, `therapists@`, `privacy@`, `james@`, `hello@`. Each is referenced from `/contact.html` and the security/contact JSON-LD blocks. Aliases are free in Zoho (don't count against the mailbox quota).

### 5 · GitHub Actions deploy

The workflow is committed at [.github/workflows/deploy.yml](../.github/workflows/deploy.yml). It triggers on push to `main` for changes under `counsel-day-app/` or `counsel-day-complete/`, typechecks + brand-verifies, then ships via SSH.

**Setup:**
1. GitHub → your repo → Settings → Secrets and variables → Actions → New repository secret. Add four:
   - `SSH_PRIVATE_KEY` · paste the entire contents of `~/.ssh/id_ed25519_counsel_day` from your local machine, including `-----BEGIN OPENSSH PRIVATE KEY-----` and `-----END OPENSSH PRIVATE KEY-----`
   - `SSH_HOST` · `46.225.133.203`
   - `SSH_USER` · `deploy`
   - `SSH_KNOWN_HOSTS` · run `ssh-keyscan -t ed25519 46.225.133.203` locally and paste the single-line output
2. **Optional · gate behind manual approval for the first month**: Settings → Environments → New environment "production" → enable "Required reviewers" with your account. Then uncomment the `environment: production` line in the workflow.
3. Test by pushing a tiny doc change to `main`. The workflow should skip both deploy jobs (doc-only changes are excluded). Then push an actual app/static change · both jobs run, ssh in, deploy, health-check.
4. Failure modes:
   - `Host key verification failed` → `SSH_KNOWN_HOSTS` is missing or wrong
   - `Permission denied (publickey)` → `SSH_PRIVATE_KEY` is missing, malformed, or doesn't match the deploy user's `authorized_keys`
   - `Build failed` → typecheck errors caught upstream of the deploy; fix and re-push

Local `bash counsel-day-app/scripts/deploy.sh` continues to work as a manual override.

### 6 · Rotate the keys that leaked in chat

Three keys appeared in plaintext in the AI-assisted build conversation: Brevo API key, Stripe live secret key, Stripe webhook signing secret. Rotate before any public launch. Each takes 2-3 minutes.

**Brevo API key:**
1. https://app.brevo.com/security/api-keys → click the existing key → **Delete**
2. **+ Generate a new API key** → name `counsel-day-prod-2026-05-18`
3. Install via SSH:
   ```bash
   read -rsp "Paste BREVO_API_KEY (input hidden): " BREVO_API_KEY && echo && \
   ssh -i ~/.ssh/id_ed25519_counsel_day deploy@46.225.133.203 \
     "sudo sed -i '/^BREVO_API_KEY=/d' /etc/counsel-day-app/env.local && \
      echo \"BREVO_API_KEY=$BREVO_API_KEY\" | sudo tee -a /etc/counsel-day-app/env.local > /dev/null && \
      sudo chmod 600 /etc/counsel-day-app/env.local && \
      sudo systemctl restart counsel-day-app && \
      sudo systemctl is-active counsel-day-app" && \
   unset BREVO_API_KEY
   ```
4. Send a test email (trigger your own password reset) to verify.

**Stripe live secret key:**
1. https://dashboard.stripe.com/apikeys → "Secret key" row → **Roll key**
2. Pick "expire in 1 hour" so the old key still works briefly during deploy
3. Copy the new `sk_live_...` value
4. Install via SSH (same pattern as Brevo, using `STRIPE_SECRET_KEY=...`)
5. Verify by hitting `/pricing` and clicking through to a checkout (you can cancel from Stripe's hosted page without paying)

**Stripe webhook signing secret:**
1. https://dashboard.stripe.com/webhooks → click the counsel.day endpoint → "Signing secret" → **Roll**
2. Copy the new `whsec_...` value
3. Install via SSH (using `STRIPE_WEBHOOK_SECRET=...`)
4. Verify in Stripe → Webhooks → recent attempts · should now succeed with the new secret

After all three: verify nothing's broken by hitting `https://counsel.day/api/health` (200) and triggering one of each integration (signup → email arrives, pricing → checkout opens, webhook → recent delivery succeeds).

---

*Last updated 18 May 2026. Update this file whenever the answer to "how do I do X in production" changes.*
