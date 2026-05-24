"""
Inject the canonical Consent Mode v2 + GTM + GA4 head snippet into every
public HTML file in counsel-day-complete/, plus the GTM noscript right after
<body>. Idempotent: skips files that already contain GTM-PFFSDN3M.

Order in <head>:
  1. <meta charset> + <meta viewport>  (must stay first per HTML spec)
  2. The analytics snippet  (must come BEFORE any other <script>)
  3. Everything else

Run after any new HTML page is added. Brand-verify Check 12 enforces presence.
"""

import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
SNIPPET_PATH = os.path.join(ROOT, 'ops', 'cd-head-snippet.html')

EXCLUDE_FILES = {'og-image-generator.html', 'homepage.html'}
EXCLUDE_DIRS = {'scripts', 'ops'}

# Admin surface is a carve-out per docs/BRAND.md and project_admin_stack.md ·
# no external scripts, no GA4, no GTM. Brand-verify Check 14 enforces this.
# Any HTML file starting with 'admin' is treated as admin and skipped.
def is_admin_page(filename):
    return filename.lower().startswith('admin')

GTM_ID = 'GTM-PFFSDN3M'
GA4_ID = 'G-SX20BZZP59'

NOSCRIPT_BLOCK = (
    '<!-- Google Tag Manager (noscript) -->\n'
    '<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=' + GTM_ID + '"\n'
    'height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>\n'
    '<!-- End Google Tag Manager (noscript) -->\n'
)


def load_snippet():
    with open(SNIPPET_PATH, 'r', encoding='utf-8') as f:
        return f.read().rstrip() + '\n'


def inject_one(path, snippet):
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    if GTM_ID in content and GA4_ID in content:
        return 'skip-already-injected'

    # --- inject the head snippet ---
    # Find the end of the viewport meta tag (right after charset + viewport).
    # If we can't find viewport, fall back to the opening <head> tag.
    viewport_re = re.compile(
        r'(<meta\s+name=["\']viewport["\'][^>]*>)',
        re.IGNORECASE
    )
    m = viewport_re.search(content)
    if m:
        insert_at = m.end()
        new_content = content[:insert_at] + '\n' + snippet + content[insert_at:]
    else:
        # Fallback: insert after <head>
        head_re = re.compile(r'(<head[^>]*>)', re.IGNORECASE)
        m = head_re.search(content)
        if not m:
            return 'no-head-tag'
        insert_at = m.end()
        new_content = content[:insert_at] + '\n' + snippet + content[insert_at:]

    # --- inject the noscript right after <body> ---
    body_re = re.compile(r'(<body[^>]*>)', re.IGNORECASE)
    m = body_re.search(new_content)
    if m and NOSCRIPT_BLOCK.strip() not in new_content:
        insert_at = m.end()
        new_content = new_content[:insert_at] + '\n\n' + NOSCRIPT_BLOCK + new_content[insert_at:]

    if new_content == content:
        return 'no-change'

    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write(new_content)
    return 'injected'


def main():
    snippet = load_snippet()
    counts = {'injected': 0, 'skip-already-injected': 0, 'no-head-tag': 0, 'no-change': 0}
    for d, ds, fs in os.walk(ROOT):
        ds[:] = [x for x in ds if x not in EXCLUDE_DIRS]
        for fn in fs:
            if fn in EXCLUDE_FILES:
                continue
            if not fn.endswith('.html'):
                continue
            if is_admin_page(fn):
                continue
            full = os.path.join(d, fn)
            r = inject_one(full, snippet)
            counts[r] += 1
            if r == 'injected':
                print('  injected ->', os.path.relpath(full, ROOT))
            elif r == 'no-head-tag':
                print('  NO HEAD TAG ->', os.path.relpath(full, ROOT))

    print('')
    print('== summary ==')
    for k, v in counts.items():
        print(f'  {k}: {v}')


if __name__ == '__main__':
    main()
