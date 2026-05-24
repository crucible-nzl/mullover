# counsel-day-complete/scripts/brand-verify.ps1
#
# Counsel.day · Iteration 8 brand compliance lint
#
# Run before every commit; CI runs it too. Exits non-zero on the first
# failed check so a broken page never ships.
#
# Reference        · docs/BRAND.md
# Brand memory     · project_brand_white_wine.md (auto-memory)
# GA4 catalogue    · docs/GA4_FUNNEL.md
#
# Usage:
#   pwsh ./scripts/brand-verify.ps1                       (lint the whole public surface)
#   pwsh ./scripts/brand-verify.ps1 -Path path/to/file    (lint a single file before commit)
#   pwsh ./scripts/brand-verify.ps1 -Verbose              (show every passed check)
#
# Carve-out · admin.html, og-image-generator.html are excluded
# from every rule. The admin portal deliberately uses a different design
# system (CMS palette + Geist Mono + Chart.js).
#
# Exit codes:
#   0  all checks passed (warnings may be present and are documented)
#   1  one or more checks failed; do not commit
#   2  script error (path not found, etc.)

[CmdletBinding()]
param(
  [string]$Path = ""
)

$ErrorActionPreference = "Stop"
$root = if ($Path) { $Path } else { Split-Path -Parent $PSScriptRoot }
if (-not (Test-Path $root)) { Write-Error "Path not found: $root"; exit 2 }
# Project root for cross-file artefacts (fonts.css, styles-i8.css, etc.)
# In single-file -Path mode `$root` points at the file being linted, so
# repo-wide assets must be resolved from the script's location.
$projectRoot = Split-Path -Parent $PSScriptRoot

$script:failures = 0
$script:warnings = 0
$script:passes   = 0

function Write-Fail([string]$Rule, [string]$Detail) {
  $script:failures++
  Write-Host "[FAIL] $Rule" -ForegroundColor Red
  if ($Detail) { Write-Host "       $Detail" }
}
function Write-Warn([string]$Rule, [string]$Detail) {
  $script:warnings++
  Write-Host "[WARN] $Rule" -ForegroundColor Yellow
  if ($Detail) { Write-Host "       $Detail" }
}
function Write-Pass([string]$Rule) {
  $script:passes++
  if ($VerbosePreference -eq 'Continue') {
    Write-Host "[PASS] $Rule" -ForegroundColor Green
  }
}
function Write-Head([string]$Section) {
  Write-Host ""
  Write-Host "== $Section ==" -ForegroundColor Cyan
}

