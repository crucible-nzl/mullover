# Counsel.day server setup · step by step

This is the canonical setup walkthrough for the first three steps of the roadmap:
**(A) domain + edge, (B) Hetzner CPX31 with LUKS-encrypted Postgres volume, (C) self-hosted Infisical** as the secrets manager. Everything below is run once, in order, and produces a hardened, encrypted, EU-hosted server with a working secrets manager and a public-facing edge through Cloudflare.

Estimated time end to end: **4 to 6 hours** of active work, spread across one or two sessions. Estimated monthly cost after this is complete: **~$25 USD/month** (Hetzner €14 + Cloudflare $0 + domain $10/year amortised + everything else free until volume).

The supporting files in this directory are referenced by section number. Copy them to the right place on the server as each step calls for them.

---

## Phase A · Domain and Cloudflare edge

### A.1 · Register `counsel.day` at Cloudflare Registrar

1. Sign in or sign up at **dash.cloudflare.com**.
2. From the dashboard, click **Domain Registration → Register Domains**.
3. Search for `counsel.day`. Cloudflare charges at-cost (around USD 10/year for a `.day` domain) with no markup, free WHOIS privacy, free DNSSEC.
4. Complete the registration. Use your real legal contact details · the Cloudflare WHOIS privacy proxy hides them in public WHOIS lookups.
5. The domain is automatically added to your Cloudflare account as a zone. **Skip the "import existing DNS" step**, since the domain is new and has no records yet.

> **Why Cloudflare Registrar:** at-cost pricing forever, no upsells, free DNSSEC, and the DNS / Pages / R2 / Tunnel stack is the same vendor. One billing relationship, one console.

### A.2 · Enable DNSSEC

In the Cloudflare dashboard for `counsel.day`:
1. **DNS → Settings → DNSSEC** → **Enable DNSSEC**.
2. Because Cloudflare is both the registrar and the DNS provider, the DS record is added at the registry automatically. Verify with `dig counsel.day DS` from your local machine; you should see a DS record returned.

### A.3 · Add the DNS records

Open `dns/records.md` in this directory for the full table. The records you can add **immediately**:

| Type | Name | Value | Notes |
|---|---|---|---|
| TXT | counsel.day | `v=spf1 include:spf.brevo.com include:zoho.eu ~all` | Brevo (outbound) + Zoho (inbound), both authorised |
| TXT | _dmarc | `v=DMARC1; p=quarantine; rua=mailto:dpo@counsel.day; ruf=mailto:dpo@counsel.day; fo=1; aspf=s; adkim=s` | Strict DMARC, reports to dpo@ |
| MX | counsel.day | `10 mx.zoho.eu` `20 mx2.zoho.eu` `50 mx3.zoho.eu` | Inbound to Zoho Mail (EU) |
| CAA | counsel.day | `0 issue "letsencrypt.org"` | Only Let's Encrypt may issue certificates |
| CAA | counsel.day | `0 issuewild "letsencrypt.org"` | Same for wildcards |
| CAA | counsel.day | `0 iodef "mailto:security@counsel.day"` | Notify us on misissuance attempts |

The remaining records (`A counsel.day → Pages`, `A app → Hetzner IP`, `CNAME auth → Auth0`, `CNAME vault → Hetzner IP`) you will add as each service comes online. The placeholder for Cloudflare Pages auto-fills when you connect the repo in step A.6.

### A.4 · Set SSL and security defaults

