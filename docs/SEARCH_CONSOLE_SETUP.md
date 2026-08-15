# Search Console + Bing Webmaster Tools · setup walkthrough

Written 15 August 2026. This is the gate on the whole SEO audit: until
counsel.day is verified and indexed, nothing else in
`20260815_counsel-day-seo-audit.md` can be measured, and a Google search for
"counsel.day" returns nothing from the site.

Do this **after** PR #27 deploys, so the first sitemap Google fetches is the
clean 32-URL one.

Total time: about 20 minutes, plus a wait for DNS.

---

## Part 1 · Google Search Console

### 1.1 Create a DOMAIN property (not URL prefix)

1. Go to <https://search.google.com/search-console> and sign in with the Google
   account that should own this long-term. Use a real account you will keep,
   not a throwaway; ownership is painful to move later.
2. Click the property dropdown (top left) then **Add property**.
3. You are offered two kinds. Pick the **left-hand one: Domain**.

   | | Domain (use this) | URL prefix (do not) |
   |---|---|---|
   | Covers | `counsel.day`, `www.counsel.day`, http + https, every subdomain | only the exact prefix you type |
   | Verified by | one DNS TXT record | file, tag, GA, or DNS |

   The Domain property is the right choice because the site already redirects
   `www` to the apex and serves https only; a URL-prefix property would report
   on one of those forms and silently ignore the others.

4. Type `counsel.day` (no `https://`, no `www.`) and press Continue.
5. Google shows a TXT record value that looks like
   `google-site-verification=<random string>`. Copy it.

### 1.2 Add the TXT record in Cloudflare

DNS for counsel.day is at Cloudflare.

1. Cloudflare dashboard, select **counsel.day**, then **DNS** then **Records**
   then **Add record**.
2. Fill in:
   - **Type**: `TXT`
   - **Name**: `@` (Cloudflare shows this as `counsel.day`)
   - **Content**: paste the `google-site-verification=...` value
   - **TTL**: Auto
3. Save. There is no proxy toggle on TXT records, so nothing to configure there.
4. Back in Search Console, press **Verify**. It usually passes within a minute
   or two; if it fails, wait 5 minutes and retry rather than re-issuing a new
   token.

**Leave the TXT record in place permanently.** Deleting it un-verifies the
property.

### 1.3 Submit the sitemap

1. In Search Console, left menu, **Sitemaps**.
2. Under "Add a new sitemap", enter exactly:

   ```
   sitemap.xml
   ```

3. Submit. Status should become **Success** with **32 discovered URLs**.

   If it reports a different count, the deploy has not finished or the old
   server-side generator is still running; check that PR #27 deployed and that
   `curl https://counsel.day/sitemap.xml | grep -c "<loc>"` returns 32.

### 1.4 Read the Pages report

Left menu, **Indexing** then **Pages**. This is the single most useful screen.

- **"Why pages aren't indexed"** lists a reason per URL. For a young site the
  common, harmless ones are *Discovered · currently not indexed* and *Crawled ·
  currently not indexed*: Google knows about the page and has not got round to
  it. That resolves with time and links, not with changes to the page.
- Reasons that mean something is wrong, and what they would indicate here:
  - *Excluded by 'noindex' tag* on a page you expect to rank · check that page's
    robots meta. Expected on `start.html`, every `offer*` page, `signin`,
    `signup` and the app surface; those are deliberate.
  - *Blocked by robots.txt* on a page in the sitemap · this should now be
    impossible; brand-verify fails the build on it. Report it to me if it appears.
  - *Page with redirect* · expected for `/method`, `/distinction`,
    `/the-experience`, `/what-youll-see`, `/durations`, `/specimen`,
    `/therapists`, `/counsellors` (all 301 to their survivors) and for any
    `.html` URL (301 to the extensionless form).
  - *Not found (404)* / *Soft 404* · investigate.
  - `/journal*`, `/vault*`, `/daily*` will report as **410 Gone**. That is
    correct and intended; do not "fix" it.

### 1.5 Request indexing for the core pages

Use the search bar at the top ("Inspect any URL"), then **Request indexing**.
There is a daily quota of roughly 10 to 12, so spend it on:

```
https://counsel.day/
https://counsel.day/how-it-works
https://counsel.day/pricing
https://counsel.day/use-cases
https://counsel.day/faq
https://counsel.day/why-time
https://counsel.day/compare
https://counsel.day/verdict
https://counsel.day/family
https://counsel.day/practitioners
```

Requesting more than once for the same URL does not speed it up.

### 1.6 Register the custom dimension you already emit

Unrelated to indexing but easy to forget: in **GA4** (not Search Console),
Admin then Custom definitions then Create custom dimension, scope **Event**,
parameter name `day_number`. Without it the retention curve from PR #18 cannot
be plotted.

---

## Part 2 · Bing Webmaster Tools

Worth 10 minutes: Bing also feeds ChatGPT search, and its index is far easier
to enter than Google's for a new domain.

1. Go to <https://www.bing.com/webmasters> and sign in.
2. Choose **Import from Google Search Console** if offered. It carries the
   verification across and saves the DNS step entirely.
3. If you would rather not connect the accounts, choose **Add site manually**,
   enter `https://counsel.day`, and verify with a DNS TXT record exactly as in
   step 1.2 (Bing's record is `BingSiteAuth.xml`-style or a TXT value it
   supplies; either is fine).
4. Submit the same sitemap URL: `https://counsel.day/sitemap.xml`.
5. Use **URL Inspection** then **Request indexing** on the homepage.

Bing's **Site Explorer** and **Backlinks** reports are more generous than
Google's and are a decent free way to watch the link profile grow.

---

## What to expect, and when

| Timeframe | What should happen |
|---|---|
| Same day | Verification passes; sitemap reads 32 URLs |
| 2 to 7 days | Homepage and a handful of core pages indexed; a search for `site:counsel.day` starts returning results |
| 2 to 4 weeks | Most of the 32 pages indexed; a search for **counsel.day** returns the site rather than only the legal-profession events |
| 1 to 3 months | Category queries begin to show impressions, assuming articles and links follow |

`site:counsel.day` in a normal Google search is the quickest manual check of
how much is indexed. Zero results means the property work above has not taken
effect yet; do not panic before day 3.

---

## If the site still shows nothing after two weeks

Check in this order, cheapest first:

1. `curl -sI https://counsel.day/ | head -1` returns `HTTP/2 200`.
2. `curl -s https://counsel.day/ | grep -i 'name="robots"'` does **not** contain
   `noindex` (a stray noindex on the homepage is the classic silent killer).
3. `curl -s https://counsel.day/robots.txt` does not disallow `/`.
4. Search Console, URL Inspection on `https://counsel.day/`, then **Test live
   URL**. It tells you exactly what Googlebot sees, including whether Cloudflare
   is serving it a challenge page.
5. Cloudflare: confirm no Bot Fight Mode or security rule is challenging
   Googlebot. This is the one that catches people out on Cloudflare-proxied
   sites; Googlebot receiving a JS challenge is invisible from a browser.

If all five pass and there is still nothing, the answer is almost certainly
domain age plus a near-zero backlink profile, which is a links-and-content
problem rather than a technical one.
