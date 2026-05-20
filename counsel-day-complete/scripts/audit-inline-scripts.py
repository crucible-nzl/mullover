"""
audit-inline-scripts.py · count inline <script> and <style> blocks per
HTML file. Used as the first step of the CSP nonce migration
(docs/CSP_NONCE_MIGRATION.md): the smaller the footprint, the cheaper
the migration.

Usage:
  python scripts/audit-inline-scripts.py            # tabular report
  python scripts/audit-inline-scripts.py --hashes   # also print SHA-256 of each unique block
"""

from __future__ import annotations
import base64
import hashlib
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
EXCLUDE_DIRS = {'scripts', 'ops', 'partials', 'fonts', 'icons', 'photos'}

INLINE_SCRIPT = re.compile(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', re.DOTALL)
INLINE_STYLE = re.compile(r'<style[^>]*>(.*?)</style>', re.DOTALL)


def sha256_b64(body: str) -> str:
    digest = hashlib.sha256(body.encode('utf-8')).digest()
    return base64.b64encode(digest).decode('ascii')


def walk():
    for dirpath, dirnames, filenames in os.walk(ROOT):
        rel = os.path.relpath(dirpath, ROOT)
        parts = set(rel.split(os.sep)) if rel != '.' else set()
        if parts & EXCLUDE_DIRS:
            dirnames[:] = []
            continue
        for fn in filenames:
            if fn.endswith('.html'):
                yield os.path.join(dirpath, fn)


def main() -> int:
    show_hashes = '--hashes' in sys.argv

    total_scripts = 0
    total_styles = 0
    unique_script_hashes: set[str] = set()
    unique_style_hashes: set[str] = set()
    per_file: list[tuple[str, int, int]] = []

    for path in walk():
        with open(path, 'r', encoding='utf-8') as fh:
            text = fh.read()
        scripts = INLINE_SCRIPT.findall(text)
        styles = INLINE_STYLE.findall(text)
        for s in scripts: unique_script_hashes.add(sha256_b64(s))
        for s in styles: unique_style_hashes.add(sha256_b64(s))
        total_scripts += len(scripts)
        total_styles += len(styles)
        if scripts or styles:
            per_file.append((os.path.relpath(path, ROOT), len(scripts), len(styles)))

    per_file.sort(key=lambda r: (r[1] + r[2]), reverse=True)

    print(f'{"file":<60}  {"scripts":>7}  {"styles":>6}')
    print('-' * 80)
    for fn, ns, ny in per_file:
        print(f'{fn:<60}  {ns:>7}  {ny:>6}')
    print('-' * 80)
    print(f'{"TOTAL":<60}  {total_scripts:>7}  {total_styles:>6}')
    print()
    print(f'unique inline-script hashes: {len(unique_script_hashes)}')
    print(f'unique inline-style hashes:  {len(unique_style_hashes)}')

    if show_hashes:
        print()
        print('# script-src hashes')
        for h in sorted(unique_script_hashes):
            print(f"'sha256-{h}'")
        print()
        print('# style-src hashes')
        for h in sorted(unique_style_hashes):
            print(f"'sha256-{h}'")

    return 0


if __name__ == '__main__':
    raise SystemExit(main())
