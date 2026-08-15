# mullover.ai · restoring the redirects to counsel.day

Written 15 August 2026. James confirmed the domain is still registered.

## Why this is worth doing

The product rebranded from Mullover to Counsel.day in May 2026 and
**mullover.ai stopped resolving entirely** · the DNS is gone, not redirected.
Every backlink, bookmark, social mention and press reference earned before the
rebrand currently hits a dead end, and none of that authority reaches
counsel.day.

For an established domain this would be housekeeping. For counsel.day, which is
a few months old with a near-zero backlink profile, recovering even a handful of
real links is one of the highest-value actions available · and unlike content or
outreach it is a one-off configuration job.

301 redirects pass authority. Keep them in place for years, not months: there is
no point at which it becomes safe to drop them.

---

## Recommended approach · Cloudflare Bulk Redirects

Do this entirely at Cloudflare. It needs no server, no certificate management on
the Hetzner box, and no Caddy site block, so there is nothing extra to keep
running.

### Step 1 · Add mullover.ai to Cloudflare

1. Cloudflare dashboard, **Add a site**, enter `mullover.ai`, choose the Free
   plan.
2. Cloudflare shows two nameservers. Go to the registrar where mullover.ai is
   held and set the domain's nameservers to those two values.
3. Wait for Cloudflare to report the zone as **Active** (usually under an hour,
   occasionally up to 24).

### Step 2 · Give it something to resolve to

A redirect still needs a DNS record to attach to. Create two **proxied** records
(orange cloud ON · this is what lets Cloudflare answer before any origin):

| Type | Name | Content | Proxy |
|---|---|---|---|
| `AAAA` | `@` | `100::` | Proxied |
| `AAAA` | `www` | `100::` | Proxied |

`100::` is the IPv6 discard prefix · a deliberate black hole. Traffic never
reaches it because the redirect fires at Cloudflare's edge first. This is the
standard pattern for a redirect-only domain and costs nothing to run.

Cloudflare issues a Universal SSL certificate for the zone automatically, so
`https://mullover.ai` will not throw a certificate warning.

### Step 3 · Create the redirect rule

Rules then **Redirect Rules** then **Create rule**.

- **Name**: `mullover.ai to counsel.day`
- **If** · use the expression editor and paste:

  ```
  (http.host eq "mullover.ai") or (http.host eq "www.mullover.ai")
  ```

- **Then** · Dynamic redirect:
  - **Expression**:

    ```
    concat("https://counsel.day", http.request.uri.path)
    ```

  - **Status code**: `301`
  - **Preserve query string**: ON

This sends every path to the same path on counsel.day, which is correct because
the site structure carried over at the rebrand. Anything that does not exist on
counsel.day then meets the normal 404, or one of the consolidation 301s already
in the Caddyfile.

### Step 4 · Verify

```bash
curl -sI https://mullover.ai/            | head -3
curl -sI https://www.mullover.ai/pricing | head -3
curl -sI "https://mullover.ai/faq?utm_source=x" | head -3
```

Each should return `HTTP/2 301` with a `location:` header pointing at the
matching counsel.day URL, and the third should keep `?utm_source=x`.

---

## If any old paths do not exist on counsel.day

The rule above is path-preserving. If you know of specific old URLs that have no
equivalent (an old blog post, a renamed page), add a **Bulk Redirect List**
instead of relying on the catch-all, so those land somewhere useful rather than
on a 404:

1. Account Home, **Bulk Redirects**, create a list.
2. Add rows: source `https://mullover.ai/old-path`, target
   `https://counsel.day/best-equivalent`, status 301, preserve query string.
3. Bulk Redirects are evaluated before Redirect Rules, so specific mappings win
   over the catch-all automatically.

Old Mullover URLs worth checking, if you can recall or find them in an archive:
anything under `/blog`, `/features`, `/how`, or a pricing page with a different
slug. <https://web.archive.org/web/*/mullover.ai*> will list what the Wayback
Machine captured, which is the quickest way to recover the old URL set.

---

## After it is live

1. **Search Console**: add `mullover.ai` as a second Domain property and use the
   **Change of Address** tool (Settings then Change of address) to tell Google
   the site moved to counsel.day. This is a distinct signal from the 301s and
   speeds consolidation. It requires both properties verified.
2. Leave the redirects up **indefinitely**. Renew the domain on auto-renew.
3. Expect the effect to show up as counsel.day picking up the referring domains
   currently pointing at mullover.ai; check Bing Webmaster Tools' Backlinks
   report in a few weeks, since it is more forthcoming than Google's.

---

## Alternative · doing it on the Hetzner box instead

Only if you would rather not put the domain behind Cloudflare. Point
mullover.ai's A/AAAA records at the server and add this to
`counsel-day-complete/ops/Caddyfile`, which the deploy syncs and reloads
automatically:

```caddy
mullover.ai, www.mullover.ai {
    redir https://counsel.day{uri} permanent
}
```

Caddy will provision a certificate on first request. This works, but it makes
the origin responsible for a domain that otherwise never needs to reach it, and
it means a Hetzner outage takes the redirects down too. The Cloudflare route
above is the better default.