# ----------------------------------------------------------------
# File discovery
# ----------------------------------------------------------------
$allFiles = if (Test-Path -PathType Leaf $root) {
  ,(Get-Item $root)
} else {
  Get-ChildItem -Path $root -Recurse -Include *.html, *.css `
    | Where-Object {
        # Normalise path separators so the excludes work on both
        # Windows (\) and Linux (/) · the latter is what the GitHub
        # Actions runner uses, and the previous Windows-only patterns
        # let partials/ and ops/ leak into the scope on CI.
        $p = $_.FullName.Replace('\','/')
        $p -notlike '*/fonts/*' -and
        $p -notlike '*/admin*'  -and
        $p -notlike '*og-image-generator*' -and
        $p -notlike '*/node_modules/*' -and
        $p -notlike '*/dist/*' -and
        $p -notlike '*/.git/*' -and
        $p -notlike '*/ops/*' -and
        $p -notlike '*/partials/*' -and
        $_.Name -ne 'homepage.html'
      }
}

$htmlFiles = $allFiles | Where-Object { $_.Extension -eq '.html' }
$cssFiles  = $allFiles | Where-Object { $_.Extension -eq '.css' }

Write-Host "Counsel.day · Iteration 8 (white + wine) brand check"
Write-Host "Scope: $($htmlFiles.Count) HTML files + $($cssFiles.Count) CSS files (admin and og-image-generator excluded)"

# ================================================================
# 1 · Required i8 fonts loaded in every HTML page
# ================================================================
Write-Head "1 · Required i8 fonts loaded in every page"

$requiredFonts = @{
  'Newsreader'        = 'Newsreader (display)'
  'Source+Serif+4'    = 'Source Serif 4 (body)'
  'Geist:'            = 'Geist (UI)'
  'Geist+Mono'        = 'Geist Mono (metadata)'
}

$missingFontPages = 0
foreach ($f in $htmlFiles) {
  # Skip pages that are intentional micro-pages with inline-only fonts
  if ($f.Name -in @('homepage.html')) { continue }
  $text = [System.IO.File]::ReadAllText($f.FullName)
  # Self-hosted path: if the page links /fonts/fonts.css we trust it (the
  # CSS file is verified separately below).
  if ($text -match '/fonts/fonts\.css') { continue }
  $missing = @()
  foreach ($key in $requiredFonts.Keys) {
    if ($text -notmatch [regex]::Escape($key)) {
      $missing += $requiredFonts[$key]
    }
  }
  if ($missing.Count -gt 0) {
    $missingFontPages++
    $rel = $f.FullName.Replace($root, '').TrimStart('\','/')
    Write-Fail "$rel does not load: $($missing -join ', ')" "Link /fonts/fonts.css OR add the Google Fonts <link>"
  }
}

# Verify the central /fonts/fonts.css declares every required @font-face
$fontsCssPath = Join-Path $projectRoot 'fonts/fonts.css'
if (Test-Path $fontsCssPath) {
  $fontsCss = [System.IO.File]::ReadAllText($fontsCssPath)
  $cssRequired = @{
    "font-family: 'Newsreader'"     = 'Newsreader (display)'
    "font-family: 'Source Serif 4'" = 'Source Serif 4 (body)'
    "font-family: 'Geist'"          = 'Geist (UI)'
    "font-family: 'Geist Mono'"     = 'Geist Mono (metadata)'
  }
  $missingInCss = @()
  foreach ($key in $cssRequired.Keys) {
    if ($fontsCss -notmatch [regex]::Escape($key)) { $missingInCss += $cssRequired[$key] }
  }
  if ($missingInCss.Count -eq 0) {
    Write-Pass "Self-hosted /fonts/fonts.css declares all four required @font-face families"
  } else {
    $missingFontPages++
    Write-Fail "fonts/fonts.css missing @font-face for: $($missingInCss -join ', ')" "Re-run the fonts download + regenerate fonts.css"
  }
} else {
  $missingFontPages++
  Write-Fail "fonts/fonts.css missing" "Self-hosted fonts are the canonical loader · regenerate or remove the /fonts/fonts.css references"
}

if ($missingFontPages -eq 0) { Write-Pass "All HTML pages load Newsreader + Source Serif 4 + Geist + Geist Mono (via /fonts/fonts.css or Google Fonts)" }

# ================================================================
# 2 · Banned fonts on the public surface
# ================================================================
Write-Head "2 · Banned fonts on the public surface"

$bannedFonts = @(
  'Manrope', 'Inter', 'Fraunces', 'EB Garamond', 'Roboto',
  'Poppins', 'DM Sans', 'Open Sans', 'Lato', 'Nunito',
  'JetBrains Mono', 'Fira Code', 'Public Sans', 'IBM Plex Mono'
)

foreach ($font in $bannedFonts) {
  $hits = @()
  foreach ($f in $allFiles) {
    $text = [System.IO.File]::ReadAllText($f.FullName)
    if ($text -match "font-family[^;}]*['""]\s*$([regex]::Escape($font))" -or
        $text -match "family=$([regex]::Escape($font.Replace(' ', '+')))" -or
        $text -match "family=$([regex]::Escape($font))(?![a-zA-Z])") {
      $hits += $f.FullName.Replace($root, '').TrimStart('\','/')
    }
  }
  if ($hits.Count -gt 0) {
    Write-Fail "Banned font '$font' used in font-family or font URL" (($hits | Select-Object -Unique) -join "`n       ")
  } else {
    Write-Pass "No '$font' usage"
  }
}

# ================================================================
# 3 · i8 stylesheet linked on every public HTML page
# ================================================================
Write-Head "3 · styles-i8.css linked on every public HTML page"

