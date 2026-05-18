# Counsel.day: Design Notes

The design specification for the current marketing surface and app surface, last revised 15 May 2026 (re-revised same day for the post-launch cleanup pass). Read alongside `counsel-day-complete/styles-i8.css` (the canonical stylesheet) and the eight surfaces that show the system most completely: `index.html`, `method.html`, `why-time.html`, `family.html`, `verdict.html`, `vote-today.html`, `verdict-reveal.html`, and the new dedicated `pricing.html`.

## What changed on 15 May 2026 (post-i8 cleanup pass)

These are the deltas applied in the cleanup pass after the Iteration 8 rebuild landed. Everything below this section is the longstanding design spec, lightly amended where the cleanup pass overrode an older decision.

- **Pricing raised** to a new SKU table (canonical pricing page is `counsel-day-complete/pricing.html`):
  - Solo per-decision · `$9.99 USD` (was $4.99). First lifetime decision still free.
  - Couple per-decision · `$12.99 USD` (was $9.99).
  - Family per-decision · `$16.99 USD` (was $14.99).
  - Solo Annual · `$79 USD/year` (was $49). Break-even ≈ 8 paid decisions.
  - Couple Annual · `$109 USD/year` (was $99). Break-even ≈ 9 paid decisions.
  - Family Annual · `$149 USD/year` (unchanged). Break-even ≈ 9 paid decisions.
- **Pricing surface promoted** to a dedicated `pricing.html` page (Product JSON-LD with all 7 Offers, per-decision and annual grids, tier comparison table, when-annual-makes-sense, payment/refunds/taxes section, FAQ). The homepage editions section is retained for context but the primary Pricing nav link points at the dedicated page.
- **Primary nav reduced to 8 items** to keep it on one line at 1280px: `The method · Why time · The distinction · A real verdict · For families · Compare · Pricing · FAQ`. `The evening vote` and `About` were removed from the primary nav (both stay in the colophon footer for discoverability).
- **Article shells widened** in `styles-i8.css` so prose fills more of the viewport: `.method-page-inner` and `.page-shell` from `1100px` → `1320px`; `.method-page-title` / `.page-title` `900px` → `1100px`; `.method-page-lede` / `.page-lede` `820px` → `980px`; `.method-stage-title` and `.method-stage-body` `880/820` → `1100px`; `.founder-case` `880` → `1100px`. Side-padding bumped from `32px` to `48px`. `vote-today.html .app-shell` widened from `760px` → `1200px`.
- **FILE · NN · prefix retired from eyebrows.** The earlier `FILE · 04 · WHEN TO USE BOTH` and `FILE 03.04` left-rail markers were stripped sitewide. Eyebrows now lead with the semantic label only (e.g. `WHEN TO USE BOTH`). Left-rail `<div class="stage-file">` markers are removed; `<div class="stage-name">STAGE N · TITLE</div>` continues to anchor each stage. Components.html `<h2>` headings simplified to `Component` since the FILE-99.NN counter no longer carries meaning.
- **`№ 0048-A` specimen file reference retired.** All `FILE · № 0048-A` text on `vote-today`, `decision`, `decisions`, `vote`, `method`, and `components` swapped for neutral labels (`TONIGHT'S VOTE`, `DAY 14 OF 30`, `SPECIMEN`, `A SAMPLE DECISION`, `№ EXAMPLE`).
- **Hero figure on `index.html`:** Partner A lane is forest green (`#2E4438`), Partner B lane is wine (`#722F37`), each with about 5 mid-period off-colour ticks so the strip reads as a decision that swayed day to day. SVG max-width bumped to `1620px`. Logo (nav-brand) bumped from `22px` to `34px`.
- **GA4 tracking** is loaded on every public page via `<script src="ga4.js" defer></script>` (and `../ga4.js` for subdirectory pages). Placeholder measurement ID is `G-XXXXXXXXXX` in `counsel-day-complete/ga4.js` line 9; swap to the live ID when the property is provisioned. Event catalogue and funnel-report instructions in [`docs/GA4_FUNNEL.md`](GA4_FUNNEL.md).
- **Operator email** is live · `admin@counsel.day` (Zoho Mail EU DC). All topic-routed aliases on the public site (`hello@`, `press@`, `privacy@`, etc.) route to that one inbox; do not replace the topic-routed addresses on the public surface (they remain informational signage).
- **Verifier rewritten.** `counsel-day-complete/scripts/brand-verify.ps1` is now the i8 pre-commit gate (11 checks: required fonts loaded, banned fonts, styles-i8.css linked, legacy chrome removed, nav-brand present, ga4.js included, theme-color is `#ffffff`, no em/en dashes, USD discipline, button border-radius is 0, wine accent present). Run before every commit; use `-Path <file>` to lint a single file.



