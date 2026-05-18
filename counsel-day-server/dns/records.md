# Cloudflare DNS records for counsel.day

Records are added in three waves as services come online. Replace `<HETZNER_IP>` with the Hetzner CPX31 public IPv4 wherever it appears.

## Wave 1 · day-one records (after Phase A)

Add these immediately after the domain is registered.

| Type | Name | Content | Proxy | TTL | Purpose |
|---|---|---|---|---|---|
| A | counsel.day | (auto-set by Cloudflare Pages when you connect the custom domain) | Proxied | Auto | Marketing site |
| CNAME | www | counsel.day | Proxied | Auto | www → apex |
| TXT | counsel.day | `v=spf1 include:spf.brevo.com include:zoho.eu ~all` | n/a | Auto | SPF · authorises Brevo (outbound) and Zoho (inbound + outbound) |
| TXT | _dmarc | `v=DMARC1; p=quarantine; rua=mailto:dpo@counsel.day; ruf=mailto:dpo@counsel.day; fo=1; aspf=s; adkim=s` | n/a | Auto | DMARC · strict alignment, reports to DPO |
| MX | counsel.day | `10 mx.zoho.eu` | n/a | Auto | Zoho Mail EU primary |
| MX | counsel.day | `20 mx2.zoho.eu` | n/a | Auto | Zoho Mail EU secondary |
| MX | counsel.day | `50 mx3.zoho.eu` | n/a | Auto | Zoho Mail EU tertiary |
| CAA | counsel.day | `0 issue "letsencrypt.org"` | n/a | Auto | Only Let's Encrypt may issue certs |
| CAA | counsel.day | `0 issuewild "letsencrypt.org"` | n/a | Auto | Same for wildcards |
| CAA | counsel.day | `0 iodef "mailto:security@counsel.day"` | n/a | Auto | Notify on misissuance |

## Wave 2 · server records (after Phase B + C)

Add when the Hetzner server is provisioned and you are about to start Caddy.

| Type | Name | Content | Proxy | TTL | Purpose |
|---|---|---|---|---|---|
| A | vault | `<HETZNER_IP>` | DNS only | Auto | Infisical (must be DNS-only so Let's Encrypt + the Infisical CLI see the real IP) |
| A | app | `<HETZNER_IP>` | Proxied | Auto | FastAPI app (Phase D) · Cloudflare-proxied for DDoS protection |
| AAAA | app | `<HETZNER_IPV6>` | Proxied | Auto | IPv6 dual-stack for the app |

## Wave 3 · service records (Phase G)

Add as each third-party service is provisioned.

| Type | Name | Content | Proxy | TTL | Purpose |
|---|---|---|---|---|---|
| CNAME | auth | `counsel-day-prod.auth0.com` | DNS only | Auto | Auth0 custom domain (the CNAME-flatten target Auth0 gives you) |
| CNAME | status | `status.betteruptime.com` | DNS only | Auto | Better Stack status page custom domain |
| TXT | brevo._domainkey | (DKIM key from Brevo dashboard) | n/a | Auto | Brevo DKIM signing |
| TXT | zmail._domainkey | (DKIM key from Zoho Mail Admin) | n/a | Auto | Zoho DKIM signing |
| TXT | _acme-challenge | (managed dynamically by Caddy) | n/a | Auto | Auto-created by Caddy DNS-01; do not add manually |

## Wave 4 · only when explicitly needed

Add only when the relevant feature is going live. Do not add early; unused records weaken your security posture by signalling endpoints that may be vulnerable.

| Type | Name | Content | Proxy | TTL | Purpose |
|---|---|---|---|---|---|
| TXT | counsel.day | `google-site-verification=<token>` | n/a | Auto | Search Console verification (Phase I) |
| CNAME | press | `counsel.day` | Proxied | Auto | Vanity URL for /press · only if you want a memorable URL |

## Verification commands

After adding any record, verify it has propagated globally before relying on it:

```powershell
# Authoritative answer from Cloudflare
nslookup -type=TXT counsel.day 1.1.1.1

# Public resolver round-trip
nslookup -type=MX counsel.day 8.8.8.8

# DNSSEC chain
nslookup -type=DS counsel.day 1.1.1.1
```

Or from bash on the server:

```bash
dig +short TXT counsel.day @1.1.1.1
dig +short MX counsel.day @8.8.8.8
dig +short DS counsel.day @1.1.1.1
```

## SPF and DMARC notes

The SPF record uses `~all` (soft-fail) initially. After a month of clean Brevo + Zoho sending with zero DMARC failure reports, move to `-all` (hard-fail). The DMARC policy starts at `p=quarantine`; after the same observation window with zero failures, move to `p=reject` and add an `rf=afrf` reporting line if you want forensic reports.

## What the records intentionally exclude

- **No DKIM TXT for the bare domain**: all DKIM keys are selector-scoped (`brevo._domainkey`, `zmail._domainkey`). Adding a bare-domain DKIM key would create alignment ambiguity.
- **No catch-all MX**: Zoho is the only inbound MX target. If a record disappears or Zoho is unreachable, mail bounces · this is intentional, not a bug.
- **No SRV records**: we use HTTPS for everything; no XMPP, SIP, or custom-protocol discovery is needed.
- **No DKIM for a non-existent secondary**: do not pre-add records for services you have not yet signed up to. Each one is a TLS or signature-chain attack surface.
