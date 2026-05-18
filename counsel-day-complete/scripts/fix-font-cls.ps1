# scripts/fix-font-cls.ps1
#
# One-shot script: drops the async <link rel="preload" as="style"> +
# <link rel="stylesheet" media="print" onload> + <noscript> trio used to
# defer the Google Fonts CSS, and replaces it with a single render-blocking
# <link rel="stylesheet"> that preserves the preconnect already in place.
#
# Reason: the async trick FOUTs hard on serif headlines and pushes our
# Cumulative Layout Shift score above Google's 0.10 threshold (we were at
# 0.38 per Lighthouse). With preconnect already established to fonts.gstatic
# and fonts.googleapis, the synchronous load only adds ~50-100ms before
# first paint and totally eliminates the layout shift.
#
# Safe to re-run: idempotent · only acts on lines matching the exact 3-line
# block. Files without the block are skipped.

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$fontHref = 'https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400;1,6..72,500&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,500;1,8..60,400&family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap'

$preloadLine = '<link rel="preload" href="' + $fontHref + '" as="style">'
$asyncLine   = '<link href="' + $fontHref + '" rel="stylesheet" media="print" onload="this.media=' + "'all'" + '">'
$noscriptLine = '<noscript><link href="' + $fontHref + '" rel="stylesheet"></noscript>'
$replacement = '<link href="' + $fontHref + '" rel="stylesheet">'

$files = Get-ChildItem -Path $root -Recurse -Include *.html | Where-Object {
  $_.FullName -notlike '*\admin*' -and $_.FullName -notlike '*og-image-generator*' -and $_.FullName -notlike '*\engineering\*' -and $_.Name -ne 'homepage.html' -and $_.Name -ne 'components.html'
}

$changed = 0
foreach ($f in $files) {
  # IMPORTANT · use UTF-8 explicitly. PowerShell 5.1's Get-Content -Raw
  # falls back to Windows-1252 for BOM-less files and corrupts every
  # multi-byte UTF-8 character on round-trip. See fix-mojibake.ps1.
  $bytes = [System.IO.File]::ReadAllBytes($f.FullName)
  $hasBom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
  $text = if ($hasBom) {
    [System.Text.Encoding]::UTF8.GetString($bytes, 3, $bytes.Length - 3)
  } else {
    [System.Text.Encoding]::UTF8.GetString($bytes)
  }
  if ($text -notlike "*media=`"print`" onload*") { continue }

  $blockPattern = [regex]::Escape($preloadLine) + "\s*`n\s*" + [regex]::Escape($asyncLine) + "\s*`n\s*" + [regex]::Escape($noscriptLine)
  $new = [regex]::Replace($text, $blockPattern, $replacement)

  if ($new -ne $text) {
    # IMPORTANT · use [System.IO.File] directly, NOT Set-Content.
    # PowerShell 5.1's Set-Content -Encoding utf8 writes a BOM, and
    # combined with Get-Content -Raw's auto-detection, files without
    # an existing BOM get round-tripped through Windows-1252 and
    # corrupted. WriteAllText with UTF8Encoding($false) writes UTF-8
    # without BOM, matching the rest of the site.
    $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText($f.FullName, $new, $utf8NoBom)
    $changed++
    Write-Host "  [fixed] $($f.Name)"
  }
}

Write-Host ""
Write-Host "fix-font-cls: changed $changed file(s)"
