#requires -Version 5.1
<#
.SYNOPSIS
  Pricing sweep v3 (17 May 2026) · moves from $9.99/$12.99/$16.99 per-decision
  and Solo/Couple/Family annual SKUs to:
    - Solo per-decision   $14 USD
    - Couple per-decision $25 USD
    - Family per-decision $49 USD
    - Consumer Annual     $99 USD/year (single all-access SKU)
    - Practitioner Annual $399 USD/year (practitioner pages only; not handled here)

  Strategy: straight string .Replace() only. No regex substitution patterns,
  no $_ backreferences. Order matters to avoid collisions:
    1. Per-decision string forms (most specific first)
    2. JSON-LD numeric prices
    3. Annual SKU mentions are NOT handled by this script · they need
       structural rewrites (pricing.html, compose.html, terms.html) done
       by hand.
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

# Per-decision price mappings (HTML body forms).
# Use placeholders to avoid collisions: $14 (new Solo) does not collide with old prices,
# but to be safe we use a two-pass swap.
$P_SOLO   = '__CD_NEW_SOLO__'
$P_COUPLE = '__CD_NEW_COUPLE__'
$P_FAMILY = '__CD_NEW_FAMILY__'

$ChangedCount = 0

foreach ($file in $HtmlFiles) {
  $rel = $file.FullName.Substring($Root.Length).TrimStart('\','/')
  $content = [System.IO.File]::ReadAllText($file.FullName, [System.Text.UTF8Encoding]::new($false))
  $original = $content
  $changes = @()

  # Pass A · OLD per-decision prices -> placeholders.
  $beforePerDecision = $content
  $content = $content.Replace('$9.99 USD',  ($P_SOLO + ' USD'))
  $content = $content.Replace('$12.99 USD', ($P_COUPLE + ' USD'))
  $content = $content.Replace('$16.99 USD', ($P_FAMILY + ' USD'))
  $content = $content.Replace('$9.99',  $P_SOLO)
  $content = $content.Replace('$12.99', $P_COUPLE)
  $content = $content.Replace('$16.99', $P_FAMILY)

  # JSON-LD numeric forms.
  $content = $content.Replace('"price": "9.99"',  ('"price": "' + $P_SOLO + '"'))
  $content = $content.Replace('"price": "12.99"', ('"price": "' + $P_COUPLE + '"'))
  $content = $content.Replace('"price": "16.99"', ('"price": "' + $P_FAMILY + '"'))
  $content = $content.Replace('"9.99"',  ('"' + $P_SOLO + '"'))
  $content = $content.Replace('"12.99"', ('"' + $P_COUPLE + '"'))
  $content = $content.Replace('"16.99"', ('"' + $P_FAMILY + '"'))

  # Pass B · placeholders -> NEW prices.
  $content = $content.Replace($P_SOLO,   '14')
  $content = $content.Replace($P_COUPLE, '25')
  $content = $content.Replace($P_FAMILY, '49')

  if ($content -ne $beforePerDecision) { $changes += 'per-decision' }

  if ($content -ne $original) {
    if ($PSCmdlet.ShouldProcess($rel, ('sweep [' + ($changes -join ',') + ']'))) {
      [System.IO.File]::WriteAllText($file.FullName, $content, [System.Text.UTF8Encoding]::new($false))
      $ChangedCount++
      Write-Host ('  swept {0} [{1}]' -f $rel, ($changes -join ','))
    }
  }
}

Write-Host ''
Write-Host ('Swept: {0} files' -f $ChangedCount)
Write-Host ''
Write-Host 'Pages that still need hand-editing (annual SKU restructure):'
Write-Host '  - pricing.html      (annual grid: 3 cells -> 1 Consumer Annual cell)'
Write-Host '  - compose.html      (tier picker: simplify to 4 per-decision + 1 annual)'
Write-Host '  - terms.html        (legal pricing list)'
Write-Host '  - faq.html          (FAQ answers + JSON-LD Offer list)'
Write-Host '  - billing.html      (sample ledger row)'
Write-Host '  - account.html      (subscription card)'
Write-Host '  - family.html       (Family-Annual mention)'
Write-Host '  - index.html        (editions section + colophon + JSON-LD Offer list)'
Write-Host '  - start.html        (pricing summary card)'
Write-Host '  - help.html         (example sentence)'
Write-Host '  - therapists.html   (ADD Practitioner Annual $399)'
Write-Host '  - counsellors.html  (ADD Practitioner Annual $399)'
