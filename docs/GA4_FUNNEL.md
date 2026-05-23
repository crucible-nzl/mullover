# Counsel.day · GA4 Funnel Configuration

This document records the GA4 funnel and engagement event scheme wired into the public site. It is the source of truth for what is being measured and how the funnel report in the GA4 UI should be assembled.

## Source

All tracking is fired by [/counsel-day-complete/ga4.js](../counsel-day-complete/ga4.js), loaded by every public HTML page via:

```html
<script src="ga4.js" defer></script>
```

(Sub-directory pages use `../ga4.js`.) The script reads its measurement ID from the `GA4_ID` constant at the top of the file. The placeholder `G-XXXXXXXXXX` is in place until the live ID is configured · in placeholder mode, events are echoed to the browser console but not sent to a real GA4 property, so local development does not pollute production data.

## Setting the live ID

When the GA4 property is ready, edit `counsel-day-complete/ga4.js` and replace `G-XXXXXXXXXX` with the live `G-...` measurement ID. No other code changes are required; the snippet auto-detects the placeholder pattern and switches modes.

## Event catalogue

Two layers · the SaaS funnel (commerce-shaped) and the content-engagement layer (readership-shaped). Every event fires `page_view` automatically via `gtag('config', ...)`.

### SaaS funnel events (in order)

| # | Event name              | Fires when                                                                 | Source         | Parameters                                                  |
|---|-------------------------|----------------------------------------------------------------------------|----------------|-------------------------------------------------------------|
| 1 | `page_view`             | Page loads (auto, by gtag)                                                 | All pages      | (gtag default)                                              |
| 2 | `view_pricing`          | `#editions` section enters viewport (40% threshold)                        | Pages with `#editions` (index.html most relevantly) | `surface: 'editions'`                |
| 3 | `click_start_decision`  | User clicks any CTA whose href points to vote.html / compose.html / start.html, OR whose label includes "start a decision", "begin a decision", "start your first decision", or "start free" | All pages | `label`, `surface`, `destination`                            |
| 4 | `view_account_signup`   | start.html or invite.html loads                                            | start, invite  | `surface`                                                   |
| 5 | `begin_compose`         | compose.html loads                                                         | compose        | `surface: 'compose'`                                        |
| 6 | `submit_compose`        | A `<form>` on compose.html is submitted                                    | compose        | `surface: 'compose'`                                        |
| 7 | `complete_signup`       | verify-email.html loads (user has clicked the magic link)                  | verify-email   | `surface: 'verify-email'`                                   |
| 8 | `view_vote`             | vote.html or vote-today.html loads                                         | vote(s)        | `surface`                                                   |
| 9 | `first_vote`            | A `<form>` on vote.html or vote-today.html is submitted                    | vote(s)        | `surface`                                                   |
| 10| `verdict_view`          | verdict-reveal.html loads                                                  | verdict-reveal | `surface: 'verdict-reveal'`                                 |

### Content engagement events

| Event              | Fires when                                                              | Parameters             |
|--------------------|-------------------------------------------------------------------------|------------------------|
| `scroll_75`        | User scrolls past 75% of page height (once per page-view)               | `surface`              |
| `engaged_session`  | 30 seconds elapse with at least one interaction (scroll / click / key / pointermove), and the tab is not hidden | `surface` |
| `outbound_click`   | User clicks an `<a>` whose host is not the current page's host          | `url`, `surface`       |

## Building the funnel report in GA4

In the GA4 UI:

