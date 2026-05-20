"""
sync-partials.py · stamp canonical nav + footer into pages that opt in via
marker comments.

Why this exists:
  Every footer change otherwise touches 54 files; every nav change
  touches 50. We keep the canonical HTML for each region under
  partials/ and let pages mark a region for replacement with a pair of
  HTML comments. Re-running this script after editing a partial pushes
  the change to every wrapped page in one step.

Marker format (in any HTML file):

  <!-- CD:PARTIAL:colophon -->
  ... whatever HTML you want, this whole block gets replaced ...
  <!-- /CD:PARTIAL:colophon -->

  <!-- CD:PARTIAL:nav-public -->
  ... whatever HTML you want, this whole block gets replaced ...
  <!-- /CD:PARTIAL:nav-public -->

  <!-- CD:PARTIAL:nav-app -->
  ... whatever HTML you want, this whole block gets replaced ...
  <!-- /CD:PARTIAL:nav-app -->

Known partials live in counsel-day-complete/partials/ as <name>.html.

Usage:
  python scripts/sync-partials.py            # apply
  python scripts/sync-partials.py --check    # report stale files, exit
                                             #   1 if any would change
  python scripts/sync-partials.py --list     # list every wrapped file

Onboarding a new page:
  Wrap its existing nav / footer with the markers shown above; re-run.
  Indentation inside the markers is preserved by replacing the inner
  block verbatim with the partial body.
"""

from __future__ import annotations
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
PARTIALS_DIR = os.path.join(ROOT, 'partials')
EXCLUDE_DIRS = {'scripts', 'ops', 'partials', 'icons', 'photos', 'fonts'}


def load_partials() -> dict[str, str]:
    out: dict[str, str] = {}
    for fname in os.listdir(PARTIALS_DIR):
        if not fname.endswith('.html'):
            continue
        name = fname[:-len('.html')]
        with open(os.path.join(PARTIALS_DIR, fname), 'r', encoding='utf-8') as fh:
            body = fh.read().rstrip('\n')
        out[name] = body
    return out


def iter_html_files(root: str):
    for dirpath, dirnames, filenames in os.walk(root):
        rel = os.path.relpath(dirpath, root)
        parts = set(rel.split(os.sep)) if rel != '.' else set()
        if parts & EXCLUDE_DIRS:
            dirnames[:] = []
            continue
        for fn in filenames:
            if fn.endswith('.html'):
                yield os.path.join(dirpath, fn)


def apply_partial(text: str, name: str, body: str) -> tuple[str, int]:
    pattern = re.compile(
        r'(<!--\s*CD:PARTIAL:' + re.escape(name) + r'\s*-->)(.*?)(<!--\s*/CD:PARTIAL:'
        + re.escape(name) + r'\s*-->)',
        re.DOTALL,
    )
    replacements = 0

    def repl(m: re.Match) -> str:
        nonlocal replacements
        replacements += 1
        return m.group(1) + '\n' + body + '\n' + m.group(3)

    new_text = pattern.sub(repl, text)
    return new_text, replacements


def main() -> int:
    mode = 'apply'
    if '--check' in sys.argv:
        mode = 'check'
    elif '--list' in sys.argv:
        mode = 'list'

    partials = load_partials()
    if not partials:
        print(f'No partials found under {PARTIALS_DIR}')
        return 1

    stale: list[str] = []
    touched: list[str] = []
    wrapped_files: list[str] = []

    for path in iter_html_files(ROOT):
        with open(path, 'r', encoding='utf-8') as fh:
            original = fh.read()
        text = original
        page_wraps: list[str] = []
        for name, body in partials.items():
            text, count = apply_partial(text, name, body)
            if count:
                page_wraps.append(name)
        if page_wraps:
            wrapped_files.append(path)
        if text != original:
            stale.append(path)
            if mode == 'apply':
                with open(path, 'w', encoding='utf-8', newline='\n') as fh:
                    fh.write(text)
                touched.append(path)

    if mode == 'list':
        for p in wrapped_files:
            print(os.path.relpath(p, ROOT))
        return 0

    if mode == 'check':
        if stale:
            print(f'{len(stale)} file(s) would change:')
            for p in stale:
                print(' ', os.path.relpath(p, ROOT))
            return 1
        print('All wrapped pages are in sync.')
        return 0

    print(f'Synced {len(touched)} file(s) against {len(partials)} partial(s).')
    for p in touched:
        print(' ', os.path.relpath(p, ROOT))
    if not touched:
        print('  (no changes)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
