# Counsel.day Android App · Scope (Expo + React Native)

> Authored 2026-05-25 · pre-build planning document. Architecture, screens, dependencies, billing strategy, phased timeline, and open decisions for James to call before code starts.

---

## Approach in one sentence

A single Expo (managed workflow) React Native app that ships to both Google Play (now) and Apple App Store (later), shares one codebase, talks to the existing `counsel-day-app` Next.js backend over HTTPS, and routes paid checkout out to the web Stripe page (avoids the 15-30% Google Play Billing tax).

## Why Expo (not bare RN)

- Managed workflow handles native build + signing + over-the-air updates with no Android Studio / Xcode setup until production
- Single command builds Android + iOS binaries via EAS Build (cloud, free tier handles small projects)
- Push notifications via Expo Push are simpler than Firebase Cloud Messaging direct
- All the libraries we need (audio, secure storage, deep links, in-app browser, web view) are first-party Expo SDK modules with one API across platforms

## Architecture diagram

```
┌────────────────────────────┐
│  Expo / React Native app   │
│  (iOS + Android shared)    │
└──────────────┬─────────────┘
               │ HTTPS · bearer-token auth
               ▼
┌────────────────────────────┐
│  Next.js backend           │
│  counsel.day/api/*         │  (no changes for most routes;
│  Caddy + Hetzner           │   one new /api/auth/mobile)
└──────────────┬─────────────┘
               │
               ▼
┌────────────────────────────┐
│  Postgres + Stripe + ...   │
└────────────────────────────┘

Stripe Checkout opens in an in-app Chrome Custom Tab
(Expo WebBrowser.openAuthSessionAsync) · returns via
deep link counselday://checkout-callback when complete.

Push: Expo Push Service · single token per device,
stored alongside existing web push subscriptions in
push_subscriptions table.
```

---

## Critical design decision · authentication

The web app uses **cookie-based sessions** (`session-cookie` in `lib/sessions.ts`). React Native's `fetch` does not handle cookies cleanly across cold starts and does not work for any same-site cookie that requires a real browser context.

**Solution: bearer tokens for mobile.**

Add one new endpoint `/api/auth/mobile/session` that:
- POST body: existing session cookie OR magic-link token consumed
- Returns: `{ token: <opaque-uuid>, user: {...}, expires_at }`
- Token stored in a new `mobile_sessions` table (or extension of existing `sessions` table with a `kind` discriminator: 'web' | 'mobile')
- Mobile app sends `Authorization: Bearer <token>` on every request
- Backend middleware (`readSession`) updated to accept either cookie OR bearer

This is a small backend change (~2 hours) but unlocks the entire mobile auth story cleanly.

Three auth entry points the app supports:

1. **Password sign-in** · email + password + (optional MFA code) → /api/auth/mobile/session → store token in `expo-secure-store` (Android Keystore / iOS Keychain)
2. **Magic link** · user requests via app → email arrives → tap opens `counselday://magic?token=...` → app POSTs to /api/verify → gets bearer token
3. **Existing web session** · if user already signed in on web, opening the app the first time can prompt "Sign in with the email you already use" and reuse the magic-link flow

**Sign out** clears the secure-store token and POSTs `/api/signout` so the bearer is invalidated server-side.

## Critical design decision · billing

Google Play policy says digital goods MUST use Play Billing (15-30% fee). BUT there is an exception under the "Service" or "Reader-app-like" category that allows external billing for **services accessed across web and mobile**. Counsel.day fits this · the same decision can be filed via web or app, the verdict is delivered to both surfaces.

**Strategy: don't implement Play Billing in v1. Route all paid actions to web Stripe Checkout in an in-app browser.**

How it works:
1. User taps "Compose Couple decision" in app
2. App calls `/api/compose` as today → gets `pending_payment` decision id + `checkout_required: true`
3. App opens `https://counsel.day/api/checkout/create` URL in `WebBrowser.openAuthSessionAsync` (Chrome Custom Tab on Android, SFSafariViewController on iOS)
4. User completes Stripe Checkout
5. Stripe redirects to `counselday://checkout-callback?session=...&decision=...` (Universal Link / App Link)
6. App parses deep link, refreshes the decision, sees it's now `pending_invites` or `active`

