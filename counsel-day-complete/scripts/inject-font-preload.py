"""
One-shot: preload the above-the-fold font subsets in every public HTML <head>.

The LCP element on every page is a Newsreader heading; body copy is Source
Serif 4 and the nav/UI is Geist. Without a preload the browser only discovers
these woff2 after it has fetched and parsed /fonts/fonts.css, so the LCP
heading paints in the Georgia fallback and then swaps late (FOUT + CLS).

Preloading the three latin subsets makes the browser fetch them in parallel
with the CSS, so the real font is usually available by first paint.

Notes:
  - Same-origin fonts STILL require `crossorigin` on the preload: the actual
    @font-face fetch is CORS-anonymous, and a preload without crossorigin will
    not match it, causing a wasted double download.
  - We preload only the `latin` (U+0000-00FF) subsets · unicode-range gates the
    others, so English pages never request them. Google dedupes weights, so one
    file per family covers 400/500.
  - Idempotent. Inserts immediately BEFORE the Consent Mode block (same anchor
    inject-preconnect.py uses), keeping the hints high in <head>.

Run once (and after adding a new above-the-fold font):
  cd counsel-day-complete && python scripts/inject-font-preload.py
"""

import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
EXCLUDE_FILES = {'og-image-generator.html', 'homepage.html'}
EXCLUDE_DIRS = {'scripts', 'ops'}

# Sentinel · presence of the Newsreader preload means this page is done.
SENTINEL = 'newsreader-cY9AfjOCX1hbuyalUrK4397yjA.woff2'

PRELOAD_BLOCK = (
    '\n<!-- Preload above-the-fold font subsets (latin) · hero heading\n'
    '     (Newsreader), body (Source Serif 4), nav/UI (Geist). crossorigin is\n'
    '     required so the preload matches the CORS-anonymous @font-face fetch. -->\n'
    '<link rel="preload" as="font" type="font/woff2" href="/fonts/newsreader-cY9AfjOCX1hbuyalUrK4397yjA.woff2" crossorigin>\n'
    '<link rel="preload" as="font" type="font/woff2" href="/fonts/sourceserif4-vEFI2_tTDB4M7-auWDN0ahZJW1gb8tc.woff2" crossorigin>\n'
    '<link rel="preload" as="font" type="font/woff2" href="/fonts/geist-gyByhwUxId8gMEwcGFU.woff2" crossorigin>\n'
)

import re

# Anchor on the self-hosted fonts stylesheet · every page that self-hosts links
# it, and the preload belongs immediately before it (the browser can start the
# font fetch as soon as it sees the preload, in parallel with fetching the CSS
# that declares the @font-face). This is more robust than keying off the
# analytics comment, whose exact wording varies between the full and minified
# head snippets across the site.
FONTS_LINK_RE = re.compile(r'([ \t]*)<link rel="stylesheet" href="(?:/fonts/fonts\.css|fonts/fonts\.css)">')


def inject_one(path):
    with open(path, 'r', encoding='utf-8', newline='') as f:
        content = f.read()

    if SENTINEL in content:
        return 'skip-already-present'
    m = FONTS_LINK_RE.search(content)
    if not m:
        return 'no-fonts-link'

    new = content[:m.start()] + PRELOAD_BLOCK.rstrip('\n') + '\n' + content[m.start():]
    if new == content:
        return 'no-change'

    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write(new)
    return 'injected'


def main():
    counts = {'injected': 0, 'skip-already-present': 0, 'no-consent-block': 0, 'no-change': 0}
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
        for fn in filenames:
            if not fn.endswith('.html') or fn in EXCLUDE_FILES:
                continue
            res = inject_one(os.path.join(dirpath, fn))
            counts[res] = counts.get(res, 0) + 1
    for k, v in counts.items():
        print(f'  {k}: {v}')
    print(f'Done. Injected into {counts["injected"]} page(s).')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
