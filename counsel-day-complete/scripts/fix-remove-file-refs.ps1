# scripts/fix-remove-file-refs.ps1
#
# One-shot · removes every "File reference" + "№ XXX" placeholder from
# the static site, per James's repeated request 2026-05-18. Patterns:
#   1. <span class="file-ref">FILE · № PENDING</span>   · whole span dropped
#   2. <span class="file-ref seal">№ 0047</span>        · whole span dropped
#   3. "File reference" <span...>№ XXX</span>            · whole phrase dropped
#   4. "№ 01 · Trajectory"                                · drop "№ 01 · " prefix
#   5. bare "№"                                          · drop
#
# Same UTF-8 safety pattern as fix-mojibake.ps1.

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$numero = [char]0x2116    # №

$files = Get-ChildItem -Path $root -Recurse -Include *.html | Where-Object {
  $_.FullName -notlike '*\admin*' -and $_.FullName -notlike '*og-image-generator*' -and $_.Name -ne 'components.html'
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

  if (-not $text.Contains($numero) -and -not $text.Contains('File reference') -and -not $text.Contains('file-ref')) {
    continue
  }

  $new = $text

  # Pattern A · drop ENTIRE spans whose only purpose is a "№ XXX" file ref label
  # Example: <span class="file-ref seal">№ FAM-0117</span>
  $new = [regex]::Replace($new, '\s*<span[^>]*class="[^"]*file-ref[^"]*"[^>]*>[^<]*</span>\s*', '')

  # Pattern B · drop the literal phrase "File reference" followed by a numero span
  # Example: <strong>File reference</strong> <span class="ref" id="next-ref">№ 0049-A</span> ·
  $new = [regex]::Replace($new, '<strong>File reference</strong>\s*<span[^>]*>[^<]*</span>\s*[·\-]?\s*', '')

  # Pattern C · drop standalone "DECISION № XXXX ·" labels inside text
  $new = [regex]::Replace($new, "DECISION\s+$numero\s*[A-Z0-9-]+\s*·?\s*", '')

  # Pattern D · drop "№ 01 · " section-number prefix (homepage USP cards etc.)
  $new = [regex]::Replace($new, "$numero\s*\d+\s*·\s*", '')

  # Pattern E · drop bare "№ XXX" anywhere remaining
  $new = [regex]::Replace($new, "$numero\s*[A-Z0-9-]+", '')

  # Pattern F · drop bare "№" left over
  $new = $new -replace $numero, ''

  if ($new -ne $text) {
    [System.IO.File]::WriteAllText($f.FullName, $new, $utf8NoBom)
    $changed++
    Write-Host "  [fixed] $($f.Name)"
  }
}

Write-Host ""
Write-Host "fix-remove-file-refs: changed $changed file(s)"