## The single design principle

The visual language must match the emotional state of the customer at the moment of purchase. The customer is a thoughtful adult, alone or with a partner or with a family, carrying a real decision they have been circling for weeks. They are tired, anxious, hopeful, and quietly hoping the product will not be silly or shallow. Every design choice is downstream of that principle.

The single principle expressed more precisely: **the design must convey that this decision, whoever is making it, has been given the time it deserves and is being thought about properly.** The decision is the subject, not the people making it. A solo user with a real question deserves the same considered surface as a couple deciding whether to have a baby or a family deciding whether to put a parent into care. The system serves the question, not the audience demographic, and the design must visibly hold that posture.

The design is therefore quiet, considered, restrained, and editorial in register without being mannered. It avoids the visual grammar of generic SaaS products (vibrant chip colours, big shouty typography, illustrated mascots, urgency tactics, gradient backgrounds) because those signal a category the customer does not want to be in. It also avoids the visual grammar of wellness products (sage palettes, soft serifs, beach photography, mindful platitudes) because those signal a category that does not respect the seriousness of the question. It positions instead as a clean, considered consumer product that earns its premium price tag through restraint: white paper, disciplined typography, one accent colour, generous whitespace, no decorative chrome.

## Typography

Four families. None of them are Inter, Fraunces, or the other defaults Claude reaches for in early iterations.

Newsreader, for display.
A contemporary editorial serif with optical sizing, used at 30 to 120 pixels for headlines, the question on the vote page, the verdicts, the section titles, and the vote buttons. Italic is used as the emotional accent, set in wine colour, on the loaded word in each headline. The italic is doing real semantic work, not decoration.

Source Serif 4, for body prose.
A modern transitional serif designed for screen reading at 17 to 22 pixels. The Method essay on the homepage and the byline paragraphs throughout are set in this. Optical sizing handles the jump from small caption to large lede.

Geist, for sans-serif user-interface text.
Used for buttons, navigation, and very small labels. Always 13 to 15 pixels. The sans is intentionally restrained; it is doing utility work, not display work.

Geist Mono, for technical labels and timestamps.
Used for the mono kicker labels (the small uppercase letterspaced eyebrows), the section numbers (§ 1, § 2), the decision identifiers (№0047, №0048), the metadata strips, the day counts in the progress bar labels, the keyboard shortcut indicators on the vote buttons (Y, N), and the colophon footer. Mono carries the technical voice while the serifs carry the editorial voice.

The combination is deliberate: serif for content, sans for tools, mono for metadata. Each typeface has a job and never strays into the others.

**The wordmark.** Counsel.day is set in Newsreader: `Counsel` at weight 500, followed by `.day` at weight 400 in italic, in wine colour. There is no logo mark. The two intersecting rings used in an earlier iteration have been removed entirely. The wordmark is the entire brand identity in visual form.

## Palette

The full palette in CSS variables. The background is pure white now, not warm bone. The accent has shifted from clay terracotta to wine red. The rose secondary is retained but functions only in dual-record contexts (the second partner's verdict colour, the second partner's status indicators).

