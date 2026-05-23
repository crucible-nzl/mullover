"""
One-shot: ensure every public HTML page has GA preconnect hints in <head>.

Idempotent. Inserts:
  <link rel="preconnect" href="https://www.googletagmanager.com" crossorigin>
  <link rel="preconnect" href="https://www.google-analytics.com" crossorigin>

immediately AFTER the viewport meta and BEFORE the Consent Mode script.
Run once after editing ops/cd-head-snippet.html or after this script
itself is added. After this lands, the snippet IS the source of truth.
"""

import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
EXCLUDE_FILES = {'og-image-generator.html', 'homepage.html'}
EXCLUDE_DIRS = {'scripts', 'ops'}

PRECONNECT_BLOCK = (
    '\n<!-- Preconnect to GA endpoints -->\n'
    '<link rel="preconnect" href="https://www.googletagmanager.com" crossorigin>\n'
    '<link rel="preconnect" href="https://www.google-analytics.com" crossorigin>\n'
)

# Match the existing Consent Mode block opener (it follows the viewport
# meta in every analytics-injected page). Insert just before it.
CONSENT_MARKER = '<!-- Google Consent Mode v2'


def inject_one(path):
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Already done?
    if 'preconnect' in content and 'googletagmanager.com' in content and content.find('preconnect') < content.find('googletagmanager.com'):
        # Only declare done when the preconnect appears before the script src.
        # First preconnect occurrence:
        preconnect_pos = content.find('preconnect')
        gtm_script_pos = content.find('googletagmanager.com')
        # We want the preconnect link to be before the first usage of gtm.
        if 'rel="preconnect"' in content[max(0, preconnect_pos - 30):preconnect_pos + 30] and preconnect_pos < gtm_script_pos:
            return 'skip-already-present'

    if CONSENT_MARKER not in content:
        return 'no-consent-block'

    idx = content.find(CONSENT_MARKER)
    new = content[:idx] + PRECONNECT_BLOCK + content[idx:]

    if new == content:
        return 'no-change'

    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write(new)
    return 'injected'


def main():
    counts = {'injected': 0, 'skip-already-present': 0, 'no-consent-block': 0, 'no-change': 0}
    for d, ds, fs in os.walk(ROOT):
        ds[:] = [x for x in ds if x not in EXCLUDE_DIRS]
        for fn in fs:
            if fn in EXCLUDE_FILES or not fn.endswith('.html'):
                continue
            full = os.path.join(d, fn)
            r = inject_one(full)
            counts[r] = counts.get(r, 0) + 1
            if r == 'injected':
                print('  injected ->', os.path.relpath(full, ROOT))

    print('\n== summary ==')
    for k, v in counts.items():
        print(f'  {k}: {v}')


if __name__ == '__main__':
    main()
