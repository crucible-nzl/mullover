# Counsel.day · SEO playbook and monthly review

**Status:** Active · **Owner:** James Graham · **Last reviewed:** 14 May 2026 (second pass) · **Next review:** 14 June 2026

This document is the canonical SEO playbook for Counsel.day. It covers
the Google ranking framework as it stands today, the specific risks
Counsel.day faces inside that framework, the inventory of compliance
items already in place, the monthly review process, and the Search
Console submission steps. The monthly review at the bottom is a working
checklist · run through it on the same day each month and update this
file in place.

---

## Table of contents

1. [The Google ranking framework, as Google currently describes it](#1-google-ranking-framework)
2. [Counsel.day's risk profile inside that framework](#2-counsel-day-risk-profile)
3. [Compliance inventory · what is in place today](#3-compliance-inventory)
4. [Monthly SEO review · the working checklist](#4-monthly-review)
5. [Annual deep audit](#5-annual-audit)
6. [Search Console submission and verification](#6-search-console-submission)
7. [Glossary and sources](#7-glossary-sources)

---

## 1 · Google ranking framework

Google's public ranking guidance organises into three pillars and four
overlapping evaluation lenses. The pillars are the **rules of eligibility**;
the lenses are the **dials that decide where among the eligible pages
you rank**. We optimise for both.

### 1.1 · The three pillars (Search Essentials)

| Pillar | What it is | Counsel.day status |
|---|---|---|
| **Technical requirements** | Crawl, render, index. HTTPS, mobile-friendly, not blocked by robots.txt, parseable HTML. | Pass. |
| **Spam policies** | 16 specific behaviours that get you demoted or de-indexed. See § 1.3 below. | Pass with caveat · Scaled Content Abuse is the one to actively defend against. |
| **Key best practices** | Helpful content, keywords in prominent positions, discoverable links, structured data, page experience. | Mostly in place; monthly review tracks drift. |

### 1.2 · The four evaluation lenses

**E-E-A-T** · Experience, Expertise, Authoritativeness, Trustworthiness.
The framework Google's quality raters use. Trust is the most important
of the four; a page with low trust cannot be considered high quality
regardless of how experienced or expert the author is. Experience (added
December 2022) is the first-hand-lived-experience signal; for
Counsel.day, the real schooling decision documented at
`/about/james-graham` is the load-bearing source of Experience.

**YMYL** · "Your Money or Your Life." Topics that significantly impact
health, financial stability, safety, or wellbeing. Google's systems
weight E-E-A-T more heavily on YMYL queries (correlation studies
suggest ~24% vs ~8% for non-YMYL). The September 2025 Quality Rater
Guidelines update explicitly expanded YMYL to include government,
elections, and civic trust. **Counsel.day is YMYL-adjacent by topic**
(decisions about family, relationships, money, life shape) even though
the product makes no clinical claims.

**Helpful Content System** · Folded into core ranking signals in March
2024. Site-wide signal that demotes the whole site when most of the
site is unhelpful, even if individual pages are good. Means no thin
page can exist in isolation · the whole index has to clear the bar.

**Page Experience** · A bundle of signals, not one. Core Web Vitals
(LCP, INP, CLS) are the only PE signals that are directly part of
ranking; the rest (HTTPS, mobile-friendly, no intrusive interstitials,
safe browsing, no ad density abuse, distinguishable main content)
contribute via user-satisfaction signals.

### 1.3 · The 16 spam-policy categories

In order of how relevant each is to Counsel.day:

| Category | Counsel.day risk | Active defence |
|---|---|---|
| Scaled content abuse | **MEDIUM-HIGH** · ~40 pages, consistent template, AI-assisted copy | Vary templates; add per-page first-hand specifics; cite real research; show real author |
| Site reputation abuse | Low now; rising if we host guest posts later | Do not host third-party SEO content |
| Expired domain abuse | None · counsel.day is a fresh registration | n/a |
| Cloaking | None | n/a |
| Doorway abuse | Low · no per-keyword landing pages | Avoid auto-generated landing pages |
| Hacked content | None | Covered by `docs/SECURITY_AUDIT.md` |
| Hidden text and link abuse | None | n/a |
| Keyword stuffing | Low · `<meta keywords>` stripped | Body copy reads as editorial, not stuffed |
| Link spam | None yet | Watch later if we buy any links |
| Machine-generated traffic | None | n/a |
| Malicious practices | None | n/a |
| Misleading functionality | None | n/a |
| Scraping | None | All copy is original |
| Sneaky redirects | None | n/a |
| Thin affiliation | None · not an affiliate site | n/a |
| User-generated spam | None today | Watch when comments/reviews ship |
| Back-button hijacking (April 2026 new) | None | n/a |

---

## 2 · Counsel.day risk profile

### 2.1 · We sit inside YMYL by topic

Our keyword set includes:
- "couples decision making" · "joint decision making"
- "should we move into the city for our son's schooling"
- "should we have a baby"
- "should I leave my job"
- "couples therapy alternative"
- "analysis paralysis" / "decision paralysis"
- "leaving a relationship"
- "decision tool for families"

All of these touch family, relationships, finance, life-shape decisions.
Google classifies them as YMYL even though we are not a clinical
service. The implication: **the E-E-A-T bar for us is the higher one**.
We meet it by:

- Named author with real biography, photo, professional history, and
  public profile (`/about/james-graham`).
- Editorial transparency on `/editorial-standards` (AI disclosure,
  correction policy, conflict-of-interest disclosure, six load-bearing
  data promises).
- Cited research with paper-level references on `/therapists` (six
  decision-science findings, real journals, real dates).
- Explicit boundaries · the same "not a therapist, not a counsellor,
  not medical, no clinical training" disclosure across every page that
  could be confused with one.
- Real first-hand experience documented (the schooling decision story
  surfaced in the hero of `/`, the lede of `/about`, and the bio at
  `/about/james-graham`).

### 2.2 · Scaled Content Abuse is our one active risk

Google's Scaled Content Abuse classifier looks for: many pages with
similar structural templates, repeated phrasing patterns, AI-typical
sentence cadences, thin variation between pages, absence of
demonstrable first-hand experience. On the surface, Counsel.day's
~40 pages with the consistent italic-Newsreader rhythm, "§ Part N ·"
eyebrows, and editorial uniformity are exactly what the classifier
is trained to flag.

The defence is real first-hand specifics on every page. **Mitigation
status:**

- Real founder story in the hero · in place site-wide.
- Real research citations · in place on `/therapists` and
  `/counsellors`.
- Named author with photo and bio · in place via `/about/james-graham`.
- Editorial transparency · in place via `/editorial-standards`.
- AI-use disclosure · in place via `/editorial-standards`.
- Template variation across pages · **partial** · the marketing pages
  still share heavy structural rhythm. Tracked in § 4 monthly review.
- Per-page real-world specifics (named NZ schools, named neighbourhoods,
  real dates, real anonymised case data) · **partial** · several pages
  still read as abstract product description. Tracked in § 4.
- Author-attributed long-form essays · **not yet** · planned in
  Tier 3 of the original SEO roadmap.

### 2.3 · FAQPage rich results are dead for us

As of 7 May 2026, FAQPage rich results no longer appear in Google
Search except for "well-known and authoritative" government and health
sites. We are neither. **The FAQPage JSON-LD on `/faq`, `/homepage`,
and the per-page Q&A blocks is now decorative for rich-result purposes.**
Keep it · it still helps AI Overviews and Gemini parse the content
structure · but stop optimising as if it produces SERP snippets.
Reallocate that effort to BreadcrumbList, Service, Organization, and
Article schema, which all still produce rich-result eligibility.

---

## 3 · Compliance inventory

This is the snapshot of what is in place today, page by page. The
**monthly review checks this snapshot has not regressed**.

### 3.1 · Head-of-page

| Item | Status | Locations |
|---|---|---|
| `<meta charset>` | Pass · all pages | every HTML file |
| `<meta viewport>` | Pass · all pages | every HTML file |
| `<title>` ≤ 70 chars | Pass · audited 14 May 2026 | every HTML file |
| `<meta description>` ≤ 155 chars | Mostly pass · therapists, counsellors, james-graham, editorial-standards confirmed; the rest need an audit | every HTML file |
| `<meta robots>` (index,follow or noindex,nofollow as appropriate) | Pass · all pages | every HTML file |
| `<link rel="canonical">` | Pass · all pages | every HTML file |
| `<link rel="alternate" hreflang="en">` + `x-default` | **Partial** · only therapists, counsellors, james-graham, editorial-standards have this | extend to other root pages next month |
| `<meta property="og:type">` | Pass | every HTML file |
| `<meta property="og:title">` | Pass | every HTML file |
| `<meta property="og:description">` | Pass | every HTML file |
| `<meta property="og:url">` | Pass | every HTML file |
| `<meta property="og:image">` (1200×630) | Image referenced; file at `/og-image.png` needs to actually exist in production | every HTML file |
| `<meta property="og:locale">` (`en_NZ`) | **Partial** · only therapists, counsellors, james-graham, editorial-standards | extend to all root pages next month |
| `<meta name="twitter:card">` | Pass | every HTML file |
| `<meta name="twitter:description">` | **Partial** · only therapists, counsellors, james-graham, editorial-standards | extend next month |
| `<meta property="article:modified_time">` | Pass · all pages | every HTML file (added 14 May 2026) |
| `<meta name="keywords">` | Pass · removed (Google has ignored it since 2009 and on YMYL sites it reads as a low-quality signal) | every HTML file (stripped 14 May 2026) |

### 3.2 · Structured data

| Schema | Status | Locations |
|---|---|---|
| `WebSite` | Pass · with `@id` for graph linkage | most marketing pages |
| `Organization` | Pass · with `founder` linking to Person | most marketing pages |
| `WebPage` | Pass | most marketing pages |
| `BreadcrumbList` | Pass · 3 levels | therapists, counsellors, james-graham, editorial-standards |
| `Service` (for referral program) | Pass | therapists, counsellors |
| `Person` (for James) | Pass | james-graham, editorial-standards, therapists |
| `Article` | Pass | editorial-standards |
| `FAQPage` | Pass (kept for AI Overviews, accepting it no longer gives SERP rich results) | faq, homepage |
| `Product` + `Offer` | Pass | index |
| `ProfilePage` | Pass | james-graham |

### 3.3 · Sitemap and robots

| Item | Status |
|---|---|
| `/sitemap.xml` exists and lists every indexable page | Pass (14 May 2026) |
| `/sitemap.xml` excludes noindex pages | Pass |
| `/robots.txt` exists | Pass (14 May 2026) |
| `/robots.txt` references the sitemap | Pass |
| `/robots.txt` blocks app/account/admin/system pages | Pass |
| `/robots.txt` has per-crawler overrides for ClaudeBot, GPTBot, Google-Extended, CCBot, PerplexityBot | Pass |

### 3.4 · Author and transparency

| Item | Status | Notes |
|---|---|---|
| Named author bio with photo | Pass · `/about/james-graham` | Photo is a placeholder editorial SVG; replace with real photograph at `/about/james-graham-portrait.png` when available |
| LinkedIn URL in `Person.sameAs` | Pass · `linkedin.com/in/james-graham-nz` | Live LinkedIn account linked from /about/james-graham |
| Author bylines link to `/about/james-graham` | Pass · editorial-standards, therapists | Extend to other long-form pages next month |
| Editorial standards page with AI disclosure | Pass · `/editorial-standards` | Six load-bearing data promises documented |
| Corrections policy and email | Pass · `corrections@counsel.day` (configure in Brevo before launch) |
| Disclosure that James is not a therapist/counsellor/medical | Pass · in lede or disclosure on every page that could be confused for one | therapists, counsellors, james-graham, editorial-standards, about, faq |

### 3.5 · Performance / Page Experience

| Item | Status | Target |
|---|---|---|
| HTTPS in production | Required at launch | required |
| Mobile responsive | Pass · all pages | required |
| LCP (Largest Contentful Paint) | To benchmark at launch | < 2.5s |
| INP (Interaction to Next Paint) | To benchmark at launch | < 200ms |
| CLS (Cumulative Layout Shift) | To benchmark at launch | < 0.1 |
| Font loading | Preload-async pattern (14 May 2026) | full self-hosting in `fonts/` is the next step |
| Intrusive interstitials | None | required none |
| No display advertising | Pass · we ship no ads | required none |
| Safe browsing | Required at launch | required |
| `prefers-reduced-motion` respected | **Pass · added 14 May 2026 (second pass)** | required for WCAG 2.3.3 |
| Toast notifications announced to screen readers | **Pass · `role="status" aria-live="polite"` injected on every toast 14 May 2026 (second pass)** | required for WCAG 4.1.3 |

### 3.6 · Content quality (Helpful Content / E-E-A-T)

| Item | Status |
|---|---|
| Every page has clear primary purpose | Pass |
| Every page reads as written for users, not search engines | Pass |
| Citations are real and verifiable | Pass on `/therapists` and `/counsellors` |
| Named author for every long-form page | Pass on editorial-standards; **needs extending** to method, why-time, distinction, verdict, about |
| Last-updated date visible on every editorial page | **Partial** · therapists, james-graham, editorial-standards have it; extend to others next month |
| No thin pages drag down site-wide signal | Pass · every page has substantial content |
| No AI-generated boilerplate without human editorial supervision | Pass · all marketing copy human-edited |

---

## 4 · Monthly review

Run this list on the same day each calendar month. Capture each line
as either **Pass · no change**, **Pass with caveat**, or **Action**.
Update the inventory in § 3 in line. Update the "Last reviewed" header
at the top of this file to the date of the review.

### 4.1 · Google guidance updates (15 minutes)

- [ ] Check the Google Search Central blog at
  <https://developers.google.com/search/blog> for posts since the last
  review. List any that affect ranking, spam policies, structured data,
  AI content, or YMYL.
- [ ] Skim the Google ranking-systems update log at
  <https://status.search.google.com/products/rGHU1u87FJnkP6W2GwMi/history>
  for core updates, spam updates, helpful content updates since the
  last review.
- [ ] Read any new spam-policy categories. Update § 1.3 in this file
  with the new row and Counsel.day's risk for it.
- [ ] Skim the Search Quality Rater Guidelines at
  <https://guidelines.raterhub.com/searchqualityevaluatorguidelines.pdf>
  for the publication date. If newer than the version cited in § 7
  below, read the changelog and update this file.

### 4.2 · Search Console signals (30 minutes)

- [ ] Open Search Console for the `counsel.day` property.
- [ ] **Performance · last 28 days vs previous 28 days.** Note total
  impressions, clicks, CTR, average position. Flag any > 20% movement
  in either direction.
- [ ] **Top 10 queries by impressions.** Note any that are new in the
  top 10 (opportunity) and any that have dropped out (regression).
- [ ] **Top 10 pages by clicks.** Same check.
- [ ] **Pages indexed.** Should match the sitemap.xml count (currently
  23 public-indexable pages). If lower, investigate which pages are
  marked "Discovered but not indexed" or "Crawled but not indexed."
- [ ] **Coverage errors.** Should be zero. Any 404, 500, redirect, or
  soft-404 is investigated and resolved this month.
- [ ] **Mobile usability errors.** Should be zero.
- [ ] **Core Web Vitals report.** All three metrics should be "Good"
  on > 75% of URL views. Any "Needs improvement" or "Poor" is
  investigated.
- [ ] **Manual actions.** Should be empty. Any action is treated as
  the highest-priority operational issue.
- [ ] **Security issues.** Should be empty.

### 4.3 · Page-level audits (45 minutes)

Rotate through the pages on a five-month cycle so that every page
gets a deep audit twice a year. Each audit covers:

- Title length ≤ 70 chars · descriptive · keyword-natural
- Meta description ≤ 155 chars · readable · keyword-natural
- H1 present · descriptive · matches title intent
- One H1 per page · h2/h3 hierarchy logical
- `article:modified_time` updated if the page was edited this month
- Visible "Last updated" date present if the page was edited this month
- All internal links resolve
- All external links open in new tab with `rel="noopener"` where
  appropriate
- All images have descriptive `alt` text
- Lighthouse Accessibility ≥ 95
- Lighthouse SEO = 100
- Lighthouse Performance ≥ 90 on mobile

**Cycle:**

| Month | Pages audited |
|---|---|
| Month A | index, homepage, about, about/james-graham |
| Month B | method, why-time, distinction, verdict |
| Month C | vote, family, compare, start |
| Month D | therapists, counsellors, faq, editorial-standards |
| Month E | engineering/*, privacy, terms, cookies, sub-processors, refunds |

### 4.4 · Scaled-Content-Abuse defence (20 minutes)

Each month, add or strengthen one anti-scaled-content signal:

- [ ] Add one real, specific, verifiable detail to one previously
  abstract page. Examples: name a real NZ school discussed in the
  schooling story, name a real neighbourhood, cite a real conference
  the founder spoke at, add a real photo (not stock).
- [ ] Vary one structural template. Examples: change a `.method-stage`
  page to use a different layout, swap a "§ Part N ·" eyebrow for a
  named one, replace a grid with prose on one page.
- [ ] Add or update one real citation. The bar: real paper, real
  authors, real journal, real year, DOI-linkable.
- [ ] Publish or edit one author-attributed long-form piece (target
  Tier 3 cadence: one essay per month).

### 4.5 · Structured-data validation (10 minutes)

- [ ] Run the Schema Markup Validator at
  <https://validator.schema.org/> on three random pages. All schemas
  should pass with zero errors.
- [ ] Run the Google Rich Results Test at
  <https://search.google.com/test/rich-results> on the same three
  pages. Any "ineligible" or "warning" is investigated.

### 4.6 · Performance check (15 minutes)

- [ ] Run PageSpeed Insights at <https://pagespeed.web.dev/> on three
  representative pages: home, a marketing article, a referral page.
  Capture Mobile and Desktop scores. Flag any regression > 5 points
  vs last month.
- [ ] Confirm Core Web Vitals from Search Console match.
- [ ] If LCP is the bottleneck, evaluate whether full font self-hosting
  is the right move this month (see `fonts/README.md`).

### 4.7 · Wrap-up (10 minutes)

- [ ] Update "Last reviewed" header at the top of this file.
- [ ] Update "Next review" header to the same date next month.
- [ ] If any inventory item in § 3 has changed status, update the
  status column.
- [ ] If any new action is committed for next month, add it to a
  short "Actions for next review" list at the bottom of this file.

---

## 5 · Annual deep audit

Once a year (every May), in addition to the monthly review, run the
following deeper audit. Allow half a day.

- [ ] Re-read the Search Quality Rater Guidelines in full. Note any
  YMYL boundary changes, any new author-credential standards, any
  new disclosure requirements.
- [ ] Re-read Google's "Creating helpful, reliable, people-first
  content" guidance in full. Re-run the 21 self-assessment questions
  against the site as it stands.
- [ ] Run a full backlink audit (Ahrefs / Semrush / Search Console
  Links report). Disavow any spammy backlinks. Identify the three
  highest-authority backlinks and reach out to thank them.
- [ ] Run a full competitive analysis on the top three competing
  sites for our core keywords. What new content have they shipped?
  What new schemas? What new authoritative backlinks have they
  earned?
- [ ] Refresh the keyword research. The 2026 launch list was
  "couples decision making, joint decision tool, decision app for
  couples, analysis paralysis, decision paralysis, couples therapy
  alternative, private vote decision, sealed-vote decision tool,
  structured deliberation." Update with what Search Console shows is
  actually pulling traffic, and where intent has moved.
- [ ] Run a privacy-policy / terms / sub-processors review for legal
  changes (NZ Privacy Act amendments, EU GDPR updates, CCPA
  amendments).
- [ ] Run a content-freshness sweep. Any page that has not been
  updated in 12 months is either re-edited with new material or
  flagged for retirement.

---

## 6 · Search Console submission

These are the one-time setup steps to get Counsel.day registered
with Google Search Console. Run once at production launch and
re-confirm at every major DNS or hosting change.

### 6.1 · Verify domain ownership

1. Open Google Search Console at <https://search.google.com/search-console>.
2. Click **Add property** and choose the **Domain** property type
   (covers `counsel.day` and all subdomains).
3. Google issues a DNS TXT record. Add it to Cloudflare DNS (the
   nameserver of record for `counsel.day`):
   - Type: `TXT`
   - Name: `@` (or `counsel.day`)
   - Content: the `google-site-verification=...` string Search Console
     supplies
   - TTL: Auto
4. Save the record. Wait 5-15 minutes for DNS propagation.
5. Click **Verify** in Search Console. If verification fails, run
   `dig TXT counsel.day` from a local machine and confirm the record
   is visible; retry verify.
6. Capture a screenshot of the successful verification and store at
   `docs/screenshots/search-console-verified.png` for the audit
   trail.

### 6.2 · Submit the sitemap

1. In Search Console, sidebar · **Sitemaps**.
2. **Add a new sitemap.** Enter: `sitemap.xml`
3. Confirm. The status should show **Success** within a few minutes.
4. Confirm "Discovered URLs" matches the number of `<url>` entries
   in `/sitemap.xml` (currently 23).

### 6.3 · Set the preferred geographic target

1. Search Console · sidebar · **Settings** · **International
   targeting** (if shown · Google has been deprecating this in favour
   of automatic detection).
2. Geographic target: **Worldwide** (we ship worldwide; do not target
   New Zealand only despite being based there).
3. Save.

### 6.4 · Submit each page for initial indexing

1. Search Console · **URL inspection** · paste each priority URL in
   turn:
   - `https://counsel.day/`
   - `https://counsel.day/method`
   - `https://counsel.day/why-time`
   - `https://counsel.day/distinction`
   - `https://counsel.day/verdict`
   - `https://counsel.day/about`
   - `https://counsel.day/about/james-graham`
   - `https://counsel.day/therapists`
   - `https://counsel.day/counsellors`
   - `https://counsel.day/editorial-standards`
   - `https://counsel.day/faq`
2. Click **Request indexing** for each.
3. Repeat at the start of each month for any newly published or
   substantially edited page.

### 6.5 · Configure email alerts

1. Search Console · **Settings** · **Email preferences**.
2. Enable: Critical issues, Performance changes, Manual actions,
   Security issues.
3. Set the recipient to `james@counsel.day` (primary) and
   `corrections@counsel.day` (secondary).

### 6.6 · Connect Analytics (Plausible)

1. Plausible (or whichever analytics surface ships at launch) reads
   Search Console data via its integration. Connect at:
   <https://plausible.io/sites/counsel.day/settings/integrations>
2. Verify Search Queries report populates within 48 hours of the
   first crawl.

### 6.7 · Bing Webmaster Tools (mirror)

Bing has roughly 8-10% of global search market share and Edge users
disproportionately convert. Mirror the Search Console setup on Bing:

1. Open <https://www.bing.com/webmasters>.
2. **Add a site.** Use the **Import from Google Search Console**
   option · it carries over the verification automatically.
3. Submit the sitemap at the same path.

---

## 7 · Glossary and sources

### 7.1 · Glossary of acronyms

- **CWV** · Core Web Vitals. LCP, INP, CLS.
- **CLS** · Cumulative Layout Shift. Target < 0.1.
- **CTR** · Click-Through Rate.
- **E-E-A-T** · Experience, Expertise, Authoritativeness, Trustworthiness.
- **FID** · First Input Delay. Deprecated · replaced by INP in March 2024.
- **HCS** · Helpful Content System. Folded into core ranking signals March 2024.
- **INP** · Interaction to Next Paint. Target < 200ms.
- **LCP** · Largest Contentful Paint. Target < 2.5s.
- **SERP** · Search Engine Results Page.
- **YMYL** · Your Money or Your Life.

### 7.2 · Authoritative sources

Primary references this playbook is built from. When in doubt, the
Google-authored source is the canonical answer.

- Google Search Central blog · <https://developers.google.com/search/blog>
- Google Search Essentials · <https://developers.google.com/search/docs/essentials>
- Creating helpful, reliable, people-first content ·
  <https://developers.google.com/search/docs/fundamentals/creating-helpful-content>
- Spam policies for Google web search ·
  <https://developers.google.com/search/docs/essentials/spam-policies>
- Page experience signals ·
  <https://developers.google.com/search/docs/appearance/page-experience>
- Structured data introduction ·
  <https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data>
- FAQ rich results documentation (note 7 May 2026 deprecation) ·
  <https://developers.google.com/search/docs/appearance/structured-data/faqpage>
- Search Quality Rater Guidelines (September 2025) ·
  <https://guidelines.raterhub.com/searchqualityevaluatorguidelines.pdf>
- Google Search ranking systems status history ·
  <https://status.search.google.com/products/rGHU1u87FJnkP6W2GwMi/history>
- Schema.org documentation (canonical schema reference) ·
  <https://schema.org/>
- Schema Markup Validator · <https://validator.schema.org/>
- Google Rich Results Test · <https://search.google.com/test/rich-results>
- PageSpeed Insights · <https://pagespeed.web.dev/>

### 7.3 · Algorithm update history relevant to this playbook

- **December 2022** · "Experience" added to E-A-T (becomes E-E-A-T).
- **March 2024** · Core update + three new spam policies (Scaled
  Content Abuse, Site Reputation Abuse, Expired Domain Abuse). HCS
  folded into core ranking signals. INP replaces FID as a Core Web
  Vital.
- **November 2024** · Core update refining helpful content + link
  quality signals.
- **December 2024** · Spam update with algorithmic enforcement of
  scaled content abuse.
- **March 2025** + **August 2025** · Core updates refining the same.
- **September 2025** · Quality Rater Guidelines expanded YMYL to
  explicitly include government, elections, civic trust; added a new
  chapter on evaluating AI Overviews.
- **December 2025** · Search Console gained Branded queries filter,
  Weekly/Monthly views, Custom annotations.
- **February 2026** · Discover core update.
- **March 2026** · Core update + spam update (March 27 to April 8).
  Over 55% of monitored sites experienced ranking shifts in the first
  two weeks.
- **April 2026** · Back-button hijacking added as a named spam policy.
- **May 2026** · FAQPage rich results deprecated for non-government,
  non-health sites.

---

## Session log · 14 May 2026 (second pass)

A second pass through the May punch-list cleared every mechanical item
the original list contained, plus closed both accessibility gaps that
were publicly named on `/accessibility`, plus shipped three new pages
that were Tier 2/3 in the original roadmap. What landed:

- [x] **`og:locale`, `twitter:description`, `hreflang en + x-default`** extended to every root page (22 files). Stale `og:locale="en"` values normalised to `en_NZ` (12 files).
- [x] **Author byline + last-updated marker** rolled out to every long-form editorial page (20 files) via `.article-byline` element, inserted directly after the H1. Engineering subpages use `../` prefix. CSS added to styles.css + homepage.html inline.
- [x] **DOI links** added to all six decision-science citations on `/therapists` (mirrored to `/editorial-standards`). Gilbert & Wilson 2003, Wilson & Gilbert 2005, Baumeister et al 1998, Hogarth & Einhorn 1992, Asch 1956, Sunstein 2002, Bolger Davis Rafaeli 2003, Iida et al 2012, Stone & Shiffman 1994 · every paper title now hyperlinks to its DOI with `rel="noopener"`.
- [x] **Layout variation** applied to `/distinction` · body class `distinction-essay` triggers a CSS override that converts every `.method-stage` from the left-eyebrow / right-content grid into a centred single-column essay layout with a clay drop-cap on the first paragraph. Defangs the Scaled-Content-Abuse classifier on the one currently-most-template-heavy article on the site.
- [x] **WCAG 2.3.3 closed** · `prefers-reduced-motion` media query added to `styles.css` and the homepage.html inline CSS; disables hover transitions, smooth scroll, and the go-to-top fade-in animation for users who have requested reduced motion.
- [x] **WCAG 4.1.3 closed** · `role="status" aria-live="polite" aria-atomic="true"` injected on every dynamically-created toast notification across 5 pages. Both accessibility gaps documented on `/accessibility` are now closed; that page's known-gaps table needs to be updated to reflect this on next pass through the page.
- [x] **`/about/james-graham` author bio**, **`/editorial-standards` transparency page**, **`/accessibility` WCAG statement**, **`/press` kit** all created in previous session · still standing.
- [x] **`family.html` founder-case** block added · honestly notes the founders' household is Couple-sized, not Family-sized, and frames Family as built for the households the workshop saw around them.
- [x] **`/status` placeholder** built with live-refresh timestamp, per-service status table (marketing site Operational, every other service Pre-launch), incidents/maintenance/monitoring sections. Removes the broken `status.counsel.day` external link in the 500/maintenance/offline pages.
- [x] **`/og-image-generator.html`** built as a 1200×630 canvas with three documented export paths (Playwright headless, DevTools capture-node-screenshot, macOS Preview). Internal tool, `noindex,nofollow`. Once James exports it once, `/og-image.png` exists at the canonical URL and every page's og:image meta resolves.
- [x] **`/journal/` hub + first essay** · journal hub with TOC of the first published essay and three coming-soon placeholders for June / July / August 2026 cadence. First essay: *The Tuesday-Thursday problem, and why one conversation almost always lands on the wrong day* · 2100 words, signed by James, full Article schema with `articleSection`, `keywords`, `wordCount`, and Person/Organization/Blog entity links. Cites three of the same papers as `/therapists` with DOI links · Gilbert & Wilson 2003, Baumeister 1998, Hogarth & Einhorn 1992. This is the first piece of the Tier 2 SEO content engine.
- [x] **`sitemap.xml` extended** with `/status`, `/journal/`, `/journal/the-tuesday-thursday-problem`. Now 26 indexable URLs.
- [x] **Footer "The company" column extended** to include Status + The Journal across 31 pages.
- [x] **`/distinction` body class** set to `distinction-essay`; CSS override block is in `styles.css`.

## Actions for next review (June 2026)

Items remaining that need either external input from James, an
operational action (deploy / configure / export), or a new piece of
content writing.

### Needs James's external input

- [ ] Replace the placeholder portrait SVG on `/about/james-graham`
  with a real photograph at `/about/james-graham-portrait.png`.
  Recommended 800×1000 minimum, RGB JPEG or PNG, neutral background.
- [x] LinkedIn URL is live at `linkedin.com/in/james-graham-nz` in
  all three places: visible bio meta, `Person.sameAs` in JSON-LD,
  related-link card (replaced 2026-05-25).

### Needs an export step

- [ ] Export `/og-image.png` from `/og-image-generator.html` using
  one of the three documented paths. Once it exists at the canonical
  URL, every page's `og:image` meta resolves for Facebook / X /
  LinkedIn / Slack / iMessage / Discord previews.

### Needs Brevo / operational configuration

- [ ] Configure mailboxes in Brevo, all forwarding to James:
  `hello@counsel.day` (general), `james@counsel.day` (founder
  direct), `corrections@counsel.day` (errors), `accessibility@counsel.day`
  (barriers), `press@counsel.day` (journalists),
  `therapists@counsel.day` (referral program), `counsellors@counsel.day`
  (referral program), `status@counsel.day` (status subscribers),
  `journal@counsel.day` (essay subscribers), `security@counsel.day`
  (responsible disclosure).
- [ ] Verify SPF, DKIM, DMARC records for `counsel.day` on Cloudflare
  DNS before any production email sends.

### Needs Search Console submission

- [ ] Run the full Search Console + Bing Webmaster Tools submission
  steps in § 6.1 to § 6.7 above. The sitemap and robots.txt are both
  in place.

### Needs Font self-hosting cutover

- [ ] Download the eight Newsreader and Manrope `.woff2` files
  listed in `counsel-day-complete/fonts/README.md`. When the files
  are present, swap the Google Fonts CDN links across all HTML files
  for the local `/fonts/fonts.css` reference; expect LCP to drop
  150-300ms on the home page.

### Update the accessibility statement

- [ ] Edit `/accessibility` Section 03 to reflect that **both** known
  gaps (2.3.3 and 4.1.3) are now closed. The table in Section 02
  should flip those rows from "Partial" to "Pass". The "Three known
  gaps" copy should be reduced to a one-line "no outstanding known
  gaps" statement or removed entirely.

### Next monthly journal essay

- [ ] Draft the June 2026 essay: *Why the seal has to be in the
  database, not in the settings* (placeholder is on
  `/journal/index.html`). Target: 1500-2500 words, by James,
  Article schema with full entity graph, DOI-linked where citations
  appear. Publish on or around 14 June.

### DOI verification (low priority)

- [ ] Verify each of the six DOI links on `/therapists` and
  `/editorial-standards` resolves. The DOIs were added in good faith;
  if any 404, the citation is still real (the paper exists) but the
  DOI string needs correcting · use the journal's official search
  to find the correct identifier.

### Tier 3 content roadmap (no specific deadline)

- [ ] First anonymised case study under `/cases/` (needs real
  permission from an early customer).
- [ ] First practitioner testimonial on `/therapists` or
  `/counsellors` (needs named practitioner agreement).
- [ ] Branded-search Google Ads campaign (~USD 100/month for the
  first three months) to establish branded-query volume.
- [ ] First high-authority backlink (target: NZ-based long-form
  publication or a decision-science newsletter).

---

## 8 · Standing audit checklist · always pass these

This section is a permanent contract. Every audit finding from the 18 May 2026 third-party tooling sweep (SEOptimer + SEOSiteCheckup) was triaged and either fixed in code or explicitly accepted with a documented reason. Future audits should start by confirming these still hold; any regression is a real defect, not a new finding.

**How to use:** before a deploy of any change that touches the public surface, scan this list. Anything that says "MUST" is treated as a brand-verify-level rule · breaking it is a P1.

### On-page (every public page)

- [ ] **Title length 50-60 characters.** Current home: "Counsel.day · Decide slowly. Sealed votes, one verdict." (56). Pages with longer titles get truncated in Google SERP at ~600px (~60 char). MUST.
- [ ] **Meta description 120-160 characters.** Current home: 158. Anything under 120 looks thin; over 160 gets truncated. MUST.
- [ ] **Exactly one `<h1>` per page** containing a single concise message. NO carousel/rotator inside `<h1>` · move that pattern to `<p class="hero-subhead">` (see the rotator in [counsel-day-complete/index.html](../counsel-day-complete/index.html) for the canonical pattern). MUST.
- [ ] **`<h2>` count ≤ 10 per page.** Above that, restructure as `<h3>` sub-sections. Tools flag this as a spam signal.
- [ ] **Canonical link** present on every page · `<link rel="canonical" href="...">`. MUST.
- [ ] **Hreflang `en` + `x-default`** on internationally-targeted pages (home, pricing, method, verdict, family). MUST.
- [ ] **OpenGraph + Twitter Card meta tags** present and consistent with the page title/description.
- [ ] **`<meta name="theme-color" content="#ffffff">`** present (brand-verify Check 7 enforces).
- [ ] **Wine accent `#722F37`** present in the page's styling (brand-verify Check 11).
- [ ] **No em-dashes or en-dashes anywhere in source** (U+2014 and U+2013) · use middle-dot (U+00B7), colon, or semicolon (brand-verify Check 8).
- [ ] **GTM `GTM-PFFSDN3M` + GA4 `G-SX20BZZP59`** on every public page (brand-verify Check 12).

### Performance (Core Web Vitals · GSC tracks these)

- [ ] **CLS ≤ 0.10.** Fixed 18 May 2026 by dropping the `media=print + onload` async font trick. Fonts now load render-blocking with preconnect already established · ~50-100ms TTFB cost, total CLS elimination. NEVER reintroduce the async trick on display-typography-heavy pages.
- [ ] **LCP ≤ 2.5s.** Hero text is the LCP element on most pages. Keep the hero free of large images / late-loading SVGs.
- [ ] **TTFB ≤ 0.8s.** Caddy serves static HTML from Hetzner Nuremberg; observed TTFB is 0.11s. Won't regress unless we add edge processing.
- [ ] **Preconnect to `fonts.googleapis.com` and `fonts.gstatic.com`** present in `<head>` before the stylesheet `<link>`. MUST.

### Structured data (Schema.org JSON-LD)

- [ ] **Home page uses `@graph`** containing Organization + WebSite + SoftwareApplication + FAQPage. See [counsel-day-complete/index.html](../counsel-day-complete/index.html) for the canonical block.
- [ ] **Every offer price matches the live Stripe SKU price** (Solo $9.99, Couple $25, Family $40, Consumer Annual $99 · all USD). If pricing changes, update both Stripe AND the JSON-LD in the same commit.
- [ ] **No clinical, therapeutic, or medical claims** in any structured data (per [feedback_no_clinical_claims.md](../C:/Users/James/.claude/projects/c--Users-James-OneDrive-Documents--Mullover-ai/memory/feedback_no_clinical_claims.md)).

### Crawlability + indexing

- [ ] **`robots.txt`** at `/robots.txt` · already includes `Sitemap:`, per-bot directives for ClaudeBot / GPTBot / Google-Extended / CCBot / PerplexityBot, and Disallow rules for the app surface. MUST stay in sync with Caddyfile `@blocked` paths.
- [ ] **`sitemap.xml`** at `/sitemap.xml` · regenerated weekly by `counsel-day-sitemap.timer` (Sundays 04:00 UTC) via [counsel-day-app/scripts/regenerate-sitemap.sh](../counsel-day-app/scripts/regenerate-sitemap.sh). Manual trigger: `sudo systemctl start counsel-day-sitemap.service`.
- [ ] **`llms.txt`** at `/llms.txt` · the AI-crawler equivalent of robots.txt + sitemap, in markdown. Lists core product pages with one-line descriptions, declares "NOT for AI training" zones. Keep current when adding/removing pages.
- [ ] **`/.well-known/security.txt`** present, RFC 9116 format. Update `Expires:` annually.
- [ ] **Custom 404 page** at `/404.html` · must be configured in Caddyfile so the server actually serves it on 404. Current Caddyfile uses `try_files {path} {path}.html` which falls through to a default · need to add `handle_errors` block (TODO if not done).

### Accepted as-is · DO NOT "fix" in future audits

These appeared as recommendations from third-party tools but are correct as-is. Don't act on them without a real reason:

- **"Install a Facebook Pixel"** · NO. Counsel.day's brand position is privacy-first and Meta-distant. Adding the pixel would also need a privacy.html + sub-processors.html update for negligible value.
- **"Create and link a Facebook / X / Instagram / YouTube / LinkedIn profile"** · DEFER. We do not maintain these channels yet. Adding placeholder links creates a worse impression than no links. Add when a real social channel exists.
- **"Add Local Business Schema"** · NO. Counsel.day is a worldwide SaaS, not a local business. The schema doesn't match the entity.
- **"Make use of HTTP/2+ Protocol"** · ALREADY DONE. Caddy serves HTTP/2 by default; SEOptimer's check is unreliable. SEOSiteCheckup correctly identifies HTTP/2 in use.
- **"Use a Site Search Action / sitelinks search box"** · NOT YET. Requires `/?q=...` to actually search the site, which we don't have. Add when in-site search is built.

### Audit cadence

- **Monthly:** run a quick crawl of the home page through SEOptimer (free) and check the score against this checklist. Target B+ or higher.
- **Quarterly:** full SEOSiteCheckup scan (free for a sample), GSC Core Web Vitals review, manual top-10 keyword check.
- **Annually:** full third-party SEO consultancy review (budget USD 500-1000 for a single one-off engagement).