If Google rejects (we'll find out at first review), fallback is to implement Play Billing for couple/family decisions. That's a known second-phase risk.

## Critical design decision · push notifications

We already have web push via VAPID stored in `push_subscriptions` table. Add mobile push:
- Extend the table with `provider TEXT` column ('web' | 'expo')
- For Expo, store the Expo push token (not VAPID keys)
- Update `lib/push.ts`'s `sendPushToUser` to fan out to BOTH web (web-push library) and Expo (POST to `https://exp.host/--/api/v2/push/send`)

One change, both surfaces get notified.

---

## Screens (minimum viable set for v1)

| # | Screen | API endpoints used | Notes |
|---|---|---|---|
| 1 | Welcome / sign-in | /api/signin, /api/signup, /api/verify | Tabs: sign in / sign up. Magic-link by default. |
| 2 | MFA step-up | /api/signin/mfa-verify | Only shown for accounts with MFA enrolled. |
| 3 | Decisions list | /api/me + /api/me/decision-insights | Same data as /decisions.html. Pull-to-refresh. |
| 4 | Decision detail | /api/decision?id= | Status, day counter, vote status, partner status. |
| 5 | Compose new decision | /api/compose, then /api/checkout/create | Multi-step form (question, format, duration, partners, tier). Opens Stripe in WebBrowser for paid tiers. |
| 6 | Vote tonight | /api/vote-today (GET + POST) | The daily ritual. Mic button for voice note (uses Expo AV + /api/transcribe). |
| 7 | Verdict reveal | /api/verdict-reveal | Sealed envelope → tap → animation → analysis. Includes the TTS audio player. |
| 8 | Account / settings | /api/me, /api/me/sessions | Edit profile, MFA setup, push toggle, sign out. |
| 9 | Help / contact | /api/contact | Static help + a contact form. |

Out of v1: admin pages, billing/Stripe Customer Portal (link out to web), pricing page (web only), all marketing.

## App navigation

Bottom-tab nav (Android Material 3 / iOS native equivalents):
- **Tonight** (vote-today) — the daily action, primary tab
- **Decisions** (list + detail)
- **Account** (profile + settings)

A modal stack handles compose, verdict reveal, MFA prompts.

---

## Dependencies (Expo SDK 53+ for RN 0.78+)

| Package | Why |
|---|---|
| `expo-router` | File-based routing, deep-link support out of the box |
| `expo-secure-store` | Store bearer token in Keystore / Keychain |
| `expo-web-browser` | Open Stripe Checkout in Chrome Custom Tab |
| `expo-linking` | Deep-link handling (magic-link, checkout-return) |
| `expo-notifications` | Push notifications |
| `expo-av` | Voice recording for `/api/transcribe` |
| `expo-audio` (or `expo-av`) | TTS playback of verdict |
| `expo-application` | Get app version for diagnostics |
| `expo-haptics` | Tap feedback on vote |
| `@react-navigation/native` + `@react-navigation/bottom-tabs` | Nav (Expo Router uses this underneath) |
| `@tanstack/react-query` | Server state caching + retries |
| `zod` | Same validation library as backend; share schemas |
| `react-native-mmkv` | Fast key-value store for non-secret cache |

Skip: Redux (overkill), styled-components (Expo's built-in is enough), any UI kit beyond what comes with Expo.

## Theming

The web app's i8 brand (white + wine #722F37, Newsreader + Source Serif 4 + Geist + Geist Mono) ports to mobile via:
- Bundle the four Google Fonts as Expo asset files (so first paint shows correct typography offline)
- Use a single `theme.ts` with the same colour tokens as `styles-i8.css`
- All components reference theme tokens, not hardcoded values

Brand-verify gate equivalent for mobile: an `eslint` rule that bans literal colour codes outside `theme.ts`.

---

## Backend changes required

| Change | Effort | File |
|---|---|---|
| Bearer-token middleware | 2 hr | `src/lib/sessions.ts` accepts `Authorization: Bearer` OR cookie |
| `/api/auth/mobile/session` endpoint | 1 hr | New route that mints a bearer from an existing session or magic-link consume |
| Expo push fan-out in `sendPushToUser` | 1 hr | `src/lib/push.ts` adds Expo HTTP push alongside VAPID |
| `push_subscriptions.provider` column | 30 min | Migration 0023 |
| Deep-link redirect for Stripe success | 30 min | `/api/checkout/create` checkout session takes optional `?return=mobile`; redirects to `counselday://...` instead of /billing |
| App-link verification file | 10 min | `/.well-known/assetlinks.json` for Android Universal Links |
| CSP `connect-src` whitelist for app | 5 min | Allow direct app→api calls from the RN runtime |

Total backend prep: **~6 hours**.

## Native app effort (Expo)

| Phase | Scope | Effort |
|---|---|---|
| **Phase 0 · scaffold** | `npx create-expo-app`, install deps, set up theme, install Expo Router, write a placeholder screen that hits /api/health | 4 hr |
| **Phase 1 · auth** | All three auth flows (password, magic-link, MFA), secure-store, sign-out | 8 hr |
| **Phase 2 · core screens** | Decisions list, detail, vote-today, verdict reveal | 16 hr |
| **Phase 3 · compose + Stripe in-app browser** | Multi-step form, WebBrowser flow, deep-link return, refresh decision | 10 hr |
| **Phase 4 · push notifications** | Expo Push token registration, server-side fan-out, in-app notification handling | 6 hr |
| **Phase 5 · voice + TTS** | Mic recording → /api/transcribe; TTS audio player on verdict | 6 hr |
| **Phase 6 · settings + polish** | Account screen, MFA setup, push toggle, app icon, splash, error states | 10 hr |
| **Phase 7 · Play Store release** | Build via EAS, sign, screenshots, store listing, closed testing, production submit | 10 hr |
| **Total** | | **~70 hours** (~9 focused days, or 3 weeks at 25hr/week) |

iOS adds **~15 hours** later (Apple Developer enrolment, App Store screenshots, review iteration). The code is the same.

---

## File structure (proposed)

```
counsel-day-mobile/                         · new repo OR monorepo workspace
├── app/                                    · Expo Router file-based screens
│   ├── _layout.tsx                         · root layout (theme, react-query, auth gate)
│   ├── index.tsx                           · redirects to /signin or /(app)/tonight
│   ├── signin.tsx
│   ├── signup.tsx
│   ├── magic-link/[token].tsx              · deep-link handler
│   ├── mfa.tsx
│   └── (app)/                              · authenticated routes group
│       ├── _layout.tsx                     · bottom-tab nav
│       ├── tonight.tsx                     · /vote-today equivalent
│       ├── decisions/
│       │   ├── index.tsx                   · list
│       │   ├── [id].tsx                    · detail
│       │   └── compose.tsx                 · modal stack
│       ├── verdict/[id].tsx                · reveal flow
│       └── account.tsx
├── components/                             · shared UI primitives
│   ├── Button.tsx
│   ├── Field.tsx
│   ├── VoiceInput.tsx                      · mirrors web /voice-input.js
│   └── ...
├── lib/
│   ├── api.ts                              · fetch wrapper with auth header injection
│   ├── auth.ts                             · token storage + refresh
│   ├── push.ts                             · register / unregister Expo Push token
│   ├── theme.ts                            · i8 design tokens
│   └── deeplink.ts                         · URL parsing for magic-link + checkout-return
├── assets/                                 · fonts, app icon, splash
├── app.config.ts                           · Expo config (deep-link scheme, push entitlements)
├── eas.json                                · build profiles for dev / preview / production
└── package.json
```

---

## Where it lives in git

Two options:

**A · separate repo `counsel-day-mobile`** · cleaner ownership, separate CI, easier to release independently. Cost: shared types (zod schemas) must be duplicated or published as a tiny npm package.

**B · monorepo (`apps/mobile/` in the existing repo)** · share types and validators via TypeScript path aliases or workspace packages. More complex tooling, but the type sharing is genuinely valuable for compose payloads and API responses.

**My pick: B (monorepo)** for type sharing. Use `pnpm` workspaces or `npm` workspaces. The current `counsel-day-app/` and `counsel-day-complete/` already function as a two-app repo; adding `counsel-day-mobile/` follows that pattern.

---

## Billing strategy detail (the highest-risk decision)

### What we do in v1

The compose flow lands the user on Stripe Checkout opened in a Chrome Custom Tab. They complete payment. Stripe redirects back to our backend with `?return=mobile`, which 302s to `counselday://checkout-callback?status=success&decision=<id>`. The app catches the deep link, refreshes the decision detail, shows the new state.

This is functionally equivalent to a web user clicking "Compose" then completing Stripe. **No Play Billing integration.**

### What Google might do

Google has tightened rules. Apps that **purchase digital content consumed within the app** (game items, premium articles) are required to use Play Billing. Apps that sell **services usable across web and other platforms** have more latitude.

Counsel.day is the latter: a decision filed via the app delivers a verdict that is read on the same account from a web browser. Closer to a SaaS like Notion (allowed external billing) than a game (not allowed).

### Risk mitigation

1. **First submission · use external billing, see what happens.** If approved, ship. If rejected, we have two fallbacks.
2. **Fallback 1 · User Choice Billing.** Google's late-2024 policy lets external billing alongside Play Billing with reduced Google fees (11-19% instead of 15-30%). Apply via the Play Console.
3. **Fallback 2 · Play Billing for new purchases.** Implement react-native-iap, add Play Billing SKUs matching our three tiers. Stripe still handles annual Practitioner. The web flow continues to use Stripe so existing users are unaffected. Probably 20 hours of work if we need it.

### What to bake in to v1 even though we're not using Play Billing

- The compose response from `/api/compose` already returns `checkout_required` + `tier`. App reads it.
- The deep-link return contract is documented so we can swap the in-app browser flow for Play Billing later without changing other screens.
- The app stores a `purchase_method: 'stripe-web'` field on the local decision cache so we can audit later if we add Play Billing.

---

## Costs

| Item | Cost |
|---|---|
| Google Play Console developer account (one-off) | $25 USD |
| Apple Developer Program (annual, when iOS comes later) | $99 USD/yr |
| EAS Build · Free tier covers small projects | $0 (paid tier $19/month if we exceed) |
| Expo Push · Free, unlimited | $0 |
| FCM (Firebase, backup option) · Free tier | $0 |
| Stripe · same per-transaction fee as web | unchanged |
| Code-signing certificate (Android) · self-managed | $0 |
| App-store screenshots · I can render mockups, or use real screenshots from dev | $0 if DIY |
| **Total to first Play Store listing** | **$25** |

Ongoing runtime cost: $0 beyond what counsel.day already pays. Push and notifications free.

---

## Open decisions you (James) need to call

1. **Monorepo (`apps/mobile/`) or separate repo?** · my pick: monorepo
2. **App package id?** · proposing `day.counsel.mobile` (matches your domain). Locked at first Play Store submission, painful to change later.
3. **Deep-link URL scheme** · proposing `counselday://` for in-app navigation, plus universal links `https://counsel.day/m/*` for email magic links (universal links open the app directly if installed, fall through to web if not)
4. **Push provider** · Expo Push (proposed) or Firebase Cloud Messaging direct? Expo Push wraps FCM but adds easy server fan-out · I'd pick Expo Push for v1
5. **App store name** · "Counsel.day" (matches brand) or "Counsel · Decide slowly"? The store name has SEO implications · Counsel.day is searchable, Counsel · Decide slowly tells the story
6. **Submit for iOS at the same time?** · adds ~15 hr but the code is identical. Probably do Android first, iOS within a week of Play Store approval
7. **Onboarding tutorial in-app?** · 2-3 screens before sign-in showing how the tool works · adds 4 hr but improves first-week retention measurably
8. **Biometric unlock?** · use Face ID / fingerprint to unlock the app for returning users · adds 2 hr, real UX win for a daily-vote app

---

## Suggested phased rollout

**Phase 1 · Backend prep (1 day · 6 hours)**
Bearer-token middleware, mobile session route, push fan-out, deep-link return on checkout. Ships independently · no app yet. Web is unaffected.

**Phase 2 · Mobile MVP closed beta (1 week · ~30 hours)**
Auth, decisions, vote-today, compose (with Stripe in-app browser), verdict reveal. No push, no voice, no polish. Distribute via EAS Internal Distribution to ~5 testers (you + 4 invitees) for 1-2 weeks of real-world use.

**Phase 3 · Polish + Play Store submission (1 week · ~25 hours)**
Push, voice, TTS, settings, app icon, splash, screenshots, store listing. Submit to Closed Testing → Open Testing → Production.

**Phase 4 · iOS (1 week, when you want it)**
EAS iOS build, App Store Connect listing, review submit.

**Total to live in Play Store: ~3 weeks of focused work** (or 6-8 calendar weeks at 1hr/day evenings + weekends).

---

## What I'd build first if you greenlight today

The cheapest scope-validation move is **Phase 1 (backend prep) + a 4-hour Phase 2 spike**:
- Backend: bearer-token middleware + mobile session route (6 hr)
- Spike: bare Expo project that calls `/api/auth/mobile/session`, signs in with password, shows the user's email on screen (4 hr)

That confirms the auth architecture works end-to-end before committing the other 60 hours. Total ~1 day to that proof.

---

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Google Play rejects external-billing approach | Medium | Have Play Billing fallback ready; or apply for User Choice Billing |
| Magic-link deep links inconsistent across email clients | Medium | Test in Gmail, Outlook, Apple Mail, Proton, FastMail; provide fallback web flow |
| Push notification token churn | Low | Standard Expo Push retry + cleanup on 410 responses |
| Audio recording permission denial → poor UX | Low | Graceful fallback to typed note (mirror web pattern) |
| EAS Build queue times during launch crunch | Low | Free tier is usually fast; upgrade to paid for guaranteed slots if needed |
| Apple TestFlight reviewer requires demo account | Certain | Provide a demo account in app store review notes |

---

## Saved as memory

I'll save a compact memory entry pointing at this doc so future sessions know the Android plan exists.

---

## Action you need to take to greenlight

1. Review the 8 "open decisions" above
2. Tell me which ones to lock in (or any you'd answer differently from my picks)
3. Say "go" and I start with Phase 1 backend prep
