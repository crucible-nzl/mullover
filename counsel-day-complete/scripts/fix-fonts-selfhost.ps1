# scripts/fix-fonts-selfhost.ps1
#
# One-shot · drops the three-line Google Fonts block (preconnect to
# googleapis + preconnect to gstatic + render-blocking <link>) and
# replaces it with one <link rel="stylesheet" href="/fonts/fonts.css">.
# Same UTF-8 safety dance as fix-mojibake.ps1 (read+write via
# [System.IO.File] with explicit no-BOM encoding).

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)

$preconnect1 = '<link rel="preconnect" href="https://fonts.googleapis.com">'
$preconnect2 = '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
$googleLink  = '<link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400;1,6..72,500&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,500;1,8..60,400&family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">'

$blockPattern = [regex]::Escape($preconnect1) + "\s*`n\s*" + [regex]::Escape($preconnect2) + "\s*`n\s*" + [regex]::Escape($googleLink)
$replacement  = '<link rel="stylesheet" href="/fonts/fonts.css">'

$files = Get-ChildItem -Path $root -Recurse -Include *.html | Where-Object {
  $_.FullName -notlike '*\admin*' -and $_.FullName -notlike '*og-image-generator*'
}

$changed = 0
foreach ($f in $files) {
  $bytes = [System.IO.File]::ReadAllBytes($f.FullName)
  $hasBom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
  $text = if ($hasBom) {
    [System.Text.Encoding]::UTF8.GetString($bytes, 3, $bytes.Length - 3)
  } else {
    [System.Text.Encoding]::UTF8.GetString($bytes)
  }

  if ($text -notlike '*fonts.googleapis.com*') { continue }

  $new = [regex]::Replace($text, $blockPattern, $replacement)

  if ($new -ne $text) {
    [System.IO.File]::WriteAllText($f.FullName, $new, $utf8NoBom)
    $changed++
    Write-Host "  [fixed] $($f.Name)"
  }
}

Write-Host ""
Write-Host "fix-fonts-selfhost: changed $changed file(s)"
