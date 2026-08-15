# Google Ads · working folder

`personas.md` is the core asset: 20 personas, each one an ad group, with the
queries people actually type. This file is how they assemble into a campaign
and what must be true before the first dollar is spent.

## Before spending anything · prerequisites

1. **Conversion tracking** · code half DONE, dashboard half TODO.
   The GA4 `purchase` event ships as of PR #43 (fires on the Stripe success
   return, transaction_id = session id, double-fire guarded · funnel event
   6c). **Remaining · blocked on James creating the Google Ads account**
   (not signed up as of 2026-08-16):
   - [ ] Sign up for Google Ads
   - [ ] GA4 Admin → Product links → Google Ads → link the account
   - [ ] Ads → Tools → Conversions → Import from GA4: `purchase`
         (Primary, 30-day click window) + `complete_signup` (Primary on
         the Solo-KPI campaigns)
   - [ ] One real test checkout · confirm `purchase` lands in GA4 Realtime
   Until all four boxes tick, no campaign spends a cent · it would be
   spend with no steering.
2. **Consent Mode v2** · already implemented sitewide (denied-by-default in
   the EU/UK, notice elsewhere) · this is the thing Google requires for EEA
   ads measurement, and we have it. No work needed; noted so nobody
   re-litigates it.
3. **Landing pages** · ads deep-link to the five `/deciding-*` pages,
   `/family`, and `/verdict` per persona. `/o.html` (the rotator) and
   `offer-e-google.html` exist for offer-style tests later; start with the
   content pages, they match query intent better than a hard-sell lander.
4. **First-party check** · page_hits records `google.com` referrers, so
   paid-vs-organic Google arrivals need GA4's gclid auto-tagging (on by
   default once accounts are linked) to separate. Keep UTMs off organic
   surfaces; ads may use them freely.

## Campaign skeleton

| Campaign | What | Notes |
|---|---|---|
| 1 · Brand | "counsel.day", "counsel day app", misspellings | Pennies. Exists to own our own name while the In-house-Counsel-Day noise dominates organic. Always-on. |
| 2 · Tool-seekers | "decision app", "decision journal app", "app for making hard decisions", "pros and cons app", every persona's [tool] queries ("should i quit my job quiz", "do i want kids quiz") | Highest intent on the account: these people asked for a product. Exact + phrase match only. |
| 3 · Life decisions | One ad group per persona from personas.md, [deliberate] queries, each to its matched landing page | The volume. Phrase match, tight per-group negatives. |
| 4 · Feelings (test) | The [feeling] queries, tiny budget | Cheap clicks, weak close · run only after 2 and 3 have data. |

Start geo: NZ + AU + UK + US + CA, English. Prices are USD everywhere by
design, so no per-market price surgery needed.

## Account-wide negative keywords · starter list

Wrong-intent traffic that will otherwise eat the budget:

```
wheel            spinner          random           generator
magic 8 ball     tarot            astrology        horoscope
template         printable        pdf              excel
worksheet        free download    meaning          definition
lyrics           movie            game             lawyer
attorney         custody          court            visa
salary calculator                 mortgage rates   interest rates
```

Plus, non-negotiable: a **crisis negative set** on every relationship and
family campaign · abuse, violence, self-harm and crisis-hotline terms.
People in crisis get helplines, never ads. (The site's own boundary pages
say the same; the ad account must match the product's ethics.)

- "quiz" and "test" are NOT negatives · they are our best buyers.
- "calculator" is borderline: kill it on house/finance groups, test it on
  decision groups ("decision calculator" intent is a tool-seeker).

## Landing-page gaps the personas exposed

1. **Pets / get-a-dog** (persona 20) · highest volume, lightest weight, no
   page. A `/deciding-on-a-dog` page in the established template would take
   an afternoon and give the cheapest test cell on the account.
2. **Breakup-specific** (persona 5) · `/deciding-about-the-relationship`
   covers it but speaks married-couple; a younger unmarried framing would
   match "should i break up with my boyfriend" far better.
3. **Back-to-study** (persona 13) · currently lands on career-change; fine
   at first, worth its own page if the group earns spend.

## Honesty constraints on ad copy (same rules as everywhere)

- No invented social proof, no "join thousands" · pre-launch is pre-launch.
- Every price as $X.XX USD. First Solo decision free, no card · that IS the
  strongest headline we own.
- No clinical, therapeutic, or outcome promises ("save your marriage" is
  banned forever). We sell a clearer view of your own thinking, and that
  claim has the advantage of being true.
- No em-dashes, including in ads. RSA headlines are 30 characters; the
  house style's short declaratives fit them naturally.
