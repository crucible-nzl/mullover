"""
Cap every vertical padding and margin (top/bottom) value to 30px max.
Scope:
  - All .css files under counsel-day-complete/
  - All <style> blocks in .html files
  - All inline style="..." attributes in .html files
Exclusions: admin.html, og-image-generator.html, homepage.html, scripts/

Handles:
  - padding-top, padding-bottom, margin-top, margin-bottom (single value)
  - padding / margin shorthand (1/2/3/4-value forms)
  - Skips: var(...), calc(...), non-px units (em, rem, %, vh, vw)
  - Preserves !important and original whitespace
"""

import os
import re
import sys

CAP_PX = 30
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
EXCLUDE_FILES = {'admin.html', 'og-image-generator.html', 'homepage.html'}
EXCLUDE_DIRS = {'scripts'}


def cap_px(token):
    """Cap a single token like '56px' to CAP_PX if exceeded.
    Returns (new_token, changed)."""
    m = re.match(r'^(-?\d+(?:\.\d+)?)px$', token.strip())
    if not m:
        return token, False
    n = float(m.group(1))
    if n > CAP_PX:
        return f'{CAP_PX}px', True
    return token, False


def cap_shorthand(value, prop):
    """Process padding/margin shorthand. Returns (new_value, changed)."""
    parts = value.split()
    if len(parts) == 1:
        vert_idx = [0]  # applies to all sides
    elif len(parts) == 2:
        vert_idx = [0]  # vertical / horizontal
    elif len(parts) == 3:
        vert_idx = [0, 2]  # top / h / bottom
    elif len(parts) == 4:
        vert_idx = [0, 2]  # top / right / bottom / left
    else:
        return value, False
    changed = False
    new_parts = list(parts)
    for i in vert_idx:
        new_token, did = cap_px(new_parts[i])
        if did:
            new_parts[i] = new_token
            changed = True
    return ' '.join(new_parts), changed


DECL_RE = re.compile(
    r'(?<![a-zA-Z-])(padding|margin)(-top|-bottom)?\s*:\s*([^;}"\n]+?)\s*(?=[;}"\n]|$)',
    re.IGNORECASE,
)


def process_text(text):
    changes = []

    def repl(m):
        prop = m.group(1)
        suffix = m.group(2) or ''
        value = m.group(3).rstrip()
        important = ''
        v_lc = value.lower()
        if '!important' in v_lc:
            important = ' !important'
            value = re.sub(r'\s*!important\s*$', '', value, flags=re.IGNORECASE).rstrip()
        if 'var(' in value or 'calc(' in value:
            return m.group(0)
        if suffix.lower() in ('-top', '-bottom'):
            new_val, changed = cap_px(value)
        else:
            new_val, changed = cap_shorthand(value, prop.lower())
        if not changed:
            return m.group(0)
        new_decl = f'{prop}{suffix}: {new_val}{important}'
        changes.append((m.group(0).strip(), new_decl.strip()))
        return new_decl

    new_text = DECL_RE.sub(repl, text)
    return new_text, changes


STYLE_BLOCK_RE = re.compile(r'(<style[^>]*>)(.*?)(</style>)', re.DOTALL | re.IGNORECASE)
INLINE_STYLE_RE = re.compile(r'style\s*=\s*"([^"]*)"', re.IGNORECASE)


def process_html(content):
    changes = []

    def style_repl(m):
        inner_new, inner_changes = process_text(m.group(2))
        changes.extend(inner_changes)
        return m.group(1) + inner_new + m.group(3)
    content = STYLE_BLOCK_RE.sub(style_repl, content)

    def inline_repl(m):
        val = m.group(1)
        new_val, inline_changes = process_text(val)
        changes.extend(inline_changes)
        return f'style="{new_val}"'
    content = INLINE_STYLE_RE.sub(inline_repl, content)

    return content, changes


def process_file(path):
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    if path.endswith('.css'):
        new_content, changes = process_text(content)
    elif path.endswith('.html'):
        new_content, changes = process_html(content)
    else:
        return []
    if changes:
        with open(path, 'w', encoding='utf-8', newline='') as f:
            f.write(new_content)
    return changes


def main():
    all_changes = {}
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
        for fn in filenames:
            if fn in EXCLUDE_FILES:
                continue
            if not (fn.endswith('.html') or fn.endswith('.css')):
                continue
            full = os.path.join(dirpath, fn)
            ch = process_file(full)
            if ch:
                all_changes[full] = ch

    total = sum(len(v) for v in all_changes.values())
    print(f'\n== Cap vertical spacing to {CAP_PX}px ==')
    print(f'Files modified: {len(all_changes)}')
    print(f'Declarations changed: {total}\n')
    for path in sorted(all_changes):
        rel = os.path.relpath(path, ROOT)
        ch = all_changes[path]
        print(f'  {rel}: {len(ch)} change(s)')
        for old, new in ch[:3]:
            print(f'      - {old[:90]}  ->  {new[:90]}')
        if len(ch) > 3:
            print(f'      ... and {len(ch)-3} more')


if __name__ == '__main__':
    main()
