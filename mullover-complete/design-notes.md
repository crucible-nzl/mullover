# Mull Over: Design Notes

The design specification for the current marketing surface. Read alongside `homepage.html`.

## The single design principle

The visual language must match the emotional state of the customer at the moment of purchase. The customer is a thoughtful adult, in their thirties or forties, carrying a real decision they have been circling for weeks. They are tired, anxious, hopeful, and quietly hoping the product will not be silly or shallow. Every design choice is downstream of that principle.

The design is therefore quiet, considered, slow, and editorial. It avoids the visual grammar of generic SaaS products (vibrant chip colours, big shouty typography, illustrated mascots, urgency tactics, gradient backgrounds) because those signal a category the customer does not want to be in. It also avoids the visual grammar of wellness products (sage palettes, soft serifs, beach photography, mindful platitudes) because those signal a category that does not respect the seriousness of the question. It positions instead as a small literary publication that happens to also be software, with the visual rigour of a printed editorial product and the interaction precision of a well-built consumer app.

## Typography

Four families. None of them are Inter, Fraunces, or the other defaults Claude reaches for in early iterations.

Newsreader, for display.
A contemporary editorial serif with optical sizing, used at 30 to 120 pixels for headlines, the question on the vote page, the verdicts, the section titles, and the vote buttons. Italic is used as the emotional accent, set in clay colour, on the loaded word in each headline. The italic is doing real semantic work, not decoration.

Source Serif 4, for body prose.
A modern transitional serif designed for screen reading at 17 to 22 pixels. The Method essay on the homepage and the byline paragraphs throughout are set in this. Optical sizing handles the jump from small caption to large lede.

Geist, for sans-serif user-interface text.
Used for buttons, navigation, and very small labels. Always 13 to 15 pixels. The sans is intentionally restrained; it is doing utility work, not display work.

Geist Mono, for technical labels and timestamps.
Used for the mono kicker labels (the small uppercase letterspaced eyebrows), the section numbers (§ 1, § 2), the decision identifiers (№0047, №0048), the metadata strips, the day counts in the progress bar labels, the keyboard shortcut indicators on the vote buttons (Y, N), and the colophon footer. Mono carries the technical voice while the serifs carry the editorial voice.

The combination is deliberate: serif for content, sans for tools, mono for metadata. Each typeface has a job and never strays into the others.

## Palette

The full palette in CSS variables:

- paper: #f5f0e8 (warm bone background)
- paper-deep: #ede5d4 (slightly deeper warm cream for masthead and progress backgrounds)
- surface: #fbf8f2 (a touch lighter than paper, for the inside of bordered containers)
- ink: #1c1a17 (warm near-black, never pure black)
- ink-soft: #3a3530 (warm soft text)
- muted: #6b635a (warm grey for secondary text)
- subtle: #9b9286 (warm grey for tertiary text)
- rule: #d4ccbd (the standard horizontal rule)
- rule-strong: #1c1a17 (the heavy rule, used for masthead and container borders)
- clay: #a14a2c (the primary accent: terracotta-orange, used for italic accents in headlines, kicker labels, section eyebrows, the first partner's verdict colour, and call-to-action backgrounds on hover)
- clay-deep: #7a3520 (deeper clay for active states)
- clay-soft: #e9d4c5 (a soft clay tint for the selected vote button text on dark backgrounds)
- rose: #c4806b (the second partner's accent: dusty rose, used for the second verdict in the specimen and for the partner-B status indicators)
- olive: #5a6147 (used only in the hero illustration as the foreground grass)

No lime, no coral pop, no electric indigo, no neon anything. No greys outside the warm range. The palette is intentionally narrow.

The clay-rose pair is doing the work the original amber-and-rose brand pair did, but pushed into the editorial register: deeper, more saturated, less Instagram-friendly.

## Layout grammar

The page is composed as a small publication.

A masthead at the top, set up as a three-column grid (Vol. I · Edition One on the left, the wordmark in the centre, the date on the right) with a heavy two-line rule beneath it. The wordmark is "Mull" in Newsreader regular and "Over" in Newsreader italic. This is literally a magazine masthead.

A sticky navigation bar beneath the masthead, with a row of plain text links in Geist sans (no chip badges, no underline-on-hover hover effects beyond a 1px clay underline, no icons), and a single primary call-to-action button on the right. The CTA button is rectangular, ink background, paper text, no border radius. Buttons everywhere in the design have zero border radius, because rounded corners are a SaaS tell.

The body of the page is a sequence of sections divided by a 1px rule. Each major section opens with a two-column section header: a mono kicker on the left ("§ 1 · The Method") and a large Newsreader title on the right with an italic accent word. The mono kicker uses the silcrow (§) and an em-style space-dot-space separator, which is the typographic rhythm of a printed editorial.

Within each section, content is laid out at one of three widths: a constrained reading column at around 760 to 880 pixels for prose-heavy sections (the Method essay, the FAQ), a medium column at around 1080 pixels for the specimen and the editions, and a wide column at 1280 pixels for the diagrams. Different widths for different jobs; the reading widths are tighter than typical SaaS pages.

Bordered containers (the three-panel mechanism diagram, the questions grid, the editions grid, the specimen verdict) all share the same construction: a 1px ink border around the outside, 1px rule dividers between cells, no border radius, no shadow, no padding shenanigans. The grid is the design.

## Voice in copy

The copy is written in the voice of a thoughtful adult speaking to another thoughtful adult about a serious shared question. Short declarative sentences. The reader is not told what to feel; the page lets the typography handle the emotional weight.

