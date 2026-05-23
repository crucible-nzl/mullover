# Counsel.day · End-to-end journey test

> The cold-walk-through. Open an incognito window, follow these steps with no shortcuts, write down what feels broken. Run this before every public launch and after every major release.
>
> Sister to `counsel-day-app/scripts/smoke-test.mjs` (automated API checks). The smoke test catches dumb-broken; this test catches what-feels-wrong.

Last walked: _____ by _____ · result: _____ · notes: _____

---

## Setup

- New incognito / private browsing window so no cookies leak in
- Throwaway email you control: `+test-YYYY-MM-DD@yourdomain` or a Plus-aliased gmail
- Phone with SMS for MFA enrolment (if testing MFA path)
- Stripe test card: `4242 4242 4242 4242` exp any-future CVC any-three
- Stopwatch (optional but useful · note any step that feels slow)

---

## Phase 1 · First impression (3 minutes)

| # | Step | Pass = | Notes |
|---|------|--------|-------|
| 1.1 | Visit `https://counsel.day` | Above-the-fold renders in < 2s on cable; wordmark + tagline + single CTA visible | |
| 1.2 | Scroll the homepage to the bottom | No layout shift, no broken image, no console errors (F12) | |
| 1.3 | Tab through with keyboard from the URL bar | Every focusable element has a visible focus ring against white | |
| 1.4 | Open `/pricing.html` | All prices show `$X USD` (never bare `$X`); per-decision and annual both shown | |
| 1.5 | Open `/method.html` | Sections divided by hairline rules; § kickers in mono; italic wine accent on the loaded word | |
| 1.6 | Open `/faq.html` and click the helper-bot link in the lede | Chatbot opens, accepts a question, returns an answer | |
| 1.7 | Open `/contact.html` | Real email addresses (`hello@`, `security@`, `press@`, etc.), not just a form | |

## Phase 2 · Cold sign-up (5 minutes)

| # | Step | Pass = | Notes |
|---|------|--------|-------|
| 2.1 | Click `Start a decision` from homepage | Lands on `/signup.html` (or compose flow that surfaces signup) | |
| 2.2 | Enter throwaway email + first name + decision_kind = couple | Submit returns success message about checking email | |
| 2.3 | Open inbox · find magic-link email | Email arrives within 30s, From: `Counsel.day <hello@counsel.day>`, branded HTML | |
| 2.4 | Check email source · verify SPF, DKIM, DMARC all `pass` | Headers `Authentication-Results:` show three `pass` | |
| 2.5 | Click verify link | Lands signed-in on `/account.html` (or `/decisions.html` if compose was started) | |
| 2.6 | Open `/account.html` → Security panel | MFA setup option present; sessions list shows this device | |

## Phase 3 · File a decision (10 minutes)

| # | Step | Pass = | Notes |
|---|------|--------|-------|
| 3.1 | Click `Start a decision` from `/decisions.html` | Lands on `/compose.html` | |
| 3.2 | Fill in question, duration = 7 days (shortest for testing), invite partner via email | Submit succeeds; lands on decision detail | |
| 3.3 | Stripe checkout opens for $25 USD couple decision | Stripe form pre-fills name/email; can pay with test card `4242 4242 4242 4242` | |
| 3.4 | After payment success | Redirects back to decision page; receipt email arrives within 60s | |
| 3.5 | Decision detail page | Shows "Day 1 of 7", "Awaiting partner acceptance", question echoed | |
| 3.6 | Partner invite email arrives at the other address | Magic-link accept; partner lands on accept page; can pair to the decision without paying | |

## Phase 4 · Vote daily (3 days minimum)

Set a calendar reminder so you actually do this and don't fake-test by just refreshing the page.

