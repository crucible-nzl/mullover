"""
One-shot: replace marketing references to "Claude" / "Anthropic" / "Claude Opus 4.7"
with the brand-abstracted phrase "our AI synthesis tool".

EXCLUDES:
  - privacy.html, sub-processors.html, security.html  (legal/GDPR sub-processor disclosure must
    name Anthropic by law)
  - admin.html, admin-app.js                          (internal admin panel, names the vendor in
    operational copy)
  - robots.txt                                        (ClaudeBot is the Anthropic crawler user-agent,
    unrelated to our use of Claude)
  - terms.html lines containing "Reverse-engineer"    (legal clause referencing the model owner)

Run after pulling the latest. Brand-verify still must pass.
"""

import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))

EXCLUDE_FILES = {
    'privacy.html',
    'sub-processors.html',
    'security.html',
    'admin.html',
    'admin-app.js',
    'robots.txt',
}
EXCLUDE_DIRS = {'scripts', 'ops'}

# Order matters · longest specific phrases first so they're consumed before
# the broad "Claude" / "Anthropic" sweeps.
SUBS = [
    (r'\bAnthropic Claude API\b',     'our AI synthesis tool'),
    (r'\bAnthropic Claude\b',          'our AI synthesis tool'),
    (r'\bClaude \(by Anthropic\)',     'our AI synthesis tool'),
    (r'\bClaude \(Anthropic\)',        'our AI synthesis tool'),
    (r"\bAnthropic's Claude\b",        'our AI synthesis tool'),
    (r'\bClaude Opus 4\.7-written\b',  'AI-written'),
    (r'\bClaude Opus 4\.7\b',          'our AI synthesis tool'),
    (r'\bClaude-written\b',            'AI-written'),
    (r'\bClaude synthesis\b',          'AI synthesis'),
    (r'\bClaude pipeline\b',           'AI pipeline'),
    (r'\bClaude prompt\b',             'AI prompt'),
    (r'\bClaude request\b',            'AI request'),
    (r'\bClaude pass\b',               'AI pass'),
    (r'\bClaude call\b',               'AI call'),
    # Standalone "Claude" and "Anthropic" last
    (r'\bClaude\b',                    'our AI synthesis tool'),
    (r"\bAnthropic's\b",               "the AI vendor's"),
    (r'\bAnthropic\b',                 'our AI vendor'),
]

# Terms.html has a specific legal clause that must NOT be touched.
TERMS_PROTECTED_LINE_SUBSTRINGS = (
    'Reverse-engineer',
)


def process(path):
    rel = os.path.relpath(path, ROOT)
    fn = os.path.basename(path)
    if fn in EXCLUDE_FILES:
        return None
    with open(path, 'r', encoding='utf-8') as f:
        original = f.read()

    new = original
    if fn == 'terms.html':
        # Line-by-line so we can protect the legal clause
        out_lines = []
        for line in new.splitlines(keepends=True):
            if any(s in line for s in TERMS_PROTECTED_LINE_SUBSTRINGS):
                out_lines.append(line)
                continue
            for pat, rep in SUBS:
                line = re.sub(pat, rep, line)
            out_lines.append(line)
        new = ''.join(out_lines)
    else:
        for pat, rep in SUBS:
            new = re.sub(pat, rep, new)

    if new == original:
        return None
    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write(new)
    return rel


def main():
    changed = []
    for d, ds, fs in os.walk(ROOT):
        ds[:] = [x for x in ds if x not in EXCLUDE_DIRS]
        for fn in fs:
            if not (fn.endswith('.html') or fn.endswith('.js')):
                continue
            full = os.path.join(d, fn)
            r = process(full)
            if r:
                changed.append(r)
    print(f'Files changed: {len(changed)}')
    for c in changed:
        print(' ', c)


if __name__ == '__main__':
    main()