1. **Reports → Configure → Custom events** · register each of the events above so GA4 surfaces them in the explore interface. Names match exactly.
2. **Explore → Funnel exploration** · build a new funnel with the seven funnel steps in this order:
   - Step 1 · `page_view` (page_location matches `^https?://counsel\.day/$`) · the homepage landing
   - Step 2 · `view_pricing`
   - Step 3 · `click_start_decision`
   - Step 4 · `view_account_signup`
   - Step 5 · `complete_signup`
   - Step 6 · `begin_compose`
   - Step 7 · `submit_compose`
   - Step 8 · `view_vote` (optional · the user's first vote-cast step)
   - Step 9 · `first_vote`
   - Step 10 · `verdict_view` (the conversion endpoint when a decision concludes)
3. Set "Open funnel" (users can enter at any step) for the marketing top of funnel; use "Closed funnel" (must enter at step 1) only for a strict conversion-rate view.
4. For attribution, segment by traffic source (referrer, UTM medium) using the standard GA4 source / medium dimensions.

## Privacy posture

- The script sets `anonymize_ip: true`.
- `allow_google_signals` and `allow_ad_personalization_signals` are both set to `false`.
- No personally-identifying information is added to any event. Surfaces are reported as URL paths; emails, names, and votes never enter the event stream.
- The decision flow itself (vote outcomes, note contents, verdict contents) is NOT instrumented. GA4 sees only that a user reached a page and that a form was submitted; it never sees what was submitted.

## What is intentionally NOT measured

- The contents of any compose / vote / note submission.
- Time spent on individual paragraphs or sections (beyond the 75% scroll threshold).
- Anything inside the admin portal (admin.html and admin-app.js are excluded from the GA4 script).
- Pages flagged `noindex, nofollow` (offline.html, maintenance.html, signed-out.html, session-expired.html, verify-email.html, invite.html, og-image-generator.html, components.html) still load the script · because they sit inside the funnel · but they will produce far fewer page-view events than indexed pages.

## Verifying installation

In the browser console on any public page:

```javascript
window.dataLayer
```

Should return an array of arguments arrays. Each event the script fires (manually or otherwise) pushes a row. The placeholder mode also logs `[ga4 placeholder] <event-name> <params>` to the console.

For end-to-end verification once a real measurement ID is set: GA4 → Configure → DebugView, then open the site from a browser tab. Each event listed above should appear in DebugView in the order described.

---

## A/B testing for offer variants

The `/o.html` rotator is the entry point for paid traffic. It picks one of the offer-variant landing pages (`/offer-a.html` through `/offer-g.html`, `/offer-e2.html`) by weighted random, drops a sticky 30-day cookie (`cd_ab_variant`), and 0-ms redirects the visitor to the chosen page.

### URL contract

| URL | Behaviour |
|-----|-----------|
| `https://counsel.day/o` | Rotates by weight defined in `o.html`; sticky on return visits |
| `https://counsel.day/o?v=e2` | Forces variant `e2`; still sets the sticky cookie |
| `https://counsel.day/o?reset=1` | Clears the cookie, then rolls fresh |
| `https://counsel.day/offer-e-facebook.html` | Direct hit · platform-specific page, NOT in the rotator |

UTM and click-id parameters (`utm_*`, `gclid`, `fbclid`, `ttclid`, `msclkid`) are preserved across the redirect so the destination page gets full attribution.

### Events

| Event | Fires when | Parameters |
|-------|------------|------------|
| `ab_assigned` | Rotator picks (or honours) a variant | `ab_variant`, `ab_forced`, `ab_source` |
| `ab_seen` | First page-load after the cookie is in place (any page that loads `ga4.js`) | `ab_variant` |

Every other event in the session ALSO carries `ab_variant` as a default param, because `ga4.js` calls `gtag('set', { ab_variant: ... })` on load.

### One-time GA4 UI setup

1. **Admin → Custom Definitions → Custom Dimensions** · create `ab_variant` scoped to Event, event parameter name `ab_variant`. Save.
2. (Optional) Create a second custom dim `ab_source` for the rotator's UTM-source attribution.
3. **Explore → Free form** · add `ab_variant` as a row, `Conversions` as a column, slice by event-name filter. Compare conversion rates per variant.

### Retiring or weighting variants

Edit the `VARIANTS` array in `counsel-day-complete/o.html`. Set `weight: 0` to retire without removing the page (preserves existing direct links). Weights are integer proportions, not percentages · they don't need to sum to 100.

### Platform-specific variants

The `offer-e-facebook.html`, `-instagram.html`, `-google.html`, `-tiktok.html` pages are NOT in the rotator. They are direct-hit landing pages with platform-specific copy + pixel wiring, served to ads from that platform with a fixed destination URL. Their `ab_variant` will be the cookie value from any prior rotator visit, OR absent if the visitor came in cold.
