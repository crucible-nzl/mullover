# scripts/fix-remove-section-symbol.ps1
#
# One-shot · removes every U+00A7 (§) from the static site, per James's
# 2026-05-18 instruction. Three patterns to handle:
#   1. "§ NN · " section-number prefix · drop entirely
#   2. "§ Some Words"                  · drop the "§ " prefix, keep words
#   3. bare "§"                        · drop
#
# Same UTF-8 safety pattern as fix-mojibake.ps1 (read+write via
# [System.IO.File] with explicit UTF-8 no-BOM).

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$section  = [char]0x00A7   # §
$middot   = [char]0x00B7   # ·  (kept · only the § is removed)

$files = Get-ChildItem -Path $root -Recurse -Include *.html, *.css, *.js | Where-Object {
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

  if (-not $text.Contains($section)) { continue }

  # Pattern 1 · "§ 03 · " or "§ 03 · " · drop the whole prefix incl. trailing middle-dot + spaces
  $new = [regex]::Replace($text, "$section\s*\d+\s*$middot\s*", '')
  # Pattern 2 · "§ Word" · drop just the "§ " prefix
  $new = [regex]::Replace($new, "$section\s+", '')
  # Pattern 3 · bare "§" with no following text · just delete
  $new = $new -replace $section, ''

  if ($new -ne $text) {
    [System.IO.File]::WriteAllText($f.FullName, $new, $utf8NoBom)
    $changed++
    Write-Host "  [fixed] $($f.Name)"
  }
}

Write-Host ""
Write-Host "fix-remove-section-symbol: changed $changed file(s)"
