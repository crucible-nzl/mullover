#!/usr/bin/env python3
"""Hash long-cached static JS assets for permanent cache-busting.

Replaces `?v=YYYYMMDD` query strings (the manual cache-bust we added
2026-06-05 when the burger fix wouldn't propagate) with content-addressed
`<basename>.<hash>.<ext>` filenames so we can ship with `Cache-Control:
immutable, max-age=31536000` for a year without ever serving stale code.

Tracked assets · the JS files a browser holds for ~1 year:
  /nav-toggle.js
  /helper-widget.js
  /ga4.js
  /pwa.js

CSS is NOT tracked here because /sw.js precaches styles-i8.css by exact
name; renaming the CSS would break the service-worker shell. CSS uses a
different invalidation mechanism (cache-control no-cache).

Usage (local):
  cd counsel-day-complete && python3 scripts/hash-assets.py

Usage (CI, before tar+push in deploy-static):
  - name: Hash assets for cache-busting
    run: python3 ./counsel-day-complete/scripts/hash-assets.py

The script is idempotent: re-running on already-hashed files does nothing
because the previous hash matches the current content. Old hashed copies
are removed if their hash no longer matches the source (so the repo
doesn't grow unbounded · the CI runs in a fresh checkout each time so this
is mostly belt-and-braces for local runs).

Exits 0 on success; 1 on any error (caught by CI).
"""

from __future__ import annotations
import hashlib
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # counsel-day-complete/

# Assets to content-address. Paths are relative to ROOT.
# helper-widget.js is NOT hashed because it is loaded by
# helper-widget-loader.js at runtime via a dynamic <script> insertion ·
# the loader hard-codes the filename, so a hashed copy would never be
# requested. The loader IS hashed, which is what catches cache replay.
TRACKED = [
    "nav-toggle.js",
    "helper-widget-loader.js",
    "ga4.js",
    "pwa.js",
]

# Matches both /file.ext and ../file.ext, with or without a stale ?v=…
# query string. Capture group 1 is the path prefix (/. or ../); the
# regex matches lazily so we can swap just the filename + query.
def build_pattern(orig: str) -> re.Pattern[str]:
    esc = re.escape(orig)
    return re.compile(r"((?:/|\.\./))" + esc + r"(\?v=[0-9A-Za-z_]+)?")


def hash_file(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()[:10]


def remove_stale_hashed_copies(orig: str, current_hash: str) -> int:
    """Drop *.HASH.ext files for `orig` whose hash != current_hash.

    Keeps the directory clean during local iteration. CI starts from a
    fresh checkout so this is mostly a no-op there.
    """
    stem, dot, ext = orig.rpartition(".")
    pat = re.compile(re.escape(stem) + r"\.[0-9a-f]{10}\." + re.escape(ext) + r"$")
    removed = 0
    for f in ROOT.glob(f"{stem}.*.{ext}"):
        if pat.match(f.name) and current_hash not in f.name:
            try:
                f.unlink()
                removed += 1
            except OSError:
                pass
    return removed


def main() -> int:
    if not ROOT.is_dir():
        print(f"[fatal] ROOT not found: {ROOT}", file=sys.stderr)
        return 1

    rewrites: dict[str, str] = {}  # orig relative path -> hashed name
    for rel in TRACKED:
        src = ROOT / rel
        if not src.is_file():
            print(f"[skip] {rel} not found")
            continue
        h = hash_file(src)
        stem, dot, ext = rel.rpartition(".")
        hashed_name = f"{stem}.{h}.{ext}"
        dest = ROOT / hashed_name
        # If the hashed copy already exists with this hash, do nothing.
        # If it exists but with a stale hash, remove it.
        removed = remove_stale_hashed_copies(rel, h)
        if removed:
            print(f"  [cleanup] removed {removed} stale hashed copy/ies of {rel}")
        if not dest.exists():
            shutil.copyfile(src, dest)
            print(f"[hash] {rel} -> {hashed_name}")
        else:
            print(f"[hit ] {rel} -> {hashed_name} (already current)")
        rewrites[rel] = hashed_name

    if not rewrites:
        print("Nothing to hash.")
        return 0

    # Rewrite every HTML file's references. We only touch the JS we
    # tracked above; other references are left alone.
    htmls = sorted(ROOT.glob("**/*.html"))
    total_files_changed = 0
    total_replacements = 0
    for html in htmls:
        try:
            text = html.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            text = html.read_text(encoding="utf-8", errors="replace")
        new_text = text
        for orig, hashed in rewrites.items():
            pat = build_pattern(orig)
            new_text, n = pat.subn(lambda m: m.group(1) + hashed, new_text)
            total_replacements += n
        if new_text != text:
            html.write_text(new_text, encoding="utf-8")
            total_files_changed += 1

    print(
        f"\nHashed {len(rewrites)} assets · "
        f"rewrote {total_replacements} references across {total_files_changed} HTML files"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
