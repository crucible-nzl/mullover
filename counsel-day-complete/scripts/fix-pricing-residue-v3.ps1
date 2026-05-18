#requires -Version 5.1
<#
.SYNOPSIS
  Restore the lost '$' prefix on the new pricing values (14 / 25 / 49)
  introduced by sweep-pricing-v3.ps1. Idempotent.
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

# Pricing strings that should be preceded by '$' to read as currency.
# We add the dollar only where the number is followed by ' USD' or in
# specific HTML contexts to avoid touching arbitrary numbers.
$repairs = @(
  @{ Find = ' 14 USD';   Repl = ' $14 USD' },
  @{ Find = ' 25 USD';   Repl = ' $25 USD' },
  @{ Find = ' 49 USD';   Repl = ' $49 USD' },
  @{ Find = ' 99 USD';   Repl = ' $99 USD' },
  @{ Find = ' 14 USD;';  Repl = ' $14 USD;' },
  @{ Find = ' 25 USD;';  Repl = ' $25 USD;' },
  @{ Find = ' 49 USD;';  Repl = ' $49 USD;' },
  @{ Find = '>14 USD';   Repl = '>$14 USD' },
  @{ Find = '>25 USD';   Repl = '>$25 USD' },
  @{ Find = '>49 USD';   Repl = '>$49 USD' },
  @{ Find = '>99 USD';   Repl = '>$99 USD' },
  @{ Find = '(14 USD';   Repl = '($14 USD' },
  @{ Find = '(25 USD';   Repl = '($25 USD' },
  @{ Find = '(49 USD';   Repl = '($49 USD' },
  @{ Find = '(99 USD';   Repl = '($99 USD' }
)

$ChangedCount = 0
foreach ($file in $HtmlFiles) {
  $rel = $file.FullName.Substring($Root.Length).TrimStart('\','/')
  $content = [System.IO.File]::ReadAllText($file.FullName, [System.Text.UTF8Encoding]::new($false))
  $original = $content
  foreach ($rep in $repairs) {
    $content = $content.Replace($rep.Find, $rep.Repl)
  }

  # Guard against double-dollars from prior runs.
  $content = $content.Replace('$$14', '$14')
  $content = $content.Replace('$$25', '$25')
  $content = $content.Replace('$$49', '$49')
  $content = $content.Replace('$$99', '$99')

  if ($content -ne $original) {
    if ($PSCmdlet.ShouldProcess($rel, 'restore $ prefix on pricing')) {
      [System.IO.File]::WriteAllText($file.FullName, $content, [System.Text.UTF8Encoding]::new($false))
      $ChangedCount++
      Write-Host ('  fixed {0}' -f $rel)
    }
  }
}

Write-Host ''
Write-Host ('Fixed: {0}' -f $ChangedCount)