In the Cloudflare dashboard:
1. **SSL/TLS → Overview** → set encryption mode to **Full (Strict)**.
2. **SSL/TLS → Edge Certificates** → **Always Use HTTPS = On**, **Automatic HTTPS Rewrites = On**, **Minimum TLS Version = 1.2**, **Opportunistic Encryption = On**.
3. **SSL/TLS → Edge Certificates → HTTP Strict Transport Security (HSTS)** → enable with **max-age 12 months**, **include subdomains**, **preload = On**. Add the domain to the HSTS Preload List at [hstspreload.org](https://hstspreload.org) after the site is reachable on HTTPS.
4. **Security → Settings** → **Security Level = Medium**, **Bot Fight Mode = On**, **Challenge Passage = 30 minutes**.
5. **Speed → Optimization** → **Brotli = On**, **Auto Minify = Off** (we control HTML directly), **Early Hints = On**.
6. **Caching → Configuration** → **Browser Cache TTL = Respect Existing Headers**.

### A.5 · Create a scoped API token for the Caddy DNS challenge

Caddy needs to write TXT records under `_acme-challenge.*.counsel.day` to prove ownership for Let's Encrypt. We give it the narrowest possible token.

1. **My Profile → API Tokens → Create Token → Custom Token**.
2. Token name: `caddy-dns-challenge`.
3. Permissions: `Zone → DNS → Edit`.
4. Zone Resources: `Include → Specific zone → counsel.day`.
5. Create token. **Copy the value once · it is not shown again.** You will paste it into Infisical in step C.6.

### A.6 · Connect the GitHub repo to Cloudflare Pages

1. **Workers & Pages → Create application → Pages → Connect to Git**.
2. Authorise Cloudflare to read your GitHub repo containing `counsel-day-complete/`.
3. Project name: `counsel-day`.
4. Production branch: `main`.
5. Framework preset: **None** (static HTML).
6. Build command: leave empty.
7. Build output directory: `counsel-day-complete`.
8. Environment variables: none required for the static site.
9. Save and deploy. You get a `counsel-day.pages.dev` URL in 30-60 seconds.
10. **Custom domains → Set up a custom domain → `counsel.day`** and **`www.counsel.day`**. Cloudflare auto-creates the A/CNAME records. Verify the site responds at `https://counsel.day` (HTTPS comes for free).

> **At this point your marketing site is live publicly**, on a custom domain, with HTTPS, before the application server even exists. The remaining phases bring up the app surface.

---

## Phase B · Hetzner CPX31 server

### B.1 · Sign up at Hetzner Cloud

1. Sign up at **console.hetzner.cloud**. Use the same legal contact details as Cloudflare. Hetzner asks for ID verification; expect a 24-hour delay if you are new.
2. Once verified, create a **Project** named `counsel-day-prod`.
3. **Security → SSH Keys → Add SSH Key**. Paste your local public key (the contents of `~/.ssh/id_ed25519.pub`). If you don't have one, generate it on your local machine first: `ssh-keygen -t ed25519 -C "james@counsel.day"`. Name it `james-laptop` or similar.

### B.2 · Provision the CPX31

1. **Servers → Add Server**.
2. **Location**: `Falkenstein (fsn1)` for EU latency, or `Helsinki (hel1)` for slightly newer hardware. Pick one and stay with it; cross-region traffic is paid.
3. **Image**: `Ubuntu 24.04`.
4. **Type**: **CPX31** (4 vCPU AMD, 8 GB RAM, 160 GB NVMe SSD, €14.99/month including 20 TB traffic).
5. **Networking**: leave defaults (IPv4 + IPv6 public).
6. **SSH keys**: select the one you uploaded in B.1.
7. **Volumes**: **Add Volume → 40 GB**, name `pg-data`, format **None** (we LUKS-format it ourselves). The volume is added at €1.60/month and lives at `/dev/disk/by-id/scsi-0HC_Volume_<id>` on the server.
8. **Firewalls**: create a new firewall named `prod-edge` with these inbound rules and attach it.
   - Allow `TCP 22` from `0.0.0.0/0, ::/0` (SSH; we further restrict via fail2ban)
   - Allow `TCP 80` from `0.0.0.0/0, ::/0` (HTTP, redirected to HTTPS by Caddy)
   - Allow `TCP 443` from `0.0.0.0/0, ::/0` (HTTPS, served by Caddy)
   - Deny all other inbound
9. **Backups**: enable Hetzner's automatic weekly backups (+20% cost, ~€3/month). Keeps 7 daily/4 weekly snapshots. Separate from our R2 offsite backups; defence in depth.
10. **Name**: `counsel-day-app-1`.
11. **Create & Buy now**. The server is ready in 30-60 seconds. Note the public IPv4 address; you will use it everywhere below.

### B.3 · First SSH connection and counsel user

Open PowerShell on your Windows machine. Replace `<HETZNER_IP>` with the IPv4 you just got.

```powershell
ssh root@<HETZNER_IP>
```

If this is the first time, accept the host key fingerprint. You should land on a root prompt.

Now drop the `bootstrap.sh` script from this repo onto the server. From your local machine, in a new PowerShell window:

```powershell
scp counsel-day-server/scripts/bootstrap.sh root@<HETZNER_IP>:/root/bootstrap.sh
```

Back in the SSH session on the server:

```bash
chmod +x /root/bootstrap.sh
/root/bootstrap.sh
```

What `bootstrap.sh` does (see the script for the full source):
- Sets the hostname to `counsel-day-app-1` and the timezone to `Etc/UTC`.
- Updates apt, installs `ufw`, `fail2ban`, `unattended-upgrades`, `age`, `cryptsetup`, `htop`, `curl`, `git`, `ca-certificates`.
- Creates a `counsel` user with sudo and copies your SSH key from root.
- Disables root SSH login and password SSH (key-only).
- Configures UFW to allow 22, 80, 443 only and enables it.
- Configures fail2ban watching sshd with a 1-hour ban after 5 failures.
- Configures unattended-upgrades for security patches.
- Installs Docker Engine + the compose plugin from Docker's official apt repo.
- Prints the new `counsel` user's home and asks you to test SSH as `counsel@<IP>` from a separate window before continuing.

**Do not close the root session until you have confirmed that you can SSH in as `counsel@<HETZNER_IP>`.** From a new PowerShell on your laptop:

```powershell
ssh counsel@<HETZNER_IP>
```

Once that works, you can `exit` the root session and continue all further work as `counsel`.

### B.4 · LUKS-format the data volume

Still SSH'd in as `counsel` (use `sudo -i` to root for these commands):

1. Find the volume device path:
   ```bash
   sudo ls -l /dev/disk/by-id/ | grep HC_Volume
   ```
   Note the path · it will look like `scsi-0HC_Volume_12345678 -> ../../sdb`.

2. Generate a strong passphrase (save it temporarily in a file, we will move it into Infisical in step C.7):
   ```bash
   sudo openssl rand -base64 48 > /root/.luks-pass
   sudo chmod 600 /root/.luks-pass
   ```

3. LUKS2 format the volume (this is destructive; the volume is brand new and empty):
   ```bash
   sudo cryptsetup luksFormat \
     --type luks2 \
     --cipher aes-xts-plain64 \
     --key-size 512 \
     --hash sha512 \
     --pbkdf argon2id \
     --pbkdf-memory 1048576 \
     --key-file /root/.luks-pass \
     /dev/disk/by-id/scsi-0HC_Volume_<id>
   ```
   The `argon2id` PBKDF with 1 GiB memory cost makes offline brute force against the passphrase infeasible.

4. Open the LUKS volume:
   ```bash
   sudo cryptsetup luksOpen \
     --key-file /root/.luks-pass \
     /dev/disk/by-id/scsi-0HC_Volume_<id> \
     pg-data-decrypted
   ```
   The decrypted device is now at `/dev/mapper/pg-data-decrypted`.

5. Format the decrypted device as ext4 and mount it:
   ```bash
   sudo mkfs.ext4 -L pg-data /dev/mapper/pg-data-decrypted
   sudo mkdir -p /var/lib/postgres-data
   sudo mount /dev/mapper/pg-data-decrypted /var/lib/postgres-data
   sudo chown counsel:counsel /var/lib/postgres-data
   ```

6. Verify by writing a sentinel file:
   ```bash
   echo "encrypted at rest since $(date -Iseconds)" | sudo tee /var/lib/postgres-data/.luks-active
   sudo cat /var/lib/postgres-data/.luks-active
   ```

We will install the systemd unit in `systemd/luks-unlock.service` later, in step C.8, after Infisical exists to hold the passphrase.

### B.5 · Confirm the host is hardened

Run the verification script:

```bash
scp counsel-day-server/scripts/verify.sh counsel@<HETZNER_IP>:/home/counsel/verify.sh
ssh counsel@<HETZNER_IP> 'chmod +x verify.sh && sudo ./verify.sh'
```

The script checks: SSH root login disabled, password auth disabled, UFW allows only 22/80/443, fail2ban is running, unattended-upgrades enabled, Docker installed, LUKS volume mounted, and the LUKS sentinel is present. It exits non-zero if any check fails. **Stop and fix anything that fails before proceeding to Phase C.**

---

## Phase C · Caddy and self-hosted Infisical

### C.1 · Clone this repo onto the server

```bash
ssh counsel@<HETZNER_IP>
mkdir -p ~/counsel-day-server
exit
```

From your local machine:

```powershell
scp -r counsel-day-server/* counsel@<HETZNER_IP>:/home/counsel/counsel-day-server/
```

Back on the server:

```bash
ssh counsel@<HETZNER_IP>
cd ~/counsel-day-server
```

### C.2 · Build the custom Caddy image with the Cloudflare DNS plugin

We need Caddy to do the ACME DNS-01 challenge through Cloudflare so we get auto-renewed Let's Encrypt certificates without ever opening port 80 (Cloudflare's edge proxy handles HTTP traffic). The official Caddy image does not include the Cloudflare DNS provider, so we build a slim image with it baked in. See `caddy/Dockerfile`.

