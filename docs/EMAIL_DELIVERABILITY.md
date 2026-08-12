# Email deliverability · SPF, DKIM, DMARC for counsel.day

**Why this matters (launch blocker):** sign-in is magic-link only. If the
verification email lands in spam or is rejected, the signup silently 100%
fails and the user never knows. Before driving any traffic (the Facebook
test), the domain must authenticate every sender.

## The two senders
- **Brevo** · all transactional mail (magic links, verdict-ready, invites,
  receipts). Sends from `hello@counsel.day` via `api.brevo.com`.
- **Zoho (EU DC)** · the human mailboxes (`*@counsel.day`). Zoho also sends
  outbound when you reply from an inbox.

Both must be authorized in SPF, both need DKIM, and one DMARC policy covers
the domain. DNS is managed at your registrar / Cloudflare DNS.

---

## 1 · SPF (one TXT record · merge, do NOT create two)

Only one SPF record is allowed per domain. Merge both senders:

```
Type: TXT
Host: @            (counsel.day)
Value: v=spf1 include:spf.brevo.com include:zohomail.eu ~all
```

Notes:
- `~all` (softfail) while you validate; you can tighten to `-all` later.
- If an SPF TXT already exists, edit it · do not add a second one.
- Confirm the exact Zoho include for the EU DC in Zoho Admin (it is
  `zohomail.eu`; the .com DC uses `zoho.com`).

## 2 · DKIM (copy the exact tokens from each dashboard)

DKIM keys are account-specific · copy them, do not guess.

**Brevo** · Brevo Dashboard > Senders, Domains & Dedicated IPs > Domains >
`counsel.day` > Authenticate. Brevo gives you:
- a domain-verification TXT (`brevo-code:...`)
- two DKIM CNAMEs: `brevo1._domainkey.counsel.day` and
  `brevo2._domainkey.counsel.day` (each points to a `...brevosend.com` host)
Add all three exactly as shown, then click "Verify" in Brevo.

**Zoho** · Zoho Mail Admin > Domains > `counsel.day` > Email Configuration >
DKIM. Zoho gives a selector (commonly `zmail` or `zoho`) and a public key:
```
Type: TXT
Host: <selector>._domainkey        (e.g. zmail._domainkey)
Value: v=DKIM1; k=rsa; p=<the long key Zoho shows>
```
Then click "Verify" in Zoho.

## 3 · DMARC (start in monitor mode, then tighten)

```
Type: TXT
Host: _dmarc                       (_dmarc.counsel.day)
Value: v=DMARC1; p=none; rua=mailto:dmarc@counsel.day; ruf=mailto:dmarc@counsel.day; fo=1; adkim=r; aspf=r; pct=100
```

Rollout:
1. **p=none** for ~1-2 weeks · you receive aggregate reports (`rua`) but
   nothing is quarantined. Confirm from the reports that Brevo AND Zoho mail
   passes SPF+DKIM aligned.
2. Then **p=quarantine** (spam-folder failures).
3. Then **p=reject** (bounce failures) once you are confident.

Make sure `dmarc@counsel.day` exists (a Zoho mailbox or alias) or point `rua`
at a real inbox / a DMARC-report service.

---

## 4 · Verify (after the records propagate · minutes to a few hours)

Command-line (any machine with `dig`; on Windows use `nslookup -type=TXT`):

```
dig +short TXT counsel.day                     # SPF · one v=spf1 line, both includes
dig +short TXT _dmarc.counsel.day              # DMARC · v=DMARC1 ...
dig +short CNAME brevo1._domainkey.counsel.day # Brevo DKIM 1
dig +short CNAME brevo2._domainkey.counsel.day # Brevo DKIM 2
dig +short TXT zmail._domainkey.counsel.day    # Zoho DKIM (adjust selector)
```

Dashboards:
- Brevo Domains page shows green ticks for domain + DKIM when correct.
- Zoho DKIM page shows "Verified".

End-to-end (the real test):
1. **mail-tester.com** · send a magic-link email from the app to the address
   it gives you; aim for 10/10 and confirm SPF/DKIM/DMARC all pass.
2. **Live inbox test** · sign up from a fresh Gmail AND a fresh Outlook
   address; confirm the magic link lands in the **inbox**, not spam, within
   a minute. This is the gate for the Facebook test.
3. **Google Postmaster Tools** · add `counsel.day` to watch domain/spam
   reputation once real volume starts.

## 5 · App-side prerequisites (already in code)
- `BREVO_API_KEY`, `BREVO_SENDER_EMAIL` (`hello@counsel.day`), `BREVO_SENDER_NAME`
  must be set in production env (`/etc/counsel-day-app/env.local`); without the
  key, `src/lib/email.ts` no-ops and no mail is sent.
- The sending address (`hello@counsel.day`) must be a **validated sender** in
  Brevo (Senders & IP > Senders).

## Status checklist
- [ ] SPF TXT includes both `spf.brevo.com` and `zohomail.eu`
- [ ] Brevo domain + 2 DKIM records verified (green in Brevo)
- [ ] Zoho DKIM verified
- [ ] DMARC record live (start `p=none`)
- [ ] mail-tester 10/10
- [ ] fresh Gmail + Outlook signup lands in inbox
- [ ] `BREVO_API_KEY` set in production and sender validated
