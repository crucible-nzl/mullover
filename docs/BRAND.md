# Counsel.day Brand · Iteration 8 · White + Wine

The canonical brand and design-system reference. **Every page Claude (or anyone) writes must conform to this document.**

> **Last revised 15 May 2026.** The site has moved through eight iterations. The current direction (Iteration 8) is pure white + wine: pure white background, wine accent, Newsreader display, Source Serif 4 body, Geist UI, Geist Mono metadata, audience-naming kicker, `Decide slowly, well.` tagline, no hero illustration, no sealed-record artefacts, no magazine masthead.
>
> Prior iterations (warm-bone editorial-magazine, sealed-record registry) are retired. Do not reach back for them.

## 1 · The single source of truth

The full specification lives at [docs/design-notes.md](design-notes.md). That file is canonical: typography, palette, layout grammar, voice, surface-by-surface composition, migration mapping, and the file-by-file update list. Read it before writing any page.

This document summarises the locked decisions for fast reference; design-notes.md elaborates them.

## 2 · Typography · four families, strict non-overlapping roles

| Family | Role | Example selectors |
|---|---|---|
| **Newsreader** (400 · 500, with italic) | Display: headlines, the question on vote pages, verdicts, section titles, vote buttons. Italic accent on the loaded word in each headline. | `h1`, `h2`, `.hero-headline`, `.section-title`, `.vote-button` |
| **Source Serif 4** (400 · 500) | Body prose: the Method essay, byline paragraphs, longform copy. Optical sizing handles caption-to-lede. | `body`, `p`, `.lede`, `.byline` |
| **Geist** (400 · 500 · 600) | UI sans: buttons, navigation, very small labels. 13 to 15 pixels only. | `.btn`, `nav`, `.label`, `.caption` |
| **Geist Mono** (400 · 500) | Metadata and labels: mono kickers (§ 1, § 2), decision identifiers (№0047), day counts, keyboard shortcuts, colophon. | `.kicker`, `.id`, `.day-count`, `.shortcut` |

**Banned on the public surface:** Inter, Fraunces, EB Garamond, Roboto, Poppins, DM Sans, Open Sans, Lato, Nunito, IBM Plex Mono, IBM Plex Sans, JetBrains Mono, Fira Code, Public Sans, Manrope. Each was reached for in an earlier iteration and discarded. The four families above are the locked set.

## 3 · Palette · pure white + wine

```
--paper          #ffffff   page background (pure white)
--paper-deep     #fafaf8   subtle off-white (sparingly, or omitted)
--surface        #ffffff   bordered containers (definition by border, not fill)
--ink            #0a0a0a   primary text (warmer than pure black)
--ink-soft       #3a3530   secondary text
--muted          #6b635a   tertiary text, captions
--subtle         #9b9286   faintest text, supporting metadata
--rule           #e8e6e1   hairline rules
--rule-strong    #0a0a0a   heavy rules, major container borders

--wine           #722F37   primary accent (italic accents, kickers, links, Partner A)
--wine-deep      #561F26   hover/active states
--wine-soft      #f4e6e8   soft wash (selected vote on dark, subtle highlights)
--rose           #c4806b   Partner B accent (dual-record contexts only)
```

**Dropped from prior iterations:** warm bone `#f5f0e8`, cream `#fbf8f2`, clay `#a14a2c` (and all clay variants), olive `#5a6147`, forest `#2E4438`, warm rule `#d4ccbd`, the old `--clay` token names. The new `--wine` token is the canonical name; legacy `--clay` aliases should be migrated, not preserved long-term.

## 4 · Layout grammar

- **Header.** Simple nav bar: wordmark left, primary nav grouped right, single CTA (`Start a decision`) at far right. One hairline rule beneath. No top strip, no three-cell masthead, no date chip.
- **Sections.** Divided by 1px rules in `--rule`. Each opens with a small uppercase kicker in mono or sans and a Newsreader title with italic accent in wine. § kicker pattern retained.
- **Reading widths.** 760 to 880px for prose (Method, FAQ), 1080px for specimens and editions, 1280px for diagrams and the questions grid.
- **Centred text.** Centred columns are about position; their internal text is justify-aligned for readability.
- **Bordered containers.** 1px ink border, 1px rule dividers, no radius, no shadow. The grid is the design.

## 5 · The wordmark

`Counsel` in Newsreader 500, followed by `.day` in Newsreader 400 italic, in wine. No logo mark, no rings, no envelope. The wordmark is the entire brand identity in visual form.

## 6 · The tagline and audience kicker

- **Tagline:** `Decide slowly, well.` with `well.` italicised in wine.
- **Audience kicker** (above the hero headline): `A decision tool for solo, couples, and families.` Audience is named so the visitor knows in three seconds who the tool is for.
- **Mechanism line** (beneath tagline, italic serif subhead): `A duration you choose. One verdict, prepared and revealed at the end.`

Retired formulations: `Decide together, slowly, well.`, `Decisions, for two.`, `Mull Over`. Do not reintroduce.

## 7 · Voice rules