```bash
cd ~/counsel-day-server
docker build -t caddy-cloudflare:latest ./caddy
```

This takes 2-3 minutes the first time. Subsequent builds are cached.

### C.3 · Provision Caddy's reverse proxy config

`Caddyfile` is included in this repo. Open it and verify the `vault.counsel.day` block points at the Infisical container by its internal docker network name. The token for the Cloudflare DNS challenge is referenced by environment variable; we set it in C.6.

### C.4 · Start Infisical

The `docker-compose.infisical.yml` file in this repo stands up Infisical with its own Postgres database (separate from the application database we will set up later) and Redis instance. Edit the file to set strong admin credentials in the environment block, then:

```bash
cd ~/counsel-day-server
docker compose -f docker-compose.infisical.yml up -d
```

Wait 30 seconds, then check it is running:

```bash
docker compose -f docker-compose.infisical.yml ps
docker compose -f docker-compose.infisical.yml logs --tail 50 backend
```

You should see `infisical-backend` listening on port `8080` internally.

### C.5 · Add DNS for `vault.counsel.day` and start Caddy

In Cloudflare DNS, add an **A** record:
- Name: `vault`
- Value: `<HETZNER_IP>`
- Proxy status: **DNS only** (grey cloud · we want Let's Encrypt and Infisical to see the real IP, not Cloudflare's proxy).