$missingStylesheet = @()
foreach ($f in $htmlFiles) {
  if ($f.Name -in @('homepage.html')) { continue }
  $text = [System.IO.File]::ReadAllText($f.FullName)
  if ($text -notmatch 'href="(\.\./)?styles-i8\.css"' -and $text -notmatch ':root\s*\{[^}]*--wine\s*:') {
    $rel = $f.FullName.Replace($root, '').TrimStart('\','/')
    $missingStylesheet += $rel
  }
}
if ($missingStylesheet.Count -gt 0) {
  Write-Fail "Page(s) missing styles-i8.css link AND no inline i8 :root token block" ($missingStylesheet -join "`n       ")
} else {
  Write-Pass "Every page links styles-i8.css or carries an inline i8 :root block"
}

# ================================================================
# 4 · Legacy chrome removed (records-strip, masthead)
# ================================================================
Write-Head "4 · Legacy chrome blocks removed from the public surface"

$strippedChromeHits = @()
foreach ($f in $htmlFiles) {
  $text = [System.IO.File]::ReadAllText($f.FullName)
  if ($text -match '<div class="records-strip">' -or
      $text -match '<header class="masthead">' -or
      $text -match '<hr class="masthead-rule">') {
    $strippedChromeHits += $f.FullName.Replace($root, '').TrimStart('\','/')
  }
}
if ($strippedChromeHits.Count -gt 0) {
  Write-Fail "Legacy chrome blocks (records-strip / masthead / masthead-rule) still present" ($strippedChromeHits -join "`n       ")
} else {
  Write-Pass "Legacy chrome removed from every page"
}

# ================================================================
# 5 · nav-brand present in every .nav-bar
# ================================================================
Write-Head "5 · .nav-brand present inside .nav-inner on every page"

$missingNavBrand = @()
foreach ($f in $htmlFiles) {
  if ($f.Name -in @('homepage.html', 'offline.html', 'maintenance.html', 'session-expired.html')) { continue }
  $text = [System.IO.File]::ReadAllText($f.FullName)
  if ($text -match '<nav class="nav-bar"') {
    if ($text -notmatch '<a class="nav-brand"') {
      $missingNavBrand += $f.FullName.Replace($root, '').TrimStart('\','/')
    }
  }
}
if ($missingNavBrand.Count -gt 0) {
  Write-Fail "Pages with .nav-bar but missing .nav-brand element" ($missingNavBrand -join "`n       ")
} else {
  Write-Pass "Every navigation bar carries the .nav-brand wordmark"
}

# ================================================================
# 6 · GA4 analytics script present on every page
# ================================================================
Write-Head "6 · GA4 script (ga4.js) included on every page"

$missingGa4 = @()
foreach ($f in $htmlFiles) {
  $text = [System.IO.File]::ReadAllText($f.FullName)
  if ($text -notmatch '<script[^>]+src="(\.\./)?ga4\.js"') {
    $missingGa4 += $f.FullName.Replace($root, '').TrimStart('\','/')
  }
}
if ($missingGa4.Count -gt 0) {
  Write-Fail "GA4 analytics script missing on these pages" ($missingGa4 -join "`n       ")
} else {
  Write-Pass "Every page loads ga4.js"
}

# ================================================================
# 7 · theme-color is #ffffff (or any pure-white variant)
# ================================================================
Write-Head "7 · theme-color is #ffffff (i8 paper)"

$wrongThemeColor = @()
foreach ($f in $htmlFiles) {
  $text = [System.IO.File]::ReadAllText($f.FullName)
  if ($text -match '<meta name="theme-color" content="(#[0-9a-fA-F]{3,6})"') {
    $val = $matches[1].ToLower()
    if ($val -notin @('#fff', '#ffffff')) {
      $rel = $f.FullName.Replace($root, '').TrimStart('\','/')
      $wrongThemeColor += "$rel : $val"
    }
  }
}
if ($wrongThemeColor.Count -gt 0) {
  Write-Warn "theme-color is not pure white on these pages" ($wrongThemeColor -join "`n       ")
} else {
  Write-Pass "Every page's theme-color is #ffffff"
}

# ================================================================
# 8 · No em-dashes or en-dashes anywhere in source · PROJECT-WIDE
#     Scans HTML, CSS, JS, TS, MD, PY, SQL, JSON, YAML, SH, PS1.
#     The rule applies everywhere: user-facing copy, code comments,
#     log messages, email templates, docs. Use middle-dot (·), colon, or
#     semicolon. See docs/BRAND.md §7.
# ================================================================
Write-Head "8 · No em-dashes or en-dashes in source (project-wide)"

$emdash = [char]0x2014
$endash = [char]0x2013

# Re-walk the tree for the dash check with a wider extension list. We don't
# want to widen $allFiles globally (other checks are HTML/CSS-specific).
$dashScanRoot = if (Test-Path -PathType Container $root) { $root } else { Split-Path $root -Parent }
$dashScanRoot = [System.IO.Path]::GetFullPath($dashScanRoot + '/../')
$dashScanFiles = Get-ChildItem -Path $dashScanRoot -Recurse -Include *.html,*.css,*.js,*.ts,*.tsx,*.jsx,*.md,*.py,*.sql,*.json,*.yml,*.yaml,*.sh,*.ps1,*.txt `
  | Where-Object {
      $_.FullName -notlike '*\node_modules\*' -and
      $_.FullName -notlike '*\.next\*' -and
      $_.FullName -notlike '*\.git\*' -and
      $_.FullName -notlike '*\dist\*' -and
      $_.FullName -notlike '*\build\*'
    }

$dashHits = @()
foreach ($f in $dashScanFiles) {
  $text = [System.IO.File]::ReadAllText($f.FullName)
  # Strip Google Fonts URLs (axis range character `..` looks like the
  # dash range in some scanners; harmless either way to skip).
  $textStripped = [regex]::Replace($text, 'https://fonts\.googleapis\.com/css2\?[^"\s]+', '')
  if ($textStripped -match "[$emdash$endash]") {
    $dashHits += $f.FullName.Replace($dashScanRoot, '').TrimStart('\','/')
  }
}
if ($dashHits.Count -gt 0) {
  Write-Fail "Em-dash or en-dash present (project-wide scan)" ($dashHits -join "`n       ")
} else {
  Write-Pass "Zero em-dashes and en-dashes anywhere in the project ($($dashScanFiles.Count) files scanned)"
}

# ================================================================
# 9 · USD discipline · every dollar amount qualified with USD
# ================================================================
Write-Head "9 · Currency formatting (USD discipline)"

$bareDollarHits = @()
foreach ($f in $htmlFiles) {
  $text = [System.IO.File]::ReadAllText($f.FullName)
  $dollarMatches = [regex]::Matches($text, '\$\d+(?:\.\d+)?')
  foreach ($m in $dollarMatches) {
    $contextStart = [math]::Max(0, $m.Index - 30)
    $contextLen = [math]::Min(90, $text.Length - $contextStart)
    $context = $text.Substring($contextStart, $contextLen)
    if ($context -match 'var\(|\$\{|<style|<script|/style>|/script>') { continue }
    $windowStart = [math]::Max(0, $m.Index - 30)
    $windowLen   = [math]::Min(80, $text.Length - $windowStart)
    $window = $text.Substring($windowStart, $windowLen)
    if ($window -notmatch '\bUSD\b') {
      $bareDollarHits += "$($f.Name) : '$($m.Value)' (context: ...$($context.Trim())...)"
      if ($bareDollarHits.Count -ge 5) { break }
    }
  }
  if ($bareDollarHits.Count -ge 5) { break }
}
if ($bareDollarHits.Count -gt 0) {
  Write-Warn "Possible bare dollar values without 'USD' qualifier within 60 chars" ($bareDollarHits -join "`n       ")
} else {
  Write-Pass "Every dollar amount is qualified with USD within 60 characters"
}

$nzdHits = @()
foreach ($f in $htmlFiles) {
  $text = [System.IO.File]::ReadAllText($f.FullName)
  if ($text -match '\bNZD\b' -and $f.Name -notlike 'changelog*') {
    $nzdHits += $f.FullName.Replace($root, '').TrimStart('\','/')
  }
}
if ($nzdHits.Count -gt 0) {
  Write-Warn "NZD referenced on public surface" ($nzdHits -join "`n       ")
} else {
  Write-Pass "No NZD references on the public surface"
}

# ================================================================
# 10 · Buttons have zero border-radius
# ================================================================
Write-Head "10 · Buttons have zero border-radius"

$btnRadiusHits = @()
foreach ($f in $allFiles) {
  $rel = $f.FullName.Replace($root, '').TrimStart('\','/')
  $text = [System.IO.File]::ReadAllText($f.FullName)
  $lines = $text -split "`n"
  $inBtnRule = $false
  foreach ($line in $lines) {
    if ($line -match '(\.btn[^\{]*|\bbutton[^a-zA-Z][^\{]*)\{') { $inBtnRule = $true }
    if ($inBtnRule -and $line -match 'border-radius\s*:\s*([0-9.]+)(px|rem|em)') {
      $val = [double]$matches[1]
      if ($val -gt 0) {
        $btnRadiusHits += "$rel : $($line.Trim())"
        $inBtnRule = $false
        break
      }
    }
    if ($line -match '\}') { $inBtnRule = $false }
  }
}
if ($btnRadiusHits.Count -gt 0) {
  Write-Warn "Non-zero border-radius on button selectors (i8 enforces 0)" (($btnRadiusHits | Select-Object -Unique -First 6) -join "`n       ")
} else {
  Write-Pass "No non-zero border-radius on button selectors"
}

# ================================================================
# 11 · Wine accent (#722F37) present in stylesheet
# ================================================================
Write-Head "11 · Wine accent #722F37 present in styling"

$wineToken = $false
foreach ($f in $cssFiles) {
  $text = [System.IO.File]::ReadAllText($f.FullName)
  if ($text -match '#722F37' -or $text -match '--wine\s*:') {
    $wineToken = $true
    break
  }
}
if (-not $wineToken) {
  foreach ($f in $htmlFiles) {
    $text = [System.IO.File]::ReadAllText($f.FullName)
    if ($text -match '#722F37' -or $text -match '--wine\s*:') {
      $wineToken = $true
      break
    }
  }
}
if ($wineToken) {
  Write-Pass "Wine accent #722F37 / --wine token present"
} else {
  Write-Fail "Wine accent #722F37 not found anywhere · brand colour missing" ""
}

# ================================================================
# 12 · Google Analytics + Google Tag Manager on every page · SHIP BLOCKER
#      Every public HTML page MUST include the canonical analytics
#      head snippet (Consent Mode v2 default + GTM container + GA4 id).
#      Both the GTM container id and the GA4 measurement id must appear,
#      AND the noscript GTM iframe must appear after <body>.
# ================================================================
Write-Head "12 · Google Analytics (G-SX20BZZP59) + GTM (GTM-PFFSDN3M) on every page"

$gtmId = 'GTM-PFFSDN3M'
$ga4Id = 'G-SX20BZZP59'
$consentDefault = "gtag('consent', 'default'"
$noscriptIframe = 'googletagmanager.com/ns.html?id=GTM-PFFSDN3M'

$missingGtm = @()
$missingGa4 = @()
$missingConsent = @()
$missingNoscript = @()

foreach ($f in $htmlFiles) {
  $rel = $f.FullName.Substring((Get-Location).Path.Length).TrimStart('\','/')
  $text = [System.IO.File]::ReadAllText($f.FullName)
  if ($text -notmatch [regex]::Escape($gtmId))            { $missingGtm += $rel }
  if ($text -notmatch [regex]::Escape($ga4Id))            { $missingGa4 += $rel }
  if ($text -notmatch [regex]::Escape($consentDefault))   { $missingConsent += $rel }
  if ($text -notmatch [regex]::Escape($noscriptIframe))   { $missingNoscript += $rel }
}

if ($missingGtm.Count -eq 0)      { Write-Pass "GTM container $gtmId present on every public HTML page ($($htmlFiles.Count) files)" }
else                              { Write-Fail "GTM container $gtmId missing on $($missingGtm.Count) page(s)" (($missingGtm | Select-Object -First 6) -join "`n       ") }

if ($missingGa4.Count -eq 0)      { Write-Pass "GA4 measurement id $ga4Id present on every public HTML page" }
else                              { Write-Fail "GA4 measurement id $ga4Id missing on $($missingGa4.Count) page(s)" (($missingGa4 | Select-Object -First 6) -join "`n       ") }

if ($missingConsent.Count -eq 0)  { Write-Pass "Consent Mode v2 default block present on every page" }
else                              { Write-Fail "Consent Mode v2 default missing on $($missingConsent.Count) page(s) (run scripts/inject-analytics.py)" (($missingConsent | Select-Object -First 6) -join "`n       ") }

if ($missingNoscript.Count -eq 0) { Write-Pass "GTM noscript iframe present on every page" }
else                              { Write-Fail "GTM noscript iframe missing on $($missingNoscript.Count) page(s)" (($missingNoscript | Select-Object -First 6) -join "`n       ") }

# ================================================================
# 13 · Sentry config files contain no em-dashes or en-dashes
#      The project-wide scan in Check 8 already covers these, but
#      Sentry files are particularly prone to copy-pasted snippets
#      from Sentry docs that include em-dashes. Calling them out
#      explicitly here so future failures point right at the file
#      rather than "somewhere in the project".
# ================================================================
Write-Head "13 · Sentry config files (TypeScript + instrumentation) dash-free"

$sentryFiles = @(
  Join-Path $dashScanRoot 'counsel-day-app/sentry.server.config.ts'
  Join-Path $dashScanRoot 'counsel-day-app/sentry.edge.config.ts'
  Join-Path $dashScanRoot 'counsel-day-app/src/instrumentation-client.ts'
  Join-Path $dashScanRoot 'counsel-day-app/src/instrumentation.ts'
  Join-Path $dashScanRoot 'counsel-day-app/src/app/global-error.tsx'
  Join-Path $dashScanRoot 'counsel-day-app/next.config.ts'
) | Where-Object { Test-Path $_ }

$sentryDashHits = @()
foreach ($f in $sentryFiles) {
  $text = [System.IO.File]::ReadAllText($f)
  if ($text -match "[$emdash$endash]") {
    $sentryDashHits += $f.Replace($dashScanRoot, '').TrimStart('\','/')
  }
}
if ($sentryDashHits.Count -eq 0) {
  Write-Pass "Sentry config files contain zero em/en-dashes ($($sentryFiles.Count) files scanned)"
} else {
  Write-Fail "Em-dash or en-dash present in Sentry config" ($sentryDashHits -join "`n       ")
}

# ================================================================
# 14 · Admin pages must not load external scripts or stylesheets
# ================================================================
# CSP-hardening · the admin surface is gated behind /api/admin-auth-check
# but we still want defence-in-depth: no third-party CDN script tags
# anywhere under /admin*. Self-host everything (Chart.js was the
# original offender; now lives at /chart.umd.min.js).
Write-Head "14 · Admin pages load no external scripts or stylesheets"
$adminPath = Join-Path (Split-Path -Parent $PSScriptRoot) ''
$adminFiles = Get-ChildItem -Path $adminPath -Recurse -Include 'admin.html', 'admin-*.html' -ErrorAction SilentlyContinue
$adminExternalHits = @()
foreach ($f in $adminFiles) {
  $text = [System.IO.File]::ReadAllText($f.FullName)
  # Match <script src="https://..."> and <link ... href="https://...">
  # Allow data: URIs because they're inline payloads, not network calls.
  $scriptMatches = [regex]::Matches($text, '<script[^>]+src=["''](https?://[^"'']+)["'']')
  foreach ($m in $scriptMatches) { $adminExternalHits += "$($f.Name): script src $($m.Groups[1].Value)" }
  $linkMatches = [regex]::Matches($text, '<link[^>]+href=["''](https?://[^"'']+)["''][^>]*>')
  foreach ($m in $linkMatches) {
    $href = $m.Groups[1].Value
    # Allow canonical + alternate links to self (counsel.day) since those
    # are SEO metadata, not network fetches.
    if ($href -match '^https?://counsel\.day/') { continue }
    $adminExternalHits += "$($f.Name): link href $href"
  }
}
if ($adminExternalHits.Count -eq 0) {
  Write-Pass "No external script or stylesheet references on the admin surface"
} else {
  Write-Fail "External resource on admin page (CSP-hardening rule)" ($adminExternalHits -join "`n       ")
}

# ================================================================
# 15 · favicon.svg present at root
# ================================================================
# SEO checkers (Yoast, SEO Site Checkup) downgrade pages without a
# discoverable favicon. The Caddyfile maps /favicon.ico → favicon.svg
# so legacy crawlers also get a 200.
Write-Head "15 · favicon.svg present"
$projectRoot = if ($Path) { (Get-Item $Path).Directory.FullName } else { (Split-Path -Parent $PSScriptRoot) }
# When linting a single file, $projectRoot may not be the site root.
# Fall back to walking upward until we find counsel-day-complete.
if (-not (Test-Path (Join-Path $projectRoot 'favicon.svg'))) {
  # Recompute from script location
  $projectRoot = Split-Path -Parent $PSScriptRoot
}
$faviconPath = Join-Path $projectRoot 'favicon.svg'
if (Test-Path $faviconPath) {
  Write-Pass "favicon.svg present at site root"
} else {
  Write-Fail "favicon.svg missing at site root" "Create counsel-day-complete/favicon.svg or restore from git"
}

# ================================================================
# Summary
# ================================================================
Write-Host ""
Write-Host "=================================================="
Write-Host "Counsel.day i8 brand verification complete"
Write-Host "  Passed:   $($script:passes)"
Write-Host "  Warnings: $($script:warnings)"
Write-Host "  Failed:   $($script:failures)"
Write-Host "=================================================="

if ($script:failures -gt 0) {
  Write-Host ""
  Write-Host "Brand verification FAILED. Fix the failures before commit." -ForegroundColor Red
  exit 1
}

if ($script:warnings -gt 0) {
  Write-Host ""
  Write-Host "Brand verification passed with $($script:warnings) warning(s). Review the warnings." -ForegroundColor Yellow
  exit 0
}

Write-Host ""
Write-Host "Brand verification passed clean. Ready to commit." -ForegroundColor Green
exit 0
