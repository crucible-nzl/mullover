# Counsel.day SEO Audit
14 August 2026

## Where things stand

The site itself is in reasonable technical shape: titles and meta descriptions exist on every page checked, canonicals are set, each page has a single H1, Open Graph and Twitter cards are present, unknown URLs return a proper 404, and the copy is substantial (the FAQ alone is around 4,200 words). The writing is distinctive and the information architecture is coherent.

The problem is visibility. A Google search for "counsel.day" returns nothing from the site at all: the results are dominated by the Association of Corporate Counsel's "In-house Counsel Day" events and legal dictionary entries. Category searches ("decision making app for couples") surface competitors such as HardChoice, Swypo and CoupleSuite, but not Counsel.day. In practical terms the site currently has no organic presence, so the audit below is ordered by what will move that needle fastest.

---

## Critical: fix these first

### 1. Confirm the site is actually indexed, and set up Search Console properly

Nothing else on this list matters until this is resolved. Verify counsel.day in Google Search Console (domain property, not just URL prefix), check the Pages report for how many URLs are indexed and why others are excluded, and submit a cleaned sitemap (see item 2). If the site is unindexed, the likely causes are the domain's youth (rebranded May 2026), a near-zero backlink profile, and the sitemap problems below, rather than any penalty. Do the same in Bing Webmaster Tools while you are there; it also feeds ChatGPT search.

### 2. Rebuild the sitemap: it is actively harming you

The current sitemap lists 103 URLs and most of them should not be there:

- **23 admin pages** (admin-crm.html, admin-database.html, admin-security.html, admin-finance.html and so on). These are blocked by robots.txt yet advertised in the sitemap. That is a direct contradiction (Google may index the bare URLs as "Indexed, though blocked by robots.txt") and it is also a security disclosure: you are publishing a map of your admin surface to anyone who reads /sitemap.xml.
- **Template partials** (partials/nav-public.html, partials/nav-app.html, partials/colophon.html): raw page fragments that should never be crawled, let alone submitted for indexing.
- **App-surface and utility pages**: vault.html, vote.html, verdict.html, inbox.html, daily.html, welcome.html, start.html, helper.html, o.html, signin.html, signup.html, diag-voice.html, admin-journal-testing.html. Signed-in or transactional screens have no place in a sitemap.
- **All the ad landers** (offer.html, offer-a through offer-g, offer-e-facebook, offer-e-google, offer-e-instagram, offer-e-tiktok). These are correctly tagged noindex (verified on offer-e-google), which makes listing them in the sitemap another direct contradiction. Noindexed pages must not be in the sitemap.
- **Every URL carries the identical lastmod date** (2026-08-12). Google treats blanket lastmod values as noise and ignores them. Use real modification dates or omit the field.

The sitemap should contain only the 25 to 30 canonical public marketing and content pages: home, how-it-works, pricing, faq, use-cases, compare, method, why-time, durations, the-experience, what-youll-see, specimen, distinction, family, therapists, counsellors, apply-practitioner, about, the founder page, press, correspondence, contact, help, security, changelog, editorial standards, the legal pages, and the journal section once it works (next item).

### 3. The journal section is broken

journal.html, /journal/ and /journal/the-tuesday-thursday-problem.html all resolve to the homepage content rather than their own pages, yet all three are listed in the sitemap. Whatever the cause (a rewrite rule or redirect), the effect is that your only article content does not exist as far as Google is concerned, and the sitemap is pointing crawlers at URLs that duplicate the homepage. Either restore these pages properly or remove them from the sitemap until the section is live. Given that content is your main growth lever (item 7), fixing this matters beyond hygiene.

### 4. The old domain mullover.ai is dead, not redirected

mullover.ai no longer resolves at all (DNS is gone). Every backlink, bookmark, social mention and press reference the product earned before the May 2026 rebrand now hits a dead end, and none of that equity passes to counsel.day. If you still own the domain, restore DNS and put permanent 301 redirects in place from every old URL to its counsel.day equivalent, and keep them for years. If the registration has lapsed, re-register it if at all possible. For a young domain with few links, recovering even a handful of old ones is meaningful.

---

## High priority: how you start ranking for something

### 5. Retitle pages for queries, not just brand voice

Every title checked is elegant but written for people who already know the product. The homepage title is "Counsel.day · Decide slowly. Sealed votes, one verdict." Nobody searches any of those words. Nothing on the site names the category people actually type: "decision app for couples", "how to make a big decision together", "couples decision making tool". Keep the voice, but let titles carry query language, for example:

- Home: "Counsel.day: the decision app for couples and families · Sealed daily votes, one verdict"
- Use cases: "Big decisions for couples: moving, career, family · Counsel.day"
- Compare: "Decision tool vs couples therapy: which do you need? · Counsel.day"