Wait 1 minute for DNS propagation, then start Caddy:

```bash
cd ~/counsel-day-server
docker compose -f docker-compose.caddy.yml up -d
docker compose -f docker-compose.caddy.yml logs --tail 100 caddy
```

The first time Caddy starts it does the ACME DNS-01 challenge through Cloudflare and provisions a Let's Encrypt certificate for `vault.counsel.day`. Watch the logs for `certificate obtained successfully` · this takes ~30 seconds.

Open **https://vault.counsel.day** in your browser. You should see the Infisical login page on a valid Let's Encrypt certificate.

### C.6 · Create the Infisical admin account and the production project

1. At `https://vault.counsel.day`, sign up with `james@counsel.day` (or a stronger admin address). Use a passphrase generator for the password and store it in your password manager. **MFA via TOTP is mandatory** · enable it before logging out for the first time.
2. Create a project named `counsel-day-prod`.
3. Inside the project, create three environments: `production`, `staging`, `development`. Most secrets will live in `production`.
4. Create the following initial secrets in `production`:

| Key | Initial value | Notes |
|---|---|---|
| `CLOUDFLARE_DNS_API_TOKEN` | (paste the token from step A.5) | Caddy DNS-01 challenge token |
| `LUKS_PASSPHRASE` | (paste the contents of `/root/.luks-pass`) | LUKS2 volume passphrase |
| `POSTGRES_SUPERUSER_PASSWORD` | (generate with `openssl rand -base64 32`) | For the app's Postgres, when we set it up |
| `POSTGRES_APP_PASSWORD` | (generate with `openssl rand -base64 32`) | App role on Postgres |
| `REDIS_PASSWORD` | (generate with `openssl rand -base64 32`) | App Redis password |
| `ANTHROPIC_API_KEY` | (paste production key from console.anthropic.com) | For the verdict synthesis, paid tier only |
| `BREVO_API_KEY` | (paste from app.brevo.com) | Outbound transactional email |
| `AUTH0_DOMAIN` | (your Auth0 tenant) | Set once Auth0 tenant exists |
| `AUTH0_CLIENT_SECRET` | (from Auth0) | Set once Auth0 tenant exists |
| `STRIPE_SECRET_KEY` | (paste live key) | Set after Stripe verification |
| `BACKUP_AGE_RECIPIENT_PUBLIC_KEY` | (generate with `age-keygen`) | Public half · encrypt backups to this |