- No exclamation marks.
- No "you" in marketing-pump senses.
- No urgency tactics (no "limited time," no countdown timers).
- No marketing chip claims (no "used by 10,000 couples").
- No bullet lists in marketing narrative (lists belong in comparisons and FAQs).
- Italic emphasis only on the emotional word in each headline; wine colour; never more than one per headline.
- Numbered references throughout: § 1 to § 6 for sections, № 01 to № 12 for questions.
- **No em-dashes (U+2014) and no en-dashes (U+2013) ANYWHERE in the project.** The replacement is `·` (middle dot, U+00B7), `:`, or `;`. This rule applies project-wide and is non-negotiable:
  - All user-facing copy (HTML pages, marketing, FAQ, terms, refunds, all surfaces).
  - All transactional email content (signup verification, daily prompts, verdict-ready notices, password reset, partner invites · anything sent via Brevo).
  - All code comments and log messages in `.ts`, `.js`, `.tsx`, `.jsx`, `.py`, `.sql`, `.sh`, `.ps1`.
  - All documentation in `.md` files (this file, RUNBOOK, INTEGRATION_BACKLOG, SECURITY_HARDENING, etc.).
  - All operator-facing strings in the admin panel.
  - Configuration files: `.json`, `.yml`, `.toml`.
  - **Brand-verify Check 8 enforces this** across the full extension set above. The verifier will fail any commit that introduces a single U+2014 or U+2013. The bulk replacer at `counsel-day-complete/scripts/swap-ai-vendor-references.py` and the one-liner Python snippet documented in `docs/RUNBOOK.md` can sweep new violations.
  - Why this rule exists: visual consistency with the wordmark and the middle-dot pattern used throughout the site (`Counsel·day`, `30 SEALED EVENINGS · NEITHER PARTNER...`), and to remove a class of cross-platform rendering bugs (Windows code points, mobile autocorrect substitutions, AI-tool default punctuation).

## 8 · Banned patterns

- No `border-radius` on buttons (0px enforced).
- No `box-shadow` on panels; definition by 1px hairlines only.
- No animation beyond 200ms ease; all respect `prefers-reduced-motion`.
- No emoji as iconography, no testimonial sliders, no carousels, no floating widgets, no fixed sidebars.
- No drop caps as a generic section opener (retained only inside long-form essays).
- No hero illustrations of figures (the two-figures-on-a-bench Plate I is retired).
- No sealed envelope artefact, no wax seal SVG, no records-strip top bar, no `FILE NN` eyebrow pattern (all sealed-record chrome is retired).
- No two-line magazine masthead rule, no three-cell masthead, no date chip in the header.

## 9 · Admin portal carve-out

`/admin`, `admin/`, `og-image-generator.html`, `admin-app.js` keep the slate/blue CMS palette and the system-ui font stack. They are intentionally outside this design system.

## 10 · Engineering posture (unchanged across iterations)

Hardening is part of every stage. The product, at any point in its build, must be in a state that could pass a third-party penetration test without remediation. Every commit, every PR, every feature ships hardened or it does not ship. See [docs/design-notes.md](design-notes.md) § Engineering and security for the full specification.

## 11 · Files and the migration map

The complete file-by-file update list (50+ HTML files) and the find-and-replace migration table (clay → wine, `Decide together, slowly, well.` → `Decide slowly, well.`, `for couples` → `for solo, couples, and families`, etc.) live in [docs/design-notes.md](design-notes.md) under "Migration mapping for Claude Code" and "Files requiring update."

Apply the mapping in order; verify each file renders before proceeding.

## 12 · The verifier

The PowerShell brand-verifier at [counsel-day-complete/scripts/brand-verify.ps1](../counsel-day-complete/scripts/brand-verify.ps1) was built for the now-retired sealed-record direction (Iteration 7). It needs to be rewritten to enforce the Iteration 8 rules:

- Banned fonts: Inter, Fraunces, IBM Plex Mono, IBM Plex Sans, Public Sans, Manrope, EB Garamond, Roboto, Poppins, DM Sans, Open Sans, Lato, Nunito, JetBrains Mono, Fira Code.
- Required fonts: Newsreader, Source Serif 4, Geist, Geist Mono.
- Banned colours: `#f5f0e8` (warm bone), `#a14a2c` (clay) and variants, `#2E4438` (forest), `#1c1a17` (warm ink).
- Required pattern: pure white `#ffffff` background.
- Tagline check: `Decide slowly, well.` only; flag `Decide together, slowly, well.`
- Audience check: pages mentioning audience must use the `solo, couples, and families` formulation; flag bare `for couples` or `for two`.
- No em/en-dashes anywhere (this check carries over).
- No `border-radius: Npx` (N > 0) on buttons.
- No `box-shadow` on panels.
- Banned class names: `wax-seal`, `record-envelope`, `record-slip`, `filing-table`, `records-strip`, `two-ring-mark`, `magazine-masthead`, `masthead-three-cell`.

Rewrite is a separate work item; the script in tree currently enforces sealed-record rules.

## 13 · Analytics on every page · ship-blocking

