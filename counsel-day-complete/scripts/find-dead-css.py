"""
find-dead-css.py · enumerate CSS class names declared in styles.css and
report ones with zero references in any HTML or JS file.

Limitations:
  · Only inspects class selectors. Tag selectors, ID selectors,
    attribute selectors are not checked (they're rarer and harder to
    statically detect as dead).
  · A class is considered "used" if it appears anywhere in any .html
    or .js file under counsel-day-complete/. Treat the report as
    candidates, not as a delete list · classes added dynamically by
    JS templating may still be flagged here.

Usage:
  python scripts/find-dead-css.py
"""

from __future__ import annotations
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
CSS_FILES = [
    os.path.join(ROOT, 'styles.css'),
]
EXCLUDE_DIRS = {'scripts', 'ops', 'partials', 'fonts', 'icons', 'photos'}

CLASS_IN_SELECTOR = re.compile(r'\.([A-Za-z_][\w-]*)')


def read(path: str) -> str:
    try:
        with open(path, 'r', encoding='utf-8') as fh:
            return fh.read()
    except OSError:
        return ''


def collect_css_classes(text: str) -> set[str]:
    return set(CLASS_IN_SELECTOR.findall(text))


def collect_html_js(root: str) -> str:
    buf: list[str] = []
    for dirpath, dirnames, filenames in os.walk(root):
        rel = os.path.relpath(dirpath, root)
        parts = set(rel.split(os.sep)) if rel != '.' else set()
        if parts & EXCLUDE_DIRS:
            dirnames[:] = []
            continue
        for fn in filenames:
            if fn.endswith(('.html', '.js')):
                buf.append(read(os.path.join(dirpath, fn)))
    return '\n'.join(buf)


def main() -> int:
    all_classes: set[str] = set()
    for css_path in CSS_FILES:
        all_classes |= collect_css_classes(read(css_path))

    haystack = collect_html_js(ROOT)
    dead = sorted(c for c in all_classes if c not in haystack)

    print(f'CSS classes declared: {len(all_classes)}')
    print(f'Candidates for removal (not referenced anywhere): {len(dead)}')
    print()
    for c in dead:
        print(f'  .{c}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