Specific rules followed throughout:

- No exclamation marks anywhere.
- No "you" used in marketing-pump senses ("You'll love this!"). "You" is used only when the page is directly addressing the reader about something they are actually about to do.
- No urgency tactics. No "limited time," no countdown timers, no "join now and save."
- No marketing chip claims ("Used by 10,000 couples"). The page does not claim what cannot be honestly claimed.
- No bullet lists in the marketing copy. Lists belong in feature comparisons (the editions section) and FAQs, not in narrative.
- Italic emphasis only on the emotional word in each headline. The italic is consistent: clay colour, regular weight, and never more than one italic accent per headline.
- Numbered references throughout: § 1 to § 6 for sections, № 01 to № 12 for questions, № 01 to № 06 for FAQ items, Decision №0047, Plate I. The numbering signals that the document is a structured artefact, not a hero scroll.

The voice is sustained on the voting page: the question is set at 104 pixels in Newsreader with italic accent on the loaded word, the byline beneath it explains the privacy mechanism in plain language ("A private vote, in a decision held jointly between two participants"), and the note prompt is phrased as an invitation rather than a system instruction ("A sentence or two, if a thought has landed today").

## Specific surfaces

The hero on the homepage pairs a content column on the left with a representative illustration of two figures on a bench on the right, the figures in clay and dusty rose. The illustration is intentionally simple, not photorealistic, and treated as a figure-and-caption ("Two people, one question · Plate I") rather than a hero image. The illustration was chosen instead of a stock photograph because a photograph would have to be of specific real people, which would either be inauthentic (stock) or impose a particular demographic identity on the customer. The illustration is universal.

The mechanism diagram is three bordered panels in a row, separated by hard rules. The first two panels are paper-coloured with sealed vote placeholders rendered as ellipses and a "⌬ Sealed" line. The third panel inverts to ink black, revealing both verdicts in rose and clay, plus a small synthesis snippet in a sub-panel.

The questions grid is a 3×4 ruled grid of twelve real example decisions, each in its own cell. Each cell shows a mono number, the question in Newsreader with the loaded word italicised in clay, and a footer rule carrying the category and the chosen duration in mono. Durations vary deliberately from 14 to 90 days, so the duration flexibility is demonstrated by example rather than by explainer copy.

The Method essay is the strongest editorial moment. A single column at 760 pixels wide, set in Source Serif 4 at 19.5 pixels, with a centred small kicker, a centred Newsreader title with italic accent, a lede paragraph with a clay drop cap, and a pullquote treated as a large Newsreader italic block with a 3-pixel clay rule on the left. The essay argues for the design decision (time over a single conversation) in plain prose. This is the section that earns the premium price tag visually, by showing that the makers think clearly about the product.

The specimen verdict reproduces a real verdict as if it were a reproduced artefact in the publication. A header bar in mono with the decision identifier, the format, the vote count, and the conclusion date. A large Newsreader question. Two verdict cards side by side, separated by a hard rule, with the verdict in 64-pixel Newsreader (clay roman for partner A, rose italic for partner B). A statistics strip. An analysis block with a drop cap. A conversation prompt in large italic Newsreader.

The vote page demo is the same layout grammar but composed around a single question. A breadcrumb at the top, a metadata strip between two rules, an italic time-stamping sentence ("Monday evening, 11 May. Your fourteenth vote."), the question at 104 pixels, a privacy-explaining byline, a progress bar with day ticks, a participants row showing voted-versus-pending status, two large vote buttons set as Newsreader italic words at 120 pixels each ("Yes" and "No") with a small Source Serif italic descriptor underneath, an optional note textarea with a pre-filled sample note in real-feeling prose, and a commit row with the record button and a mono countdown to the verdict.

## The journey through six prior iterations

The current direction was arrived at after six other directions were tried and discarded. Each was discarded for a specific reason, recorded here as a guide for future iteration.

Iteration one tried to make the marketing page feel like a black-and-white editorial journal with EB Garamond and a Roman-numeral table of contents. Discarded because it felt too literary and not enough like a product.

Iteration two tried a futuristic precision instrument aesthetic with IBM Plex Mono, electric blue, registration crosshairs, and a live UTC clock. Discarded because it felt like a developer tool, not a couples product.

Iteration three tried a premium consumer cream-and-persimmon direction with Fraunces, designed in the spirit of Figma and Second Nature. Discarded because the customer feedback was that it did not look like Figma at all and felt like a generic Claude default.

Iteration four tried Figma directly: pure white, electric indigo, lime accent highlight, big Inter at weight 900, colourful pill chips on every section. Discarded because the customer feedback (correctly) identified that the result was a Gen Z productivity-app aesthetic, mismatched to the emotional state of the target customer and to the premium price point.

Iteration five was a slight retreat from four, with the lime highlight stripped and one indigo accent only. Discarded for the same underlying reason: the chip badges and the geometric sans were still wrong for the niche.

Iteration six (this one) starts from the customer rather than from the design reference. Editorial typography, warm bone palette, single-column reading widths, numbered sections, italic emotional accents. This is the direction that holds.

The principle to remember: any future redesign must start from the question "what visual register would the customer expect from a product at this price point dealing with this emotional weight." The answer is consistent: small, considered, premium consumer; serif-led; warm-toned; quietly confident. Not loud, not playful, not minimal-Scandinavian, not anything else that has a strong category signal already.
