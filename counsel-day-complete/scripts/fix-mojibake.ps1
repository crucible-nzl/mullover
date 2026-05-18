# scripts/fix-mojibake.ps1
#
# Reverses UTF-8 to Windows-1252 round-trip corruption introduced by
# fix-font-cls.ps1 on 18 May 2026. PowerShell 5.1 Get-Content -Raw reads
# BOM-less UTF-8 as Windows-1252, Set-Content -Encoding utf8 writes it
# back as UTF-8-with-BOM, and every multi-byte UTF-8 character ends up
# corrupted into its Windows-1252 byte sequence rendered as UTF-8.
#
# Recovery: read corrupted file as UTF-8, strip BOM, encode the text
# back to Windows-1252 (recovering original bytes), decode those bytes
# as UTF-8 (recovering original characters), write back UTF-8 NO BOM.
#
# Safe to re-run · idempotent because after one fix the mojibake
# markers are gone.

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$win1252 = [System.Text.Encoding]::GetEncoding(1252)
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)

# Mojibake markers using Unicode escapes to keep this script ASCII-safe.
# Three high-frequency telltales: U+00C2 (LATIN CAPITAL A WITH CIRCUMFLEX,
# "A-hat") and U+00C3 (LATIN CAPITAL A WITH TILDE) and U+00E2 (LATIN SMALL
# A WITH CIRCUMFLEX). These appear when UTF-8 bytes 0xC2, 0xC3, 0xE2 are
# interpreted as Windows-1252 and round-tripped. Plain UTF-8 text almost
# never contains these characters as legitimate content.
$marker1 = [char]0x00C2
$marker2 = [char]0x00C3
$marker3 = [char]0x00E2
$mojibakeRegex = "[$marker1$marker2$marker3]"

$files = Get-ChildItem -Path $root -Recurse -Include *.html | Where-Object {
  $_.FullName -notlike '*\admin*' -and $_.FullName -notlike '*og-image-generator*'
}

$fixed = 0
$skipped = 0
foreach ($f in $files) {
  $bytes = [System.IO.File]::ReadAllBytes($f.FullName)

  $hasBom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
  if ($hasBom) {
    $text = [System.Text.Encoding]::UTF8.GetString($bytes, 3, $bytes.Length - 3)
  } else {
    $text = [System.Text.Encoding]::UTF8.GetString($bytes)
  }

  if ($text -notmatch $mojibakeRegex) {
    $skipped++
    continue
  }

  try {
    $recoveredBytes = $win1252.GetBytes($text)
    $recoveredText  = [System.Text.Encoding]::UTF8.GetString($recoveredBytes)
  } catch {
    Write-Warning "  [skip] $($f.Name) cannot round-trip"
    $skipped++
    continue
  }

  if ($recoveredText -eq $text) {
    $skipped++
    continue
  }

  [System.IO.File]::WriteAllText($f.FullName, $recoveredText, $utf8NoBom)
  $fixed++
  Write-Host "  [fixed] $($f.Name)"
}

Write-Host ""
Write-Host "fix-mojibake: fixed $fixed file(s), skipped $skipped"