5. Create a **machine identity** named `caddy-host` with a single permission: read secrets from `production`. Generate a service token, copy the value, and stop. We will use it on the host machine.

### C.7 · Wire Caddy and the LUKS unlock unit to Infisical

On the server:

```bash
sudo nano /etc/environment.d/infisical.conf
```

Add:

```
INFISICAL_TOKEN=<paste the service token from step C.6>
INFISICAL_URL=https://vault.counsel.day
INFISICAL_PROJECT_ID=<from Infisical project settings>
INFISICAL_ENV=production
```

Save, then make the file root-only:

```bash
sudo chmod 600 /etc/environment.d/infisical.conf
```

Restart Caddy with the new token resolved from Infisical via the CLI (install `infisical` CLI first):

```bash
curl -1sLf 'https://artifacts-cli.infisical.com/setup.deb.sh' | sudo -E bash
sudo apt-get install -y infisical
```

Then update the Caddy compose file to inject `CLOUDFLARE_DNS_API_TOKEN` from Infisical at start time, restart Caddy, and confirm it still serves `vault.counsel.day` correctly.

### C.8 · Install the LUKS unlock systemd unit

Copy the `systemd/luks-unlock.service` and `systemd/luks-unlock.sh` files into place:

```bash
sudo cp ~/counsel-day-server/systemd/luks-unlock.sh /usr/local/sbin/luks-unlock.sh
sudo chmod 700 /usr/local/sbin/luks-unlock.sh
sudo cp ~/counsel-day-server/systemd/luks-unlock.service /etc/systemd/system/luks-unlock.service
sudo systemctl daemon-reload
sudo systemctl enable luks-unlock.service
```

The unit runs **before** Docker and Postgres start. It uses the Infisical CLI with the machine-identity token (from `/etc/environment.d/infisical.conf`) to fetch `LUKS_PASSPHRASE`, runs `cryptsetup luksOpen` against the data volume, and mounts it at `/var/lib/postgres-data`. The Postgres container in the main `docker-compose.yml` (coming in the next phase) has `Requires=luks-unlock.service` so it cannot start if the volume is not mounted.

**Test the unit before destroying the bootstrap passphrase:**

```bash
sudo cryptsetup luksClose pg-data-decrypted
sudo umount /var/lib/postgres-data 2>/dev/null || true
sudo systemctl start luks-unlock.service
sudo systemctl status luks-unlock.service
ls /var/lib/postgres-data/
```

You should see the `.luks-active` sentinel from step B.4. If yes, the unit successfully fetched the passphrase from Infisical and re-mounted the volume.

**Now destroy the bootstrap passphrase file:**

```bash
sudo shred -u /root/.luks-pass
```

The only place the LUKS passphrase exists is now Infisical. Losing both the passphrase and Infisical means the volume is unrecoverable; **export an Infisical backup of the project** to your password manager as a one-time recovery copy.

