"""
gen-sitemap.py · build sitemap.xml from the pages on disk.

Why this exists:
  sitemap.xml used to be generated ON THE SERVER after each deploy
  (counsel-day-app/scripts/regenerate-sitemap.sh, fired by
  counsel-day-sitemap.service/.timer, plus a second generator at
  src/jobs/sitemap.ts). That crawler walked /var/www, which is a
  different set of files from the repo, and it:

    · stamped `date -u` on EVERY url, so every lastmod was identical
      and Google discarded all of them as noise;
    · excluded only admin.html, so all 23 admin-*.html pages were
      published to the sitemap · a map of the admin surface, and a
      direct contradiction of robots.txt;
    · never excluded partials/, offer*.html, signin, signup or o.html,
      so raw fragments and noindex ad landers were submitted for
      indexing;
    · dropped engineering/ entirely, losing four real pages;
    · re-added retired pages every deploy, because the deploy never
      pruned /var/www.

  All of those were removed on 2026-08-15. The repo is now the single
  source of truth: this script writes sitemap.xml, the file is
  committed, and the deploy ships it as a plain file. Do not
  reintroduce server-side sitemap generation.

Inclusion rule · DEFAULT DENY:
  A page is listed only if it has an explicit <meta name="robots">
  whose content does NOT contain "noindex". A page with no robots meta
  is excluded. That is what keeps partials, fragments and any
  newly-added file out of the sitemap until someone opts it in.

Field derivation:
  <loc>     · the page's own <link rel="canonical">. It must be
              absolute and on https://counsel.day.
  <lastmod> · the page's <meta property="article:modified_time">,
              copied VERBATIM. It is deliberately not normalised to
              UTC: correspondence.html carries +12:00, and converting
              it would silently move the date back a day.

  <changefreq> and <priority> are not emitted · Google ignores both.
  Self-referential hreflang alternates are not emitted either; a
  single-language page pointing at itself carries no signal.

Usage:
  python scripts/gen-sitemap.py            # write sitemap.xml
  python scripts/gen-sitemap.py --check    # exit 1 if it would change
"""

from __future__ import annotations
import os
import re
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
SITEMAP = os.path.join(ROOT, "sitemap.xml")
HOST = "https://counsel.day"

# Directories never walked. partials/ holds raw nav + footer fragments;
# scripts/ and ops/ are excluded from the deploy entirely.
SKIP_DIRS = {"scripts", "ops", "partials", "fonts", ".git", "node_modules"}

ROBOTS_RE = re.compile(
    r"""<meta\s+name=["']robots["']\s+content=["']([^"']*)["']""", re.I
)
CANON_RE = re.compile(
    r"""<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']""", re.I
)
MODTIME_RE = re.compile(
    r"""<meta\s+property=["']article:modified_time["']\s+content=["']([^"']+)["']""",
    re.I,
)


def iter_html():
    """Yield every candidate .html path, relative to ROOT, sorted."""
    out = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in filenames:
            if fn.endswith(".html"):
                rel = os.path.relpath(os.path.join(dirpath, fn), ROOT)
                out.append(rel.replace(os.sep, "/"))
    return sorted(out)


def collect(errors: list[str]):
    """Return [(loc, lastmod, relpath)] for every indexable page."""
    pages = []
    for rel in iter_html():
        try:
            html = open(os.path.join(ROOT, rel), encoding="utf-8").read()
        except UnicodeDecodeError:
            html = open(
                os.path.join(ROOT, rel), encoding="utf-8", errors="replace"
            ).read()

        m = ROBOTS_RE.search(html)
        if not m:
            continue  # default deny · no robots meta means not indexable
        if "noindex" in m.group(1).lower():
            continue

        canon = CANON_RE.search(html)
        if not canon:
            errors.append(f"{rel}: indexable but has no <link rel=canonical>")
            continue
        loc = canon.group(1).strip()
        if not loc.startswith(HOST):
            errors.append(f"{rel}: canonical is not on {HOST} · {loc}")
            continue

        mod = MODTIME_RE.search(html)
        if not mod:
            errors.append(
                f"{rel}: indexable but has no <meta property=article:modified_time>"
            )
            continue

        pages.append((loc, mod.group(1).strip(), rel))

    locs = [p[0] for p in pages]
    for loc in sorted(set(locs)):
        if locs.count(loc) > 1:
            dupes = ", ".join(p[2] for p in pages if p[0] == loc)
            errors.append(f"duplicate canonical {loc} on: {dupes}")

    # Homepage first, then alphabetical · stable output for diffing.
    pages.sort(key=lambda p: (p[0] != f"{HOST}/", p[0]))
    return pages


def stale_dates(pages):
    """Warn where git says the file changed after its modified_time.

    Advisory only · never fails the build. A mechanical sweep (a link
    rename across every page) trips this without the content actually
    changing, so it is a prompt to look, not an error.
    """
    warnings = []
    for loc, lastmod, rel in pages:
        try:
            out = subprocess.run(
                ["git", "log", "-1", "--format=%cs", "--", rel],
                cwd=ROOT,
                capture_output=True,
                text=True,
                timeout=10,
            )
        except (OSError, subprocess.SubprocessError):
            return warnings  # no git available · skip silently
        git_date = out.stdout.strip()
        if git_date and git_date > lastmod[:10]:
            warnings.append(f"{rel}: git {git_date} > article:modified_time {lastmod[:10]}")
    return warnings


def render(pages) -> str:
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        "",
        "  <!-- ============================================================ -->",
        "  <!--  Counsel.day sitemap                                          -->",
        "  <!--  GENERATED · do not hand-edit.                                -->",
        "  <!--  Run: python scripts/gen-sitemap.py                           -->",
        "  <!--  A page appears here only if its <meta name=robots> exists    -->",
        "  <!--  and does not say noindex. lastmod comes from each page's     -->",
        "  <!--  article:modified_time, copied verbatim.                      -->",
        "  <!-- ============================================================ -->",
        "",
    ]
    for loc, lastmod, _rel in pages:
        lines += [
            "  <url>",
            f"    <loc>{loc}</loc>",
            f"    <lastmod>{lastmod}</lastmod>",
            "  </url>",
        ]
    lines += ["", "</urlset>", ""]
    return "\n".join(lines)


def main() -> int:
    check = "--check" in sys.argv

    errors: list[str] = []
    pages = collect(errors)
    if errors:
        for e in errors:
            print(f"[fatal] {e}", file=sys.stderr)
        return 1
    if not pages:
        print("[fatal] no indexable pages found", file=sys.stderr)
        return 1

    new = render(pages)
    old = open(SITEMAP, encoding="utf-8").read() if os.path.isfile(SITEMAP) else ""

    if check:
        if new != old:
            print(
                "[fail] sitemap.xml is out of date · run: "
                "python scripts/gen-sitemap.py",
                file=sys.stderr,
            )
            return 1
        print(f"[ok] sitemap.xml matches the {len(pages)} indexable pages on disk")
        return 0

    if new != old:
        open(SITEMAP, "w", encoding="utf-8", newline="\n").write(new)
        print(f"[write] sitemap.xml · {len(pages)} urls")
    else:
        print(f"[hit ] sitemap.xml already current · {len(pages)} urls")

    for w in stale_dates(pages):
        print(f"  [warn] {w}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