- paper: `#ffffff` (pure white background, the dominant surface)
- paper-deep: `#fafaf8` (a very subtle off-white, used sparingly for section-band variation; can also be omitted)
- surface: `#ffffff` (same as paper; bordered containers use border, not background, for definition)
- ink: `#0a0a0a` (near-black for primary text, slightly warmer than pure black)
- ink-soft: `#3a3530` (secondary text, kept warm to avoid corporate grey)
- muted: `#6b635a` (warm grey for tertiary text and captions)
- subtle: `#9b9286` (the faintest text, for metadata or supporting labels)
- rule: `#e8e6e1` (the standard hairline rule on white)
- rule-strong: `#0a0a0a` (the heavy rule, used for major container borders)
- wine: `#722F37` (the primary accent: deep red wine, used for italic accents in headlines, kicker labels, section eyebrows, the first partner's verdict colour, and link underlines)
- wine-deep: `#561F26` (deeper wine for hover and active states)
- wine-soft: `#f4e6e8` (a soft wine wash for the selected vote button text on dark backgrounds and for very subtle highlights)
- rose: `#c4806b` (the second partner's accent: dusty rose, retained for dual-record contexts only)

**Dropped from the previous palette:**
- Warm bone paper `#f5f0e8` (replaced by pure white)
- Warm cream paper-deep `#ede5d4` (replaced or removed)
- Cream surface `#fbf8f2` (replaced by pure white)
- All clay values `#a14a2c`, `#7a3520`, `#e9d4c5` (replaced by wine values)
- Olive `#5a6147` (no longer needed; the hero illustration that used it has been removed)
- Warm rule `#d4ccbd` (replaced by `#e8e6e1`)

No lime, no coral pop, no electric indigo, no neon anything. The palette is intentionally narrow: white, ink, one accent, one secondary, three greys, two rule weights.

## Layout grammar

The page is composed as a clean editorial surface, no longer a literal magazine masthead.

**The header.** A thin top strip is no longer used. The masthead from the prior iteration (three-cell row with `Vol. I · Edition One` on the left, wordmark centred, date on the right, heavy two-line rule beneath) has been removed entirely. In its place: a simple navigation bar with the `Counsel.day` wordmark on the left, primary navigation links centred or grouped on the right, and a single primary call-to-action button at the far right (`Start a decision`). One hairline rule beneath the nav bar. Sticky behaviour retained with a 92% white backdrop blur.

**Sections.** The body of the page is a sequence of sections divided by a 1px rule in `--rule`. Each major section opens with a small uppercase kicker in mono (or in sans, depending on density) and a large Newsreader title with an italic accent word in wine. The kicker uses the silcrow (§) and a middle-dot separator. Numbered references are retained throughout: § 1 to § 6 for sections, № 01 to № 12 for questions.

**Reading widths.** Content sits at one of three widths: a constrained reading column at around 760 to 880 pixels for prose-heavy sections (the Method essay, the FAQ), a medium column at around 1080 pixels for the specimen and the editions, and a wide column at 1280 pixels for the diagrams and the questions grid.

**Centred text.** When a block of body prose is set in a centred column, the text within it is justify-aligned (both edges flush), not centre-aligned line by line. This is a deliberate rule: centred columns are about position on the page; their internal text is justified for readability.

**Bordered containers.** The mechanism diagram, the questions grid, the editions grid, and the specimen verdict all share the same construction: a 1px ink border around the outside, 1px rule dividers between cells, no border radius, no shadow, no padding shenanigans. The grid is the design.

**Removed elements from prior iterations.** The sealed envelope artefact, the wax seal SVG, the two-ring brand mark, the magazine masthead three-cell row with the date chip, and the hero illustration of two figures on a bench. All five of these have been removed. The drop cap remains permissible inside the Method essay and other long-form essays only; it is not a generic section opener anywhere else.

## Voice in copy

The copy is written in the voice of a thoughtful adult speaking to another thoughtful adult about a serious question. Short declarative sentences. The reader is not told what to feel; the page lets the typography handle the emotional weight.

**The tagline.** The product's tagline is `Decide slowly, well.` set with `well.` italicised in wine. The earlier formulation (`Decide together, slowly, well.`) has been retired because it leaned toward couples and families and read slightly off for the solo user. The current tagline is universal: a solo decision-maker decides slowly and well; a couple does the same; a family does the same. The brand statement applies cleanly to all three.

**The kicker.** Above the headline on the homepage, a small uppercase kicker reads `A decision tool for solo, couples, and families.` Audience is named directly so the visitor knows in the first three seconds who the tool is for. The kicker is not optional; it is what makes the product immediately legible.

**The mechanism line.** Beneath the tagline, an italic serif subhead reads `A duration you choose. One verdict, prepared and revealed at the end.` This is the mechanic in one sentence. It earns its placement as the second-largest type element on the page.

**Specific rules followed throughout:**

- No exclamation marks anywhere.
- No "you" used in marketing-pump senses ("You'll love this!"). "You" is used only when the page is directly addressing the reader about something they are actually about to do.
- No urgency tactics. No "limited time," no countdown timers, no "join now and save."
- No marketing chip claims ("Used by 10,000 couples"). The page does not claim what cannot be honestly claimed.
- No bullet lists in the marketing copy. Lists belong in feature comparisons (the editions section) and FAQs, not in narrative.
- Italic emphasis only on the emotional word in each headline. The italic is consistent: wine colour, regular weight, and never more than one italic accent per headline.
- Numbered references throughout: § 1 to § 6 for sections, № 01 to № 12 for questions, № 01 to № 06 for FAQ items, Decision №0047. The numbering signals that the document is a structured artefact, not a hero scroll.
- No emdashes and no endashes anywhere on the public surface. Replacement is the middle-dot `·`, the colon, or the semicolon.

## Specific surfaces

The hero on the homepage is centred. A small uppercase kicker names the audience (`A decision tool for solo, couples, and families`). The headline below is set in Newsreader at clamp(36px, 4.4vw, 56px) with `well.` in italic wine. An italic serif subhead at 19px sits beneath as the mechanic line. A justified body paragraph at 15px in a 480px centred column explains the loop in plain language. A single ink button reads `Start a decision`. There is no hero illustration. The hero is typography and one button on white.

The three-step strip directly beneath the hero explains the loop: `Compose the question`, `Vote each evening`, `Read the verdict`. Each step has a wine `Step 0N` number in mono uppercase, a Newsreader title at 17px, and a 13px sans body paragraph. Three columns, equal width, separated by whitespace not by rules.

The questions grid is a 3×4 ruled grid of twelve real example decisions, each in its own cell. Each cell shows a mono number (`№ 01` to `№ 12` in wine), the question in Newsreader at 17 to 24 pixels with the loaded word italicised in wine, and a footer rule carrying the category and the chosen duration in mono. Durations vary deliberately from 14 to 90 days, so the duration flexibility is demonstrated by example rather than by explainer copy.

The Method essay is the strongest editorial moment. A single column at 760 pixels wide, set in Source Serif 4 at 19.5 pixels, centred kicker, centred Newsreader title with italic accent. Internal body paragraphs are justify-aligned. A lede paragraph may carry a wine drop cap. A pullquote is treated as a large Newsreader italic block with a 3-pixel wine rule on the left. The essay argues for the design decision (time over a single conversation) in plain prose.

The specimen verdict reproduces a real verdict as if it were a reproduced artefact in the publication. A header bar in mono with the decision identifier, the format, the vote count, and the conclusion date. A large Newsreader question. Two verdict cards side by side, separated by a hard rule, with the verdict in 64-pixel Newsreader (wine roman for partner A, rose italic for partner B). A statistics strip. An analysis block. A conversation prompt in large italic Newsreader.

The vote-today page composes the same grammar around a single question. A breadcrumb at the top, a metadata strip between two rules, an italic time-stamping sentence (`Monday evening, 11 May. Your fourteenth vote.`), the question at 104 pixels in Newsreader, a privacy-explaining byline in italic serif, a progress bar with day ticks, a participants row showing voted-versus-pending status, two large vote buttons set as Newsreader italic words at 120 pixels each (`Yes` and `No`) with a small Source Serif italic descriptor underneath, an optional note textarea with a pre-filled sample note, and a commit row with the record button and a mono countdown to the verdict.

The verdict-reveal page is the analogue at the closing date. Same typography. The two records reveal simultaneously. The five-layer analysis (agreement rate, conviction trajectory, theme extraction with frequencies, synthesis paragraph, conversation prompt) follows beneath.

## Migration mapping for Claude Code

Apply the following find-and-replace patterns across every file listed under "Files requiring update" below. Run each replacement in order. After each replacement, verify the file still renders without layout regressions before proceeding to the next.

**Colour values (CSS and inline styles):**

```
#f5f0e8  →  #ffffff      (paper background, warm bone to pure white)
#ede5d4  →  #fafaf8      (paper-deep, replaced or omitted)
#fbf8f2  →  #ffffff      (surface, replaced by pure white)
#a14a2c  →  #722F37      (clay primary accent to wine)
#7a3520  →  #561F26      (clay-deep to wine-deep)
#e9d4c5  →  #f4e6e8      (clay-soft to wine-soft)
#d4ccbd  →  #e8e6e1      (rule, warm to neutral on white)
#1c1a17  →  #0a0a0a      (ink, slightly cooler near-black for white background)
```

**CSS variable names (rename across `styles.css` and any inline `<style>` blocks):**

```
--clay        →  --wine
--clay-deep   →  --wine-deep
--clay-soft   →  --wine-soft
```

Any class names that reference clay (e.g. `.text-clay`, `.bg-clay`, `.border-clay`) must be renamed to the wine equivalent. Likewise any utility classes or component variants.

**Tagline (find across all HTML files):**

```
"Decide together, slowly, well."           →  "Decide slowly, well."
"Decide together, slowly, well"            →  "Decide slowly, well"
"decide together, slowly, well"            →  "decide slowly, well"
```

**Audience phrasing (find across all HTML files):**

```
"for couples"                              →  "for solo, couples, and families"
"for couples and families"                 →  "for solo, couples, and families"
"a couples product"                        →  "a decision tool for solo, couples, and families"
"for two"                                  →  "for solo, couples, and families"
```

The phrase `Decisions, for two.` (which was an earlier tagline used briefly) must be removed entirely.

**Brand name (find any residual references):**

```
"Mull Over"        →  "Counsel.day"
"Mull"             →  "Counsel"      (only inside wordmark contexts)
"mullover.ai"      →  "counsel.day"
```

Most files should already be on Counsel.day, but this catches any stragglers in metadata, comments, or copy.

**Elements to remove entirely (search and delete):**

- Any SVG of a wax seal (typically a circle with a `C·d` monogram or similar)
- Any SVG envelope artefact rendered as a sealed-record container
- Any HTML containing class `two-ring-mark`, `brand-mark`, `logo-rings`, or similar (the two intersecting circles logo)
- Any element with class `masthead-date-chip` or comparable (the dated chip in the three-cell masthead)
- Any element with class `magazine-masthead`, `masthead-three-cell`, or comparable (the three-cell masthead layout itself; replace with a simple nav bar)
- Any hero illustration of `two figures on a bench` or `figure-and-caption` (replaced by typography-only hero)

If unsure whether a given element fits one of these patterns, do not delete; flag the file path in a comment and ask before proceeding.

## Files requiring update

Apply the colour scheme update, the tagline change, the audience expansion, the brand-name sweep, and the element-removal pass to each of the following files. The admin portal at `admin.html` and `admin-app.js` is explicitly out of scope and must not be modified.

**The central stylesheet (highest priority):**
- `styles.css`

**Marketing surfaces:**
- `index.html`
- `homepage.html`
- `about.html` (plus the `about/` directory contents)
- `method.html`
- `why-time.html`
- `distinction.html`
- `family.html`
- `compare.html`
- `faq.html`
- `help.html`
- `security.html`
- `accessibility.html`
- `editorial-standards.html`
- `contact.html`
- `press.html`
- `changelog.html`
- `status.html`
- `journal/` (every file inside, including the hub and individual entries)
- `engineering/` (every file inside)

**Legal surfaces:**
- `privacy.html`
- `terms.html`
- `cookies.html`
- `sub-processors.html`
- `refunds.html`

**Practitioner surfaces:**
- `therapists.html`
- `counsellors.html`

**App surfaces:**
- `start.html`
- `compose.html`
- `decisions.html`
- `decision.html`
- `vote.html`
- `vote-today.html`
- `verdict.html`
- `verdict-reveal.html`
- `account.html`
- `billing.html`
- `invite.html`
- `verify-email.html`

**System pages:**
- `404.html`
- `500.html`
- `maintenance.html`
- `offline.html`
- `session-expired.html`
- `signed-out.html`

**Other:**
- `components.html` (the dev-only component reference page)
- `og-image-generator.html`

**Explicitly out of scope:**
- `admin.html`
- `admin-app.js`
- `business-case.pdf`, `business-case-expanded.pdf`
- `manifest.webmanifest`, `robots.txt`, `sitemap.xml` (unless they contain stale brand-name references)
- The `fonts/` directory
- The `scripts/` directory (unless any JS contains hard-coded clay hex values)

After the pass, run a global grep for `#a14a2c`, `clay`, `Decide together`, `Mull Over`, and any remaining wax-seal or sealed-envelope class names. The grep must return zero results across the in-scope file set before the migration is considered complete.

## What's kept and what's removed

**Kept from the prior editorial direction:**
- Newsreader for display typography
- Source Serif 4 for body prose
- Geist for UI text
- Geist Mono for metadata and labels
- Italic emotional accent on the loaded word in each headline (now in wine, not clay)
- The 12-question grid (3 columns × 4 rows)
- The Method essay framed as `Why a season of voting, and not a single conversation`
- Numbered references throughout (§, №)
- The specimen verdict and its full layout
- Zero border radius on buttons
- No shadows; definition by 1px hairline rules
- The voice rules (no exclamation marks, no urgency tactics, no marketing chip claims, no bullet lists in narrative copy)
- The site-wide ban on emdashes and endashes

**Removed:**
- Warm bone background colour (`#f5f0e8`)
- Clay terracotta accent (`#a14a2c`)
- The magazine masthead three-cell row with dated chip
- The sealed envelope artefact and the wax seal SVG
- The two-ring brand mark
- The "Mull Over" wordmark
- The "Decisions, for two." formulation
- The "Decide together, slowly, well." tagline
- The two-figures-on-a-bench hero illustration
- Drop caps as a generic section opener (retained only inside long-form essays)

## The journey through eight prior iterations

The current direction was arrived at after seven other directions were tried and discarded.

Iteration one tried to make the marketing page feel like a black-and-white editorial journal with EB Garamond and a Roman-numeral table of contents. Discarded because it felt too literary and not enough like a product.

Iteration two tried a futuristic precision instrument aesthetic with IBM Plex Mono, electric blue, registration crosshairs, and a live UTC clock. Discarded because it felt like a developer tool, not a consumer product.

Iteration three tried a premium consumer cream-and-persimmon direction with Fraunces, designed in the spirit of Figma and Second Nature. Discarded because the customer feedback was that it did not look like Figma at all and felt like a generic Claude default.

Iteration four tried Figma directly: pure white, electric indigo, lime accent highlight, big Inter at weight 900, colourful pill chips on every section. Discarded because the customer feedback (correctly) identified that the result was a Gen Z productivity-app aesthetic, mismatched to the emotional state of the target customer and to the premium price point.

Iteration five was a slight retreat from four, with the lime highlight stripped and one indigo accent only. Discarded for the same underlying reason: the chip badges and the geometric sans were still wrong for the niche.

Iteration six was the warm bone editorial direction with clay terracotta accent and a literal magazine masthead. Held for several weeks. Discarded because it became a 2026 default among "considered software" sites and the masthead-and-illustration chrome was doing too much performative literary work.

Iteration seven attempted a sealed-record register: registered postal aesthetic with sealed envelopes, wax seals, file references, and date stamps. Rejected as clinical, weird, and over-engineered. The mechanism it visualised was correct; the register around it was not.

Iteration eight (this one) starts from white. Pure white background, wine accent, the wordmark as the entire brand identity, the audience named in the kicker line, the tagline reduced to `Decide slowly, well.` The page leads with the product description so a visitor knows what the tool does in the first three seconds. Editorial restraint is retained but the cream-paper and magazine-masthead chrome that pushed the prior iteration toward literary atmosphere is gone. This is the direction we are holding.

The principle to remember: any future redesign must start from the question `what visual register would the customer expect from a product at this price point dealing with this emotional weight, and does the design make it immediately clear what the tool does?` The answer is consistent: white, considered, premium consumer; serif-led display with one disciplined accent; immediately legible audience and mechanism. Not loud, not playful, not minimal-Scandinavian, not editorial-magazine, not sealed-record.
