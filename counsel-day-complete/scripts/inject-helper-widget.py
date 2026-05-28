"""
Inject <script src="/helper-widget.js" defer></script> into every public HTML
file in counsel-day-complete/ that doesn't already have it.

- Admin surface (admin*.html) is carved out (no third-party widget chrome there).
- Idempotent: skips files that already reference helper-widget.js.
- Inserts the tag right before </body>.

Run after adding/renaming public pages.
"""

import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
EXCLUDE_FILES = {'og-image-generator.html', 'homepage.html', 'helper.html', 'maintenance.html', '404.html', '500.html'}
EXCLUDE_DIRS = {'scripts', 'ops', 'partials', 'fonts'}

TAG = '<script src="/helper-widget.js" defer></script>'

def is_admin_page(filename):
    return filename.lower().startswith('admin')

def inject_one(path):
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    if 'helper-widget.js' in content:
        return False
    new = re.sub(r'(\s*</body>)', '\n' + TAG + r'\1', content, count=1, flags=re.IGNORECASE)
    if new == content:
        return False
    with open(path, 'w', encoding='utf-8') as f:
        f.write(new)
    return True

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

def main():
    updated = 0
    skipped_admin = 0
    skipped_excluded = 0
    skipped_already = 0
    for path, fn in iter_html(ROOT):
        if fn in EXCLUDE_FILES:
            skipped_excluded += 1
            continue
        if is_admin_page(fn):
            skipped_admin += 1
            continue
        if inject_one(path):
            updated += 1
        else:
            skipped_already += 1
    print(f'Updated:        {updated}')
    print(f'Already-tagged: {skipped_already}')
    print(f'Admin-excluded: {skipped_admin}')
    print(f'Hard-excluded:  {skipped_excluded}')

if __name__ == '__main__':
    main()
