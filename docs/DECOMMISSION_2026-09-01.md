# Counsel.day · decommission runbook · 2026-09-01

Decision: James, 2026-09-01 · zero users after launch promotion; project ends;
the Hetzner server is reused for jobtracker. Work through the phases IN ORDER ·
Phase 1 exists because closing email/domain before repointing account logins is
the classic way to lock yourself out of the accounts you still need to close.

State verified 2026-09-01: nothing merged since Aug 16 · calculate.co.nz
placements never implemented (checked live, zero mentions) · Google Ads account
never created per docs/adwords/README.md checklist · six user accounts, five of
them James/test, one comped friend · site still serving.

## Phase 0 · Preserve (10 minutes, do first)

- [ ] Hetzner Console (console.hetzner.cloud) > counsel-day-prod-01 >
      Snapshots > Take Snapshot · name `counselday-final-20260901`.
      This is the undo button for the entire teardown (DB, env secrets, site).
      Costs ~EUR 0.01/GB/month of used disk · pennies. Calendar note: delete
      it in 3-6 months, which also COMPLETES the GDPR erasure below.
- [ ] Stripe dashboard > check for any real transactions; export invoices if
      any exist (expected: zero).
- [ ] Merge (or close) PR #45 · it holds the final post log + persona rules;
      merging preserves the record before the repo is archived.

## Phase 1 · Guard the logins (BEFORE touching Zoho or the domain)

Repoint every account whose login or recovery address is *@counsel.day to
admin@realtor.co.nz (or another address you keep). Check each of:

- [ ] Hetzner account email
- [ ] Cloudflare account email
- [ ] Stripe account + notification emails
- [ ] Brevo login
- [ ] Zoho org recovery email (so you can still cancel it after mail stops)
- [ ] The Google account that owns GA4 + GTM · if its identity IS
      admin@counsel.day, add a personal recovery email AND phone now, or add
      your personal Google account as property admin and use that
- [ ] Registrar contacts for counsel.day and mullover.ai
- [ ] Reddit u/ill_help_you recovery email, if set to @counsel.day
- [ ] Anything else that emails *@counsel.day (search the Zoho inboxes for
      "verify" / "receipt" senders as a sweep)

Only when nothing external depends on @counsel.day mail is it safe to kill
Zoho and let the domain lapse.

## Phase 2 · Stop the money

- [ ] **Hetzner server** · KEPT for jobtracker; cost continues by design.
      Cloud Backups (20% surcharge): keep for jobtracker, or disable at
      Server > Backups. Old backup images cycle out within 7 days of rebuild.
- [ ] **counsel.day domain** · registrar > auto-renew OFF. Do NOT delete
      anything early; the domain must stay live through the teardown for
      password resets. It lapses at expiry on its own.
- [ ] **mullover.ai** · auto-renew OFF.
- [ ] **Zoho Workplace** (admin.zoho.eu) > Subscription > cancel the paid
      plan · AFTER Phase 1. Alternative if jobtracker needs mailboxes: Zoho
      supports swapping the org domain · downgrade instead of delete, then
      repoint to the jobtracker domain later.
- [ ] **Stripe** · recommended: keep the account (painful to recreate, can be
      renamed for jobtracker). Do: Products > archive all counsel-day
      products/prices · delete the first-100 coupon · Developers > Webhooks >
      delete the counsel.day endpoint · Developers > API keys > roll/delete.
      If you prefer full closure: Settings > Account > Close (export first).
- [ ] **Brevo** · Contacts > delete all 6 (this is GDPR erasure, not tidying)
      > Settings > SMTP & API > delete the API key > close or leave on free.
- [ ] **Anthropic console** (console.anthropic.com) · delete the verdict API
      key. Keep the org if used for anything else; otherwise set spend limit
      to $0. Same for the OpenAI key if that account has no other use.
- [ ] **PostHog** (eu.posthog.com) · delete the project/org · free tier, but
      it holds behavioural data, so this is also a privacy item.
- [ ] **Cloudflare R2** · dash.cloudflare.com > R2 · the old Counsel Journal
      bucket has been on the teardown list since 2026-08-09; if it still
      exists, delete it. Likely the only silent recurring charge besides the
      server.
- [ ] **Google Ads** · never created per the checklist. If one exists after
      all: pause all campaigns > Settings > Account status > Cancel (Google
      refunds remaining balance).
- [ ] **Infisical** · delete the workspace / cancel if on a paid tier.

## Phase 3 · Cancel everything else

- [ ] GA4: analytics.google.com > Admin > Property > Move to Trash (30-day
      undo window). GTM: tagmanager.google.com > delete GTM-PFFSDN3M.
- [ ] Search Console + Bing Webmaster: remove the properties if they were
      ever added.
- [ ] reCAPTCHA admin console: delete the counsel.day site keys.
- [ ] Cloudflare: turn off Web Analytics; delete any API tokens; the zone
      itself can simply remain until the domain lapses, then delete it.
- [ ] F5Bot: delete the keyword alerts. Rebrandly: delete the short link.
- [ ] Reddit/Facebook: nothing required. Optional courtesy near domain
      lapse: edit the two Reddit posts with one line ("update: I have closed
      this project") so the name does not point at a parked page.
- [ ] calculate.co.nz: verified NOT live 2026-09-01 · nothing to remove.
      Discard docs/adwords/calculate-handoff-plan.md as unexecuted.
- [ ] Test users: John (jpparker55@) and the comped accounts are erased with
      the DB + Brevo. No obligations; a one-line courtesy note is optional.
- [ ] Zoho org: delete (if not repointing to jobtracker) once mail is no
      longer needed.
- [ ] GitHub: Settings > Secrets and variables > Actions > delete ALL repo
      secrets (deploy SSH key etc.) · then Settings > Archive this
      repository. The deploy workflow is deleted in the same PR as this
      runbook, so nothing can deploy meanwhile. The code stays, read-only ·
      it is a genuine portfolio piece.

## Phase 4 · Format the server for jobtracker

Hetzner "Rebuild" wipes the disk completely, keeps the same IP and price ·
that IS the format step. Only after the Phase 0 snapshot exists:

1. console.hetzner.cloud > counsel-day-prod-01 > **Rebuild** > Ubuntu 24.04
   LTS > confirm (it requires typing the server name · this is the
   irreversible disk wipe).
2. Add your SSH public key during rebuild, or capture the one-time root
   password it displays.
3. Rename the server to `jobtracker-prod-01`.
4. SSH access: the old port-22 problem was Cloudflare proxying the
   counsel.day hostname · SSH to the RAW IP works normally. Give jobtracker
   a DNS-only `ssh.` record from day one.
5. Generate a FRESH deploy keypair for jobtracker CI. The old one lived in
   this repo, in its Actions secrets, and dies with them; never reuse it.
6. Jobtracker DNS gets its own Cloudflare zone when ready · nothing carries
   over.

## Privacy close-out (why this sequence is GDPR-clean)

Server rebuild + Brevo contact deletion + GA4 trash + backup cycling erases
all personal data of the six account holders. The Phase 0 snapshot briefly
retains a copy · deleting it at the 3-6 month mark completes erasure. No
breach occurred, no notification duties apply, and the privacy policy
deletion promises are honoured by the wipe itself.
