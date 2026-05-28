"""
One-shot rename · "The Daily Counsel" / "The Daily" / "Daily Pro" → "Counsel Journal" / "Journal" / "Journal Pro"

Per project_counsel_journal_rename.md: The Daily Counsel is rebranded as a
standalone product called Counsel Journal. This script does the mechanical
find-replace across user-facing HTML only · code identifiers (table names,
API routes, env vars) are NOT renamed.

Conservative: only the unambiguous product-name forms. "daily entry",
"daily verdict", "daily prompt" (adjective uses of 'daily') are left alone.

Idempotent: re-running on already-renamed content is a no-op.
"""

import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
EXCLUDE_FILES = {'og-image-generator.html', 'homepage.html'}
EXCLUDE_DIRS = {'scripts', 'ops', 'partials', 'fonts', 'photos', 'icons'}

# Order matters: longer / more specific replacements first.
REPLACEMENTS = [
    # Subscription / tier names
    ('Counsel · Daily Pro', 'Counsel Journal Pro'),
    ('Daily Pro · $4.99 USD / MONTH', 'Journal Pro · $4.99 USD / MONTH'),
    ('Daily Pro', 'Journal Pro'),
    # Product brand
    ('The Daily Counsel', 'Counsel Journal'),
    ('the Daily Counsel', 'Counsel Journal'),
    ('Daily Counsel', 'Counsel Journal'),
    ('COUNSEL · DAILY · PRO', 'COUNSEL JOURNAL · PRO'),
    ('Counsel · Daily', 'Counsel Journal'),
    # Standalone "The Daily" in marketing/nav contexts. These patterns
    # target high-signal forms: anchor link text, eyebrow labels,
    # standalone titles. We do NOT touch "the daily X" adjective forms.
    ('>The Daily</a>', '>Journal</a>'),
    ('>The Daily<', '>Counsel Journal<'),
    ('<h5>The Daily</h5>', '<h5>Counsel Journal</h5>'),
    ('A companion product · The Daily', 'A second product · Counsel Journal'),
    ('A second product · The Daily', 'A second product · Counsel Journal'),
]

def iter_html(root):
    for dirpath, dirnames, filenames in os.walk(root):
        rel = os.path.relpath(dirpath, root)
        parts = set(rel.split(os.sep)) if rel != '.' else set()
        if parts & EXCLUDE_DIRS:
            dirnames[:] = []
            continue
        for fn in filenames:
            if fn.endswith('.html'):
                yield os.path.join(dirpath, fn), fn

def rename_one(path):
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    new = content
    for old, replacement in REPLACEMENTS:
        new = new.replace(old, replacement)
    if new == content:
        return False
    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write(new)
    return True

def main():
    updated = 0
    skipped = 0
    for path, fn in iter_html(ROOT):
        if fn in EXCLUDE_FILES:
            continue
        # Admin pages are a brand carve-out per docs/BRAND.md; user-facing
        # rename should still apply there because admin views user data
        # labelled with the product name (e.g. "Daily Pro" on user detail).
        if rename_one(path):
            updated += 1
            print(f'  renamed: {os.path.relpath(path, ROOT)}')
        else:
            skipped += 1
    print()
    print(f'Updated: {updated}')
    print(f'Skipped: {skipped}')

if __name__ == '__main__':
    main()
