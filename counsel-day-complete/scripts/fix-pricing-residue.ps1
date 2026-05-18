#requires -Version 5.1
<#
.SYNOPSIS
  Corrective pass after update-pricing-and-nav.ps1 which dropped the
  leading '$' on substituted per-decision prices and missed the annual
  prices ($49 -> $79, $99 -> $109). Idempotent.
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

foreach ($file in $HtmlFiles) {
  $relPath = $file.FullName.Substring($Root.Length).TrimStart('\','/')
  $content = Get-Content -Path $file.FullName -Raw -Encoding UTF8
  if ($null -eq $content) { continue }
  $original = $content
  $changes = @()

  # 1. Re-prepend the lost '$' to per-decision prices.
  # Only target the explicit `<price> USD` patterns to avoid mismatching
  # arbitrary numeric strings elsewhere.
  $beforeDollars = $content
  $content = $content.Replace(' 9.99 USD',  ' $9.99 USD')
  $content = $content.Replace(' 12.99 USD', ' $12.99 USD')
  $content = $content.Replace(' 16.99 USD', ' $16.99 USD')
  # Word-boundary openings (after `>`, `(`, `"`, comma)
  $content = $content.Replace('>9.99 USD',  '>$9.99 USD')
  $content = $content.Replace('>12.99 USD', '>$12.99 USD')
  $content = $content.Replace('>16.99 USD', '>$16.99 USD')
  $content = $content.Replace('(9.99 USD',  '($9.99 USD')
  $content = $content.Replace('(12.99 USD', '($12.99 USD')
  $content = $content.Replace('(16.99 USD', '($16.99 USD')
  if ($content -ne $beforeDollars) { $changes += 'dollar-restore' }

  # 2. Annual prices: $49 -> $79 (Solo Annual), $99 -> $109 (Couple Annual).
  $beforeAnnual = $content
  $content = $content.Replace('$49 USD',       '$79 USD')
  $content = $content.Replace('Solo Annual $49',  'Solo Annual $79')
  $content = $content.Replace('"price": "49"',  '"price": "79"')
  $content = $content.Replace('"price":"49"',   '"price":"79"')

  $content = $content.Replace('$99 USD',         '$109 USD')
  $content = $content.Replace('Couple Annual $99', 'Couple Annual $109')
  $content = $content.Replace('"price": "99"',  '"price": "109"')
  $content = $content.Replace('"price":"99"',   '"price":"109"')
  if ($content -ne $beforeAnnual) { $changes += 'annual-prices' }

  # 3. Guard against the terms.html liability cap '$100.00 USD' (do not bump).
  # That value should stay $100 (literal hundred dollars).
  # No action needed; we did not touch it.

  if ($content -ne $original) {
    if ($PSCmdlet.ShouldProcess($relPath, ('fix [' + ($changes -join ',') + ']'))) {
      $useCrlf = ($original -match "`r`n")
      if ($useCrlf -and ($content -notmatch "`r`n")) {
        $content = $content -replace "(?<!`r)`n", "`r`n"
      }
      [System.IO.File]::WriteAllText($file.FullName, $content, [System.Text.UTF8Encoding]::new($false))
      $ChangedCount++
      Write-Host ("  fixed {0} [{1}]" -f $relPath, ($changes -join ','))
    }
  }
}

Write-Host ''
Write-Host ('Fixed: {0}' -f $ChangedCount)
