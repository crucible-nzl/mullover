#requires -Version 5.1
<#
.SYNOPSIS
  Post-migration cleanups for the Iteration 8 migration.

  1. Fix nav-brand href in subdirectory HTML files (index.html -> ../index.html).
  2. Replace inline 'Public Sans', system-ui, ... references with var(--font-ui).
  3. Update inline meta tags / hard-coded font references to i8 tokens.
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

  $isSub = ($file.DirectoryName -ne $Root)

  # 1. Subdirectory nav-brand href fix
  if ($isSub) {
    $navBrandWrong = '<a class="nav-brand" href="index.html" aria-label="Counsel.day home">Counsel<span class="tld">.day</span></a>'
    $navBrandRight = '<a class="nav-brand" href="../index.html" aria-label="Counsel.day home">Counsel<span class="tld">.day</span></a>'
    if ($content.Contains($navBrandWrong)) {
      $content = $content.Replace($navBrandWrong, $navBrandRight)
      $changes += 'nav-brand-href'
    }
  }

  # 2. Replace legacy inline Public Sans font references with var(--font-ui)
  $publicSansPattern = "'Public Sans', system-ui, -apple-system, sans-serif"
  if ($content.Contains($publicSansPattern)) {
    $content = $content.Replace($publicSansPattern, 'var(--font-ui)')
    $changes += 'inline-fonts'
  }
  # Variant: with double quotes
  $publicSansAlt = '"Public Sans", system-ui, -apple-system, sans-serif'
  if ($content.Contains($publicSansAlt)) {
    $content = $content.Replace($publicSansAlt, 'var(--font-ui)')
    $changes += 'inline-fonts'
  }
  # Variant: Public Sans alone (e.g., short forms)
  if ($content -match "font-family:\s*'Public Sans'") {
    $content = [regex]::Replace($content, "font-family:\s*'Public Sans'(?:,[^;]+)?", 'font-family: var(--font-ui)')
    $changes += 'inline-fonts'
  }

  # 3. Replace legacy Manrope inline references
  if ($content -match "font-family:\s*'Manrope'") {
    $content = [regex]::Replace($content, "font-family:\s*'Manrope'(?:,[^;]+)?", 'font-family: var(--font-ui)')
    $changes += 'inline-fonts'
  }

  # 4. Replace IBM Plex Mono inline (chrome font) with var(--font-mono)
  $plexPattern = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace"
  if ($content.Contains($plexPattern)) {
    $content = $content.Replace($plexPattern, 'var(--font-mono)')
    $changes += 'inline-fonts'
  }
  if ($content -match "font-family:\s*'IBM Plex Mono'") {
    $content = [regex]::Replace($content, "font-family:\s*'IBM Plex Mono'(?:,[^;]+)?", 'font-family: var(--font-mono)')
    $changes += 'inline-fonts'
  }

  if ($content -ne $original) {
    if ($PSCmdlet.ShouldProcess($relPath, ('post-migrate [' + ($changes -join ',') + ']'))) {
      $useCrlf = ($original -match "`r`n")
      if ($useCrlf -and ($content -notmatch "`r`n")) {
        $content = $content -replace "(?<!`r)`n", "`r`n"
      }
      [System.IO.File]::WriteAllText($file.FullName, $content, [System.Text.UTF8Encoding]::new($false))
      $ChangedCount++
      Write-Host ("  patched {0} [{1}]" -f $relPath, ($changes -join ','))
    }
  }
}

Write-Host ''
Write-Host ('Patched: {0}' -f $ChangedCount)