| # | Step | Pass = | Notes |
|---|------|--------|-------|
| 4.1 | Evening of day 1 · evening-prompt email arrives | Subject reads `Tonight's vote · [question]`; one click to `/vote-today.html` | |
| 4.2 | Cast a Yes vote, write one line | Submit immediately seals; `THIS VOTE WILL REMAIN SEALED UNTIL [date]` shown | |
| 4.3 | Refresh `/vote-today.html` | Cannot vote again that day; states `Voted` with seal date | |
| 4.4 | Day 2-3 · vote again from partner account too | Both accounts log votes independently; daily strip shows count, never content | |
| 4.5 | Try to re-read any sealed vote | Blocked with friendly message and unseal date | |

## Phase 5 · Verdict reveal (after duration ends)

| # | Step | Pass = | Notes |
|---|------|--------|-------|
| 5.1 | Day of unseal · verdict-ready email arrives | Subject `Your decision is ready`; link to verdict-reveal | |
| 5.2 | Open `/verdict-reveal.html` for the decision | Shows the sealed-end-state envelope with single OPEN button | |
| 5.3 | Click OPEN | Reveal animation runs; respects `prefers-reduced-motion` (test with OS setting) | |
| 5.4 | Verdict content | AI synthesis paragraph reads in the Counsel.day voice (observational, not advisory); theme frequencies shown; trajectory line shown | |
| 5.5 | Try to share | Copy-link works; opened in new incognito, share token loads the verdict without auth | |
| 5.6 | Export PDF | Downloads a clean PDF, A4, single conversation prompt at end | |

## Phase 6 · Operational paths

| # | Step | Pass = | Notes |
|---|------|--------|-------|
| 6.1 | `/account.html` → Notifications → Enable web push | Browser permission prompt; subscribes; test push arrives within 30s | |
| 6.2 | `/account.html` → Billing → Manage in Stripe | Stripe Customer Portal opens with the test customer | |
| 6.3 | `/account.html` → Privacy → Export my data | Email arrives within 5 min with JSON of all user data | |
| 6.4 | `/account.html` → Privacy → Delete my account | Soft-delete confirmed; 30-day grace stated; can log back in to restore within grace | |
| 6.5 | Restart from clean incognito, try magic-link to deleted-then-restored account | Sign-in succeeds | |

## Phase 7 · Negative paths

| # | Step | Pass = | Notes |
|---|------|--------|-------|
| 7.1 | Try to sign in 11 times in a row with wrong password | Rate-limit kicks in by attempt 11 with generic message (no enumeration) | |
| 7.2 | Try to file a decision without paying (paid kind) | Blocked at checkout; cannot bypass to vote screen | |
| 7.3 | Visit `/admin.html` while signed in as a non-admin user | Redirects or shows `Not authorised`, never the admin shell | |
| 7.4 | POST `/api/admin/users` from browser console as a non-admin | Returns 401 or 403, never 500 or 200 | |
| 7.5 | Submit `/api/contact` with `<script>alert(1)</script>` in the message | Saved as escaped text; admin dashboard renders it as text, not script | |

## Phase 8 · Mobile (use a real phone, not DevTools)

| # | Step | Pass = | Notes |
|---|------|--------|-------|
| 8.1 | Open `/index.html` on iPhone Safari | Above-the-fold legible, CTA reachable with thumb | |
| 8.2 | Open `/index.html` on Android Chrome | PWA install banner appears after second visit OR after `markEngaged()` | |
| 8.3 | Add to home screen on Android | Installs as standalone app, opens to `/index.html` with no chrome | |
| 8.4 | Open `/offer-e-facebook.html` after clicking through from a Meta ad preview link | Renders single-screen above fold, no horizontal scroll on iPhone SE width (375px) | |

---

## When something fails

1. Screenshot the failing step.
2. Note exact URL, browser+version, time.
3. File in `docs/incidents/YYYY-MM-DD-journey-test-failures.md`.
4. Open a `[journey]` commit fixing it; re-run from the failing step.
5. Update this checklist if the failure exposed a missing assertion.

## Frequency

- Before every public launch.
- After every major release (a release that adds a user-facing surface).
- Monthly during steady-state operation.
- Whenever a user reports something weird that you cannot reproduce.
