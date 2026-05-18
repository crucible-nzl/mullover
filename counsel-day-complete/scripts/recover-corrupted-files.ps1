#requires -Version 5.1
<#
.SYNOPSIS
  Recover files that were corrupted by a .NET regex substitution bug
  in update-pricing-and-nav.ps1. The bug used `$_` (entire-input
  backreference) which inserted the whole file body at every match of
  $49 / $99 / "49" / "99", causing multiplicative file growth.

  Recovery: find the LAST occurrence of "<!DOCTYPE html>" in the file
  and take everything from there to EOF. Because all corrections
  (pricing residue fix, FILE 0048-A removal) used global string
  replacement after the corruption, the deepest inner copy is fully
  patched. Trimming to the last copy yields a clean file with all
  intended edits applied.

  Idempotent: a file with only one DOCTYPE is left untouched.
#>

[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'

$Targets = @(
  'index.html',
  'faq.html',
  'terms.html',
  'billing.html',
  'account.html',
  'compose.html',
  'help.html'
)

$marker = '<!DOCTYPE html>'

function Count-Marker([string]$Text, [string]$Marker) {
  $count = 0
  $idx = 0
  while (($idx = $Text.IndexOf($Marker, $idx)) -ne -1) {
    $count++
    $idx += $Marker.Length
  }
  return $count
}

foreach ($name in $Targets) {
  $path = Join-Path $Root $name
  if (-not (Test-Path $path)) { Write-Warning "$name not found"; continue }
  $content = [System.IO.File]::ReadAllText($path, [System.Text.UTF8Encoding]::new($false))
  $originalLen = $content.Length
  $originalCount = Count-Marker -Text $content -Marker $marker
  $originalCloseCount = Count-Marker -Text $content -Marker '</html>'

  # Iteratively peel away nested DOCTYPE copies (head-side corruption).
  $iter = 0
  while ((Count-Marker -Text $content -Marker $marker) -gt 1) {
    $lastIdx = $content.LastIndexOf($marker)
    if ($lastIdx -le 0) { break }
    $content = $content.Substring($lastIdx)
    $iter++
    if ($iter -gt 100) { Write-Warning "iteration cap hit on $name"; break }
  }

  # Trim trailing duplicate page-ends: keep only up to and including the FIRST </html>.
  $firstClose = $content.IndexOf('</html>')
  if ($firstClose -ge 0) {
    $endPos = $firstClose + '</html>'.Length
    if ($endPos -lt $content.Length) {
      $content = $content.Substring(0, $endPos) + "`r`n"
    }
  }

  if ($content.TrimEnd() -notmatch '</html>$') {
    Write-Warning "final clean copy of $name does not end with </html>; aborting"
    continue
  }

  $finalCount = Count-Marker -Text $content -Marker $marker
  $finalCloseCount = Count-Marker -Text $content -Marker '</html>'

  if ($originalCount -eq 1 -and $originalCloseCount -eq 1) {
    Write-Host ("  clean   {0}  ({1} bytes, no recovery needed)" -f $name, $originalLen)
    continue
  }

  if ($PSCmdlet.ShouldProcess($name, ('recover ({0} -> {1} bytes; DOCTYPE {2}->{3}; </html> {4}->{5})' -f $originalLen, $content.Length, $originalCount, $finalCount, $originalCloseCount, $finalCloseCount))) {
    [System.IO.File]::WriteAllText($path, $content, [System.Text.UTF8Encoding]::new($false))
    Write-Host ("  recovered {0}  ({1} -> {2} bytes; DOCTYPE {3}->{4}; </html> {5}->{6})" -f $name, $originalLen, $content.Length, $originalCount, $finalCount, $originalCloseCount, $finalCloseCount)
  }
}
