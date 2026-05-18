#requires -Version 5.1
<#
.SYNOPSIS
  Three bulk text updates across the Counsel.day public surface:

  1. Pricing nav link · index.html#editions  ->  pricing.html
     (root files) and ../index.html#editions  ->  ../pricing.html
     (subdirectory files).

  2. Pricing values, raised uniformly:
       Solo per-decision   $4.99 USD  ->  $9.99 USD
       Couple per-decision $9.99 USD  ->  $12.99 USD
       Family per-decision $14.99 USD ->  $16.99 USD
       Solo Annual         $49 USD/yr ->  $79 USD/yr
       Couple Annual       $99 USD/yr ->  $109 USD/yr
       Family Annual       $149 USD/yr (unchanged)

     Collision-safe: Solo and Couple new prices collide with old Solo
     and old Couple prices, so we use a two-pass swap via placeholder
     tokens.

  3. Drop the specimen file reference "FILE · № 0048-A" from any page
     that hard-coded it (the running-decision mock surfaces).
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

# Placeholder tokens (unicode-safe, ASCII, very unlikely to appear naturally)
$P_SOLO   = '__CD_PRICE_SOLO_NEW__'
$P_COUPLE = '__CD_PRICE_COUPLE_NEW__'
$P_FAMILY = '__CD_PRICE_FAMILY_NEW__'
$P_SOLOA  = '__CD_PRICE_SOLOA_NEW__'
$P_COUPA  = '__CD_PRICE_COUPA_NEW__'

foreach ($file in $HtmlFiles) {
  $relPath = $file.FullName.Substring($Root.Length).TrimStart('\','/')
  $content = Get-Content -Path $file.FullName -Raw -Encoding UTF8
  if ($null -eq $content) { continue }
  $original = $content
  $changes = @()

  # 1. Pricing nav link
  $hadIndexEditions = $content.Contains('index.html#editions')
  if ($hadIndexEditions) {
    $content = $content.Replace('href="../index.html#editions"', 'href="../pricing.html"')
    $content = $content.Replace('href="index.html#editions"', 'href="pricing.html"')
    if ($content -ne $original) { $changes += 'nav-pricing' }
  }

  # 2. Pricing values (per-decision and annual)
  $beforePricing = $content

  # Pass A: replace OLD with placeholders so swaps do not cascade.
  $content = $content.Replace('$4.99 USD',    "$P_SOLO USD")
  $content = $content.Replace('$4.99',        "$P_SOLO")
  $content = $content.Replace('"4.99"',       "`"$P_SOLO`"")

  $content = $content.Replace('$9.99 USD',    "$P_COUPLE USD")
  $content = $content.Replace('$9.99',        "$P_COUPLE")
  $content = $content.Replace('"9.99"',       "`"$P_COUPLE`"")

  $content = $content.Replace('$14.99 USD',   "$P_FAMILY USD")
  $content = $content.Replace('$14.99',       "$P_FAMILY")
  $content = $content.Replace('"14.99"',      "`"$P_FAMILY`"")

  # Solo Annual $49 (require not preceded by a digit/dot to avoid mis-matching $149/$249)
  $content = [regex]::Replace($content, '(?<![\d\.])\$49\b',  "`$$P_SOLOA")
  $content = [regex]::Replace($content, '"49"',               "`"$P_SOLOA`"")

  # Couple Annual $99 (require not preceded by a digit/dot)
  $content = [regex]::Replace($content, '(?<![\d\.])\$99\b',  "`$$P_COUPA")
  $content = [regex]::Replace($content, '"99"',               "`"$P_COUPA`"")

  # Pass B: substitute placeholders with NEW values.
  $content = $content.Replace($P_SOLO,    '9.99')
  $content = $content.Replace($P_COUPLE,  '12.99')
  $content = $content.Replace($P_FAMILY,  '16.99')
  $content = $content.Replace($P_SOLOA,   '79')
  $content = $content.Replace($P_COUPA,   '109')

  if ($content -ne $beforePricing) { $changes += 'pricing' }

  # 3. Drop FILE · № 0048-A reference (kept as a more generic mock label).
  if ($content.Contains('FILE · № 0048-A · TONIGHT''S VOTE')) {
    $content = $content.Replace('FILE · № 0048-A · TONIGHT''S VOTE', 'TONIGHT''S VOTE')
    $changes += 'file-ref-trim'
  }
  if ($content.Contains('FILE · № 0048-A · DAY 14 OF 30')) {
    $content = $content.Replace('FILE · № 0048-A · DAY 14 OF 30', 'DAY 14 OF 30')
    $changes += 'file-ref-trim'
  }
  if ($content.Contains('FILE · № 0048-A')) {
    # Catch-all for any remaining standalone occurrences
    $content = $content.Replace('FILE · № 0048-A', 'DECISION')
    $changes += 'file-ref-trim'
  }
  if ($content.Contains('№ 0048-A')) {
    $content = $content.Replace('№ 0048-A', '')
    $changes += 'file-ref-trim'
  }

  if ($content -ne $original) {
    if ($PSCmdlet.ShouldProcess($relPath, ('rewrite [' + ($changes -join ',') + ']'))) {
      $useCrlf = ($original -match "`r`n")
      if ($useCrlf -and ($content -notmatch "`r`n")) {
        $content = $content -replace "(?<!`r)`n", "`r`n"
      }
      [System.IO.File]::WriteAllText($file.FullName, $content, [System.Text.UTF8Encoding]::new($false))
      $ChangedCount++
      Write-Host ("  rewrote {0} [{1}]" -f $relPath, ($changes -join ','))
    }
  }
}

Write-Host ''
Write-Host ('Changed: {0}' -f $ChangedCount)