This also helps with the brand collision problem: "counsel day" already means legal profession events in Google's understanding, so pairing the brand with category words ("decision app") in titles, OG tags and any external profiles teaches Google what entity counsel.day is.

### 6. Add structured data: there is currently none

No JSON-LD anywhere on the site. Add, at minimum:

- **Organization + WebSite** on the homepage (name, logo, sameAs links to your social profiles: this is the main tool for disambiguating the brand from "In-house Counsel Day").
- **Product with Offer markup** on the pricing page (Solo $4.99, Couple $9.99, Family $19.99, USD): eligible for price rich results.
- **FAQPage** on faq.html. You have roughly 35 well-written Q&As already; this is free rich-result eligibility sitting unused. Also consider FAQPage on the pricing page's question section.
- **BreadcrumbList** on interior pages.
- **Person** on the founder page (about/james-graham.html), linked from Organization via founder.
- **Article** on journal posts once the section is live.

### 7. Build out content targeting real questions

The competitors that do rank in this category do it with articles (HardChoice ranks with "How to make big decisions as a couple without fighting"). You have the shell for this (a journal section, an editorial-standards page, a named founder) but no functioning content. A realistic programme: two to four well-crafted pieces a month against queries like "how to decide whether to move cities", "should we have another child: how to decide together", "how to make a big decision with your partner without fighting", "decision journal method", "why you should sleep on big decisions" (this last one is why-time.html's natural territory, worth expanding). Your sealed-vote method is a distinctive angle that generic listicles cannot copy, and each piece should link to the relevant use-case and product pages.

### 8. Split use cases into dedicated pages

use-cases.html covers five categories (family and reproduction, the partnership, home and place, career, solo) in about 850 words on a single page, with no individual pages. Each category should be its own landing page targeting its own query space ("deciding whether to move house as a couple", "career change decision framework", and so on), with the current page becoming a hub linking to them. family.html already exists as a start; build the rest to match.

### 9. Earn some links: the profile is close to zero

A young domain with no backlinks will struggle to rank for anything, including its own name. Practical, fast wins: launch on Product Hunt; get listed in app and tool directories; pitch the sealed-vote method to psychology and relationships writers (the press.html page suggests intent, but it needs actual coverage); guest contributions on decision-making and relationships publications; ask Nick Burns and any practitioners in the referral programme to link from their practice sites. The therapist and counsellor programme is a genuine link asset: practitioner directory listings and practice-site links are topically perfect.

---

## Medium priority: tidy-ups

### 10. Canonical and URL consistency

The ad lander's canonical points to an extensionless URL (https://counsel.day/offer-e-google) while pages serve as .html. Pick one URL form and make every canonical match what actually serves. Also confirm that www.counsel.day 301-redirects to the apex domain rather than serving a duplicate 200 (it currently loads; verify the redirect status in Search Console or with a header check).

### 11. Robots.txt trims

The file is thoughtful, but two notes. First, blocking tracking parameters via robots (Disallow: /*?utm_*) prevents Google from crawling those URLs and consolidating them to the canonical; since every page already has a canonical tag, the robots rules are redundant and slightly counterproductive. Second, signin.html and signup.html are in the sitemap but not disallowed or noindexed; utility pages like these are better noindexed.

### 12. Per-page social images

All pages appear to share one og-image.png. Fine for launch; when the journal goes live, give articles their own OG images to improve click-through when shared.

### 13. Measure Core Web Vitals

I could not get a PageSpeed Insights run through (rate-limited), so treat this as unverified. A static HTML site with two serif webfonts and one sans should score well, but run PSI on the home, pricing and how-it-works pages and check the font-loading strategy (font-display: swap, preload the primary text face) and the LCP element. Once Search Console has data, the Core Web Vitals report will confirm field performance.

### 14. Locale signal

og:locale is en_US, pricing is USD worldwide, and there is no hreflang. For a worldwide English product this is fine as-is; just be aware that if you ever want to rank in NZ/AU specifically, localised pages with hreflang would be the mechanism.

---

## Suggested order of work

Week 1: Search Console and Bing verification, rebuild the sitemap, fix or remove the journal URLs, request indexing of the core pages, chase the mullover.ai redirects.

Weeks 2 to 3: retitle key pages with query language, add Organization, Product, FAQPage and Person structured data, noindex the utility pages, fix canonical consistency.

Month 2 onward: dedicated use-case pages, the journal publishing programme, Product Hunt launch and the first round of link outreach through the practitioner network.

The single most important idea: the site was built to explain the product beautifully to someone already standing on it. The next phase of work is building the pages and signals that let someone who has never heard of it find it.