### C.9 · Confirm a reboot

```bash
sudo reboot
```

Wait 60 seconds. SSH back in:

```powershell
ssh counsel@<HETZNER_IP>
```

Check the volume is mounted:

```bash
ls /var/lib/postgres-data/
systemctl status luks-unlock.service
systemctl status docker
docker compose -f counsel-day-server/docker-compose.infisical.yml ps
curl -I https://vault.counsel.day
```

All should be green. **At this point Phases A, B, and C are complete.**

---

## What you have now

- Domain `counsel.day` registered at Cloudflare with DNSSEC, CAA-restricted to Let's Encrypt.
- Marketing site live at `https://counsel.day` via Cloudflare Pages.
- Hetzner CPX31 server in EU (Falkenstein or Helsinki) with:
  - SSH key-only auth, non-root `counsel` user, no password auth
  - UFW allowing only 22/80/443
  - fail2ban watching sshd
  - Unattended security upgrades
  - Docker + compose installed
  - LUKS2/AES-256-XTS encrypted data volume at `/var/lib/postgres-data`, unlocked at boot via Infisical
- Self-hosted Infisical at `https://vault.counsel.day` (TLS via Let's Encrypt DNS-01) holding:
  - The LUKS passphrase (now the only copy)
  - Cloudflare DNS API token (scoped to counsel.day only)
  - Placeholder slots for Postgres, Redis, Anthropic, Brevo, Auth0, Stripe, and backup keys
- Caddy reverse proxy serving Infisical with auto-renewed TLS via Cloudflare DNS-01 challenge
- Hetzner weekly backups enabled as defence in depth

## What you do NOT yet have

These are the next steps in the roadmap, in order. Each will be its own phase document:

- **Phase D · the application stack**: Postgres 16 with row-level security and pgcrypto, Redis 7 with auth, the FastAPI app container, the Python analysis service
- **Phase E · synthesiser provider abstraction**: `ClaudeSynthesiser` for paid tiers and `PythonSummariser` for free Solo
- **Phase F · backups + monitoring**: nightly `pg_dump → age → R2`, Sentry, BetterStack, status feed
- **Phase G · third-party accounts**: Stripe + Stripe Tax, Auth0 tenant, Brevo, Zoho Workspace
- **Phase H · live data wiring**: connect the seven app-surface HTML pages to real FastAPI endpoints
- **Phase I · end-to-end paid dry run**: real Couple decision running 30 days under live infrastructure

When you are ready to proceed, drop into a new conversation and start at Phase D.

---

## Operational reminders

- **Rotation cadence** (set calendar reminders in Zoho):
  - Anthropic API key: every 60 days
  - Stripe / Auth0 / Brevo / Zoho API keys: every 90 days
  - LUKS passphrase: annually, at the same time as the host re-image
- **Backup verification**: monthly, restore the latest R2 backup into a local docker Postgres and confirm the row count matches. **A backup you have never restored is not a backup.**
- **Security incidents**: if any operator credential is suspected leaked, rotate immediately in Infisical · the systemd unit picks up the new value on the next service restart. Document the incident on `/security` per the responsible-disclosure policy.

---

## If something goes wrong

- **SSH locked out**: the Hetzner web console (under Servers → your server → "Console") gives you a recovery shell that bypasses SSH entirely. Use it to fix `/etc/ssh/sshd_config` or re-add your key.
- **LUKS unlock fails on boot**: the Hetzner rescue system (Servers → your server → Rescue) boots a live Linux that can mount the LUKS volume manually with the passphrase. Recover the data, fix the systemd unit, reboot.
- **Infisical unreachable**: the Caddy logs (`docker compose logs caddy`) show the ACME state. The most common cause is the Cloudflare API token has rotated and not been refreshed in `/etc/environment.d/infisical.conf`.
- **Caddy can't get a cert**: usually means the DNS record for the subdomain has not propagated. Wait, then `dig <subdomain>.counsel.day @1.1.1.1` to verify the record is live globally.