Every public HTML page **MUST** carry the canonical analytics head snippet (Consent Mode v2 default → GTM container → GA4 gtag) and the GTM noscript iframe immediately after `<body>`. This is non-negotiable: the verifier (Check 12) fails any commit that ships a page without it.

**Canonical snippet** lives at [counsel-day-complete/ops/cd-head-snippet.html](../counsel-day-complete/ops/cd-head-snippet.html). Do not hand-edit per page; do not paste copies. The injector at [counsel-day-complete/scripts/inject-analytics.py](../counsel-day-complete/scripts/inject-analytics.py) places it after `<meta name="viewport">` on every page and the noscript right after `<body>`. The script is idempotent · re-running it on a page that already has the snippet is a no-op.

**IDs in production**:
- GA4 measurement id: `G-SX20BZZP59`
- GTM container id: `GTM-PFFSDN3M`

**Brand-verify Check 12 enforces, per page**:
- Presence of the GTM container id `GTM-PFFSDN3M`
- Presence of the GA4 id `G-SX20BZZP59`
- Presence of the Consent Mode v2 default block (`gtag('consent', 'default'`)
- Presence of the GTM noscript iframe (`googletagmanager.com/ns.html?id=GTM-PFFSDN3M`)

**Scope**: every public HTML page including signed-in app surfaces (`/account`, `/billing`, `/decisions`, `/decision`, `/compose`, `/vote-today`, `/verdict-reveal`, `/invite`) AND the admin portal (`/admin.html`). The only excluded files are `og-image-generator.html` and `homepage.html` (legacy prototype). Internal pages live in `EXCLUDE_FILES` in the injector script.

**Every push runs the verifier**. Before any deploy:

```powershell
cd counsel-day-complete
& .\scripts\brand-verify.ps1
```

Exit `0` is required to push. Exit `1` (Check 12 fail) means: open the failing files, ensure `<head>` and `<body>` are well-formed, re-run `python scripts/inject-analytics.py`, re-run the verifier.

**When the IDs change** (rare: new GA4 property, new GTM container):
1. Update [counsel-day-complete/ops/cd-head-snippet.html](../counsel-day-complete/ops/cd-head-snippet.html).
2. Update the four hard-coded strings in Check 12 of [counsel-day-complete/scripts/brand-verify.ps1](../counsel-day-complete/scripts/brand-verify.ps1).
3. Run `python scripts/inject-analytics.py` · it will detect the new ID isn't in pages and re-inject. (For an ID change, you need to first delete the old snippet block from every page, then re-inject. Add a flag to the injector or do a one-time `sed` sweep.)

**Consent Mode v2**: defaults to denied on every storage type except `security_storage`. User grants via the banner injected by `ga4.js`, which calls `gtag('consent', 'update', { analytics_storage: 'granted' })`. GPC/DNT signals upgrade the default to denied silently with no banner shown. See [docs/COUNSEL_DAY_SEO_STRATEGY.md] and [docs/GA4_FUNNEL.md] for the event catalogue.

## 14 · Static-HTML partials (nav + footer + analytics-adjacent)

**Why this exists.** Counsel.day's public surface is plain HTML served by Caddy · no framework, no templating runtime. The colophon footer recurs on 54 pages and the primary nav on 50. Editing them by hand is how drift starts: an updated link sits in `decisions.html` but not `account.html` and the site quietly diverges.

**The pattern.** A page opts into a shared region by wrapping it with marker comments:

```html
<!-- CD:PARTIAL:colophon -->
<footer class="colophon">… your existing content …</footer>
<!-- /CD:PARTIAL:colophon -->
```

The canonical source lives at `counsel-day-complete/partials/<name>.html`. Three partials are seeded:

- `partials/colophon.html` · the footer used on every page
- `partials/nav-public.html` · the marketing-surface nav (sign-in/start a decision)
- `partials/nav-app.html` · the signed-in app nav (decisions / vote-today / compose / account)

**The sync command.** Run `python counsel-day-complete/scripts/sync-partials.py` whenever a partial changes. The script walks every wrapped page and replaces the body between the markers verbatim with the partial's contents.

Flags:
- `--check` exits 1 if any wrapped page would change · suitable for pre-commit and CI.
- `--list` lists every page currently opting in.
- (no flag) applies.

**Onboarding a page.** Wrap its existing nav / footer with the markers shown above and run the script. Don't bulk-wrap everything at once · navs differ subtly between marketing pages (signed-out CTA) and app pages (Account button), and confirming the canonical version reads right on each page is faster done one-by-one. Pages wrapped as of 2026-05-20: decisions, account, billing, compose, vote-today, verdict-reveal, signin, signup.

**Don't reinvent this as a templating engine.** The marker pattern is intentionally lightweight · no build step, no runtime overhead, no dependency. If you find yourself wanting `{{variable}}` interpolation, the answer is "render that bit with JavaScript at runtime."

Related memory: [project_partials_pattern.md](../../.claude/projects/c--Users-James-OneDrive-Documents--Mullover-ai/memory/project_partials_pattern.md).
