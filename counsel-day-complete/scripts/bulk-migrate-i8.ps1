#requires -Version 5.1
<#
.SYNOPSIS
  Bulk-migrate Counsel.day HTML files from the legacy sealed-record
  iteration to Iteration 8 (white + wine).

.DESCRIPTION
  Mechanical changes applied to every in-scope .html file:
    1. Replace the legacy font URL (Public Sans + Newsreader + IBM Plex Mono)
       with the i8 font URL (Newsreader + Source Serif 4 + Geist + Geist Mono).
    2. Swap the stylesheet from styles.css to styles-i8.css.
    3. Strip the records-strip, masthead, and masthead-rule chrome blocks.
    4. Insert the .nav-brand element inside .nav-inner if missing.
    5. Update theme-color from #F2EBD9 to #ffffff.
    6. Inject the GA4 analytics script tag before </body> if missing.

  The admin carve-out (admin.html, og-image-generator.html) is skipped.
  Files already on Iteration 8 (using styles-i8.css) are only patched for
  GA4 if the snippet is missing.

.PARAMETER Root
  The counsel-day-complete directory to walk. Defaults to the script's
  parent directory.

.PARAMETER WhatIf
  Show what would change without writing.
#>

[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'

# ---- Constants ----
$LegacyFontUrl = 'https://fonts.googleapis.com/css2?family=Public+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Newsreader:opsz,wght@6..72,400;6..72,500&family=IBM+Plex+Mono:wght@400;500&display=swap'
$I8FontUrl     = 'https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400;1,6..72,500&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,500;1,8..60,400&family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap'

$NavBrandSnippet = '    <a class="nav-brand" href="index.html" aria-label="Counsel.day home">Counsel<span class="tld">.day</span></a>'

$Ga4SnippetRoot = @'

<script src="ga4.js" defer></script>
'@

$Ga4SnippetSub = @'

<script src="../ga4.js" defer></script>
'@

# Files to skip entirely (admin carve-out + the script directory)
$SkipNames = @(
  'admin.html',
  'og-image-generator.html'
)

# ---- Discovery ----
$HtmlFiles = Get-ChildItem -Path $Root -Filter *.html -Recurse -File |
  Where-Object { $SkipNames -notcontains $_.Name } |
  Where-Object { $_.FullName -notmatch '\\scripts\\' }

Write-Host ("Found {0} HTML files in scope" -f $HtmlFiles.Count)

# ---- Per-file migration ----
$ChangedCount = 0
$AlreadyI8Count = 0
$Skipped = @()

foreach ($file in $HtmlFiles) {
  $relPath = $file.FullName.Substring($Root.Length).TrimStart('\','/')
  $content = Get-Content -Path $file.FullName -Raw -Encoding UTF8
  if ($null -eq $content) { continue }

  $original = $content
  $changes = @()

  # 1. Font URL swap (covers preload, stylesheet, noscript)
  if ($content.Contains($LegacyFontUrl)) {
    $content = $content.Replace($LegacyFontUrl, $I8FontUrl)
    $changes += 'fonts'
  }

  # 2. Stylesheet swap (handles both root-level and ../-relative paths)
  $stylesPatternRoot = '<link\s+rel="stylesheet"\s+href="styles\.css">'
  if ($content -match $stylesPatternRoot) {
    $content = [regex]::Replace($content, $stylesPatternRoot, '<link rel="stylesheet" href="styles-i8.css">')
    $changes += 'stylesheet'
  }
  $stylesPatternRel = '<link\s+rel="stylesheet"\s+href="\.\./styles\.css">'
  if ($content -match $stylesPatternRel) {
    $content = [regex]::Replace($content, $stylesPatternRel, '<link rel="stylesheet" href="../styles-i8.css">')
    $changes += 'stylesheet'
  }

  # 3. Strip the records-strip line
  $recordsStripPattern = '(?m)^[\t ]*<div class="records-strip">[^<]*<span class="sep">[^<]*</span>[^<]*<span class="sep">[^<]*</span>[^<]*</div>\r?\n'
  if ($content -match $recordsStripPattern) {
    $content = [regex]::Replace($content, $recordsStripPattern, '')
    $changes += 'records-strip'
  }

  # 4. Strip the masthead block (multiline)
  $mastheadPattern = '(?s)<header class="masthead">.*?</header>\r?\n'
  if ($content -match $mastheadPattern) {
    $content = [regex]::Replace($content, $mastheadPattern, '')
    $changes += 'masthead'
  }

  # 5. Strip the masthead-rule
  $mastheadRulePattern = '(?m)^[\t ]*<hr class="masthead-rule">\r?\n'
  if ($content -match $mastheadRulePattern) {
    $content = [regex]::Replace($content, $mastheadRulePattern, '')
    $changes += 'masthead-rule'
  }

  # 6. Insert .nav-brand inside .nav-inner if missing
  if ($content -match '<nav class="nav-bar"' -and $content -notmatch '<a class="nav-brand"') {
    # Insert after <div class="nav-inner"> line
    $navInnerPattern = '(<nav class="nav-bar"[^>]*>\s*\r?\n\s*<div class="nav-inner">\s*\r?\n)'
    if ($content -match $navInnerPattern) {
      $content = [regex]::Replace($content, $navInnerPattern, "`$1$NavBrandSnippet`r`n", 1)
      $changes += 'nav-brand'
    }
  }

  # 7. theme-color update
  if ($content.Contains('<meta name="theme-color" content="#F2EBD9">')) {
    $content = $content.Replace(
      '<meta name="theme-color" content="#F2EBD9">',
      '<meta name="theme-color" content="#ffffff">'
    )
    $changes += 'theme-color'
  }
  # Old sealed-record theme-color may be wine; normalise to white.
  if ($content -match '<meta name="theme-color" content="#722F37">') {
    $content = [regex]::Replace(
      $content,
      '<meta name="theme-color" content="#722F37">',
      '<meta name="theme-color" content="#ffffff">'
    )
    $changes += 'theme-color'
  }

  # 8. Inject GA4 script before </body> if absent. Subdirectory files
  #    get the ../ga4.js path; root-level files get ga4.js.
  $isSub = ($file.DirectoryName -ne $Root)
  $hasGa4 = ($content -match '<script[^>]+src="(\.\./)?ga4\.js"')
  if (-not $hasGa4) {
    $snippet = if ($isSub) { $Ga4SnippetSub } else { $Ga4SnippetRoot }
    if ($content -match '(?i)</body>') {
      $content = [regex]::Replace($content, '(?i)(\r?\n?)</body>', ($snippet + '$1</body>'), 1)
      $changes += 'ga4'
    }
  }

  # ---- Persist ----
  if ($content -ne $original) {
    if ($PSCmdlet.ShouldProcess($relPath, ('rewrite [' + ($changes -join ',') + ']'))) {
      # Preserve original line endings: detect whether file had CRLF
      $useCrlf = ($original -match "`r`n")
      if ($useCrlf -and ($content -notmatch "`r`n")) {
        $content = $content -replace "(?<!`r)`n", "`r`n"
      }
      [System.IO.File]::WriteAllText($file.FullName, $content, [System.Text.UTF8Encoding]::new($false))
      $ChangedCount++
      Write-Host ("  rewrote {0} [{1}]" -f $relPath, ($changes -join ','))
    }
  } else {
    # No diff. Detect already-i8 vs untouched-by-legacy.
    if ($content -match 'styles-i8\.css' -and $content -match 'ga4\.js') {
      $AlreadyI8Count++
    } else {
      $Skipped += $relPath
    }
  }
}

Write-Host ''
Write-Host ('Changed:        {0}' -f $ChangedCount)
Write-Host ('Already on i8:  {0}' -f $AlreadyI8Count)
Write-Host ('No-op skipped:  {0}' -f $Skipped.Count)
if ($Skipped.Count -gt 0) {
  Write-Host ''
  Write-Host 'No-op files (verify manually):'
  $Skipped | ForEach-Object { Write-Host ('  - ' + $_) }
}
