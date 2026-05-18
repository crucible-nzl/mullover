#requires -Version 5.1
<#
.SYNOPSIS
  Two cleanups across the Counsel.day public surface:

  1. Strip "FILE · NN ·" and "FILE NN.NN" prefixes from eyebrow labels,
     left-rail stage markers, and h2 component headings. Leaves the
     semantic text intact (e.g. "FILE · 04 · WHEN TO USE BOTH" becomes
     "WHEN TO USE BOTH").

  2. Trim two nav links ("The evening vote" and "About") that overflow
     the primary nav to a second line on narrow viewports. Both
     destinations remain available via the colophon footer.

  Idempotent: applying twice is a no-op.

  All replacements use plain string ops or .NET regex with empty
  replacements, so no $_ substitution-bug.
#>

[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'

$SkipNames = @('admin.html', 'og-image-generator.html')

$HtmlFiles = Get-ChildItem -Path $Root -Filter *.html -Recurse -File |
  Where-Object { $SkipNames -notcontains $_.Name } |
  Where-Object { $_.FullName -notmatch '\\scripts\\' }

$ChangedCount = 0

# -- FILE-prefix strip patterns -----------------------------------
# Order matters: most specific first.
# A1. "FILE · NN · "  (mid-dot, leading digit, trailing mid-dot)
# A2. "FILE NN · "    (no mid-dot before digit)
# A3. "FILE · NN"      (no trailing mid-dot, end of line)
# A4. "FILE NN.NN"     (bare left-rail)
# B1. "FILE · WORD · " (mid-dot, leading uppercase WORD, trailing mid-dot)
# B2. "FILE · WORD"     (no trailing mid-dot)
# B3. "FILE · "          (just FILE · prefix alone)

$filePatterns = @(
  'FILE\s*[·]\s*\d+(?:\.\d+)?\s*[·]\s*',
  'FILE\s+\d+(?:\.\d+)?\s*[·]\s*',
  'FILE\s*[·]\s*\d+(?:\.\d+)?\b',
  'FILE\s+\d+(?:\.\d+)?\b',
  'FILE\s*[·]\s*[A-Z]+(?:[\s/-][A-Z]+)*\s*[·]\s*',
  'FILE\s*[·]\s*[A-Z]+(?:[\s/-][A-Z]+)*\b'
)

# -- Nav-link strip targets ---------------------------------------
# We rely on the 6-space indentation that is used inside .nav-links
# but NOT inside .colophon-col (which uses 8 spaces).
$navLinks = @(
  '      <a href="vote.html">The evening vote</a>',
  '      <a href="about.html">About</a>',
  '      <a href="../vote.html">The evening vote</a>',
  '      <a href="../about.html">About</a>'
)

foreach ($file in $HtmlFiles) {
  $relPath = $file.FullName.Substring($Root.Length).TrimStart('\','/')
  $content = [System.IO.File]::ReadAllText($file.FullName, [System.Text.UTF8Encoding]::new($false))
  $original = $content
  $changes = @()

  # 1. Strip FILE-prefixes (apply each pattern in order).
  $beforeFile = $content
  foreach ($pat in $filePatterns) {
    $content = [regex]::Replace($content, $pat, '')
  }
  # Tidy up two consecutive mid-dots left behind (if any).
  $midDot = [string][char]0x00B7
  $content = [regex]::Replace($content, "$midDot\s+$midDot", $midDot)
  # Tidy up empty stage-file divs left behind.
  $content = [regex]::Replace($content, '<div class="stage-file">\s*</div>\s*\r?\n', '')
  # Tidy up h2 component headings that became empty (components.html).
  $content = [regex]::Replace($content, '<h2>\s*</h2>\s*\r?\n', '')
  # Tidy up h2 component headings that lost the FILE prefix and just say "· component".
  $content = [regex]::Replace($content, '<h2>\s*[·]\s*component\s*</h2>', '<h2>Component</h2>')
  $content = [regex]::Replace($content, '<h2>\s*[·]\s*component\s*[·]\s*([^<]+)</h2>', '<h2>Component: $1</h2>')
  if ($content -ne $beforeFile) { $changes += 'file-prefix' }

  # 2. Trim nav-link lines.
  $beforeNav = $content
  foreach ($link in $navLinks) {
    $content = $content.Replace("$link`r`n", '')
    $content = $content.Replace("$link`n", '')
  }
  if ($content -ne $beforeNav) { $changes += 'nav-trim' }

  if ($content -ne $original) {
    if ($PSCmdlet.ShouldProcess($relPath, ('cleanup [' + ($changes -join ',') + ']'))) {
      [System.IO.File]::WriteAllText($file.FullName, $content, [System.Text.UTF8Encoding]::new($false))
      $ChangedCount++
      Write-Host ("  cleaned {0} [{1}]" -f $relPath, ($changes -join ','))
    }
  }
}

Write-Host ''
Write-Host ('Cleaned: {0}' -f $ChangedCount)
