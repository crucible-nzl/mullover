# What makes an exceptional SaaS landing page · findings + audit

Written 16 August 2026, ahead of the Reddit/Facebook traffic push. Part 1 is
the research; Part 2 audits counsel.day's homepage against it; Part 3 is the
prioritised work list. Sources at the end.

---

## Part 1 · The principles, in order of leverage

### 1. One page, one job, one primary action
The single most replicated finding in conversion research: **pages with a
single call to action convert at ~13.5% on average; adding a second or third
drops that to ~11.9%, and five or more lands ~10.5%** (KlientBoost's landing
page corpus). The mechanism is choice overload: every extra option raises
cognitive load and the easiest choice becomes leaving. Secondary actions can
exist, but must be visually subordinate (text link vs button), and there
should be exactly one *dominant* action above the fold.

### 2. The five-second test
A first-time visitor decides in roughly five seconds whether this page is for
them. In that window they must be able to answer: *what is it, who is it for,
what do I get, what do I do next.* Anything on screen that does not serve one
of those four answers is working against them. Headline copy is the
highest-impact element to get right, ahead of CTA wording, CTA placement, and
the hero visual (alfdesigngroup's hero test ordering).

### 3. Headlines state the outcome, not the category
"Decide slowly. See the pattern." is voice; the research says pair voice with
an outcome a cold visitor can repeat back. High-performing SaaS H1s are
concrete, jargon-free, and about the visitor's result, with the product name
carried by the logo rather than spent in the H1.

### 4. Show the product doing the thing
The strongest hero visual is the product producing its outcome · a real
verdict, a real chart, a real record · not an abstract illustration. Visitors
trust what they can see working. For Counsel.day this is an unusual strength:
the two-lane sealed-votes diagram IS the product explanation, and the
published real verdict is proof no competitor can fake.

### 5. Whitespace is an active element
Negative space reduces cognitive load, improves reading speed, and makes the
one important thing unmissable. "Busy" is not a style problem, it is a
comprehension problem: two elements competing side by side halves the
attention each receives. One idea per band, generous space between bands, and
each band earning its scroll.

### 6. Social proof, stacked early · but only real proof
2025-26 pattern: trust signals moved INTO the first viewport (logo bars,
review counts, quotes beside the hero). For a pre-launch product the honest
substitutes are: the founder's named track record, the published real verdict,
the engineering transparency pages, and the privacy posture. **No invented
testimonials, ever** · one fabricated quote discovered costs more than a
hundred real ones earn.

### 7. Kill the risk at the moment of action
The CTA's neighbours matter more than its colour: "free, no card required"
adjacent to the button consistently outperforms the same words elsewhere on
the page. Forms and card fields are cognitive load; the fewer commitments
visible at the first action, the better.

### 8. Message match
The page must repeat the promise that brought the click. Traffic from a
Reddit thread about deciding on a second child should land on copy that
speaks to weighing a hard question together · which is why the use-case pages
exist; the homepage only has to catch the generic arrival.

### 9. Speed and mobile are table stakes
Most social traffic is mobile. Every principle above applies at 390px first:
the hero must state its case in one thumb-screen, and heavy hero media that
delays LCP costs more than it communicates.

---

## Part 2 · counsel.day homepage, audited against each

| # | Principle | Verdict on our homepage |
|---|---|---|
| 1 | One dominant CTA | **Fails.** Above the fold a visitor sees: nav "Sign up · free" button, the wine FREE pill (links to signup), and the product card's "Start a decision" + "See how it works". Four competing actions, three of them button-weight. |
| 2 | Five-second test | **Partial.** "Decide slowly. See the pattern." + lede answers *what*; but the eye is immediately split between the product card and the diagram, so *what do I do next* has two answers. |
| 3 | Outcome headline | **Partial.** The H1 is distinctive but abstract; the lede carries the outcome. Worth testing an outcome-forward variant later; not the current bottleneck. |
| 4 | Show the product | **Our strongest asset, under-used.** The two-lane red/green diagram is the product in one picture, and it was squeezed into a right-hand column at ~two-thirds of its possible size, competing with a text card. Fixed in the same PR as this doc: diagram now full-width and primary, card below it. |
| 5 | Whitespace / one idea per band | **Fails in the hero, decent below.** The hero band held two ideas side by side (offer card + method picture). Below: hook-band → three-step → quote → closing → share is a reasonable single-idea cadence, though the total page is long. |
| 6 | Real social proof early | **Missing.** Nothing in the first viewport says "a real person with a track record built this and ran it on a real decision." The founder line + link to the real verdict is the honest, available proof. |
| 7 | Risk reversal at the CTA | **Present but detached.** "First Solo decision free · no card" lives in the pill and the card price line; keep it adjacent to whichever button survives as primary. |
| 8 | Message match | **Good.** Use-case pages exist for the sharpest traffic; homepage stays generic-arrival. |
| 9 | Mobile / speed | **Good bones.** Static HTML, preloaded fonts, SVG visuals. The hero stack change also fixes the mobile order (diagram no longer collapses below the card). |

## Part 3 · Prioritised work list

1. **DONE in this PR** · make the mechanism diagram the hero's single focus,
   full width; move the Decision card below it, centred and framed. One idea
   per band restored.
2. **CTA hierarchy** (next, small): one wine button above the fold · "Start a
   decision" on the card. Demote the pill to a text-weight reassurance line
   near the H1 ("Your first Solo decision is free · no card required") rather
   than a second button-weight object, and let the nav signup stay as the
   persistent fallback. Requires a copy decision, so not bundled here.
3. **Honest proof strip** (small): one line under the diagram · "Built by the
   maker of calculate.co.nz · run first on our own decision · [read the real
   verdict]". Links to /verdict and /about/james-graham. Real, verifiable,
   pre-launch-honest.
4. **Page length audit** (later): hook-band, three-step, quote-band, closing,
   share-block · candidates to merge or cut once analytics (now first-party)
   show where scrolling stops.
5. **Headline A/B** (later, once traffic exists): current voice-led H1 vs an
   outcome-led variant. The /o.html rotator infrastructure already exists for
   exactly this.

## Sources

- [KlientBoost · 51 high-converting SaaS landing pages](https://www.klientboost.com/landing-pages/saas-landing-page/) · single-CTA conversion data
- [GetUplift · the psychology of a CTA button / choice overload](https://getuplift.co/the-psychology-of-a-cta-button/)
- [Unbounce · the state of SaaS landing pages](https://unbounce.com/conversion-rate-optimization/the-state-of-saas-landing-pages/)
- [ALF Design Group · SaaS hero section best practices](https://www.alfdesigngroup.com/post/saas-hero-section-best-practices) · hero element test ordering, early social proof
- [UFO Rocks · landing page design best practices](https://www.uforocks.com/blog/landing-page-design-best-practices/) · single dominant above-fold CTA
- [Grafit · SaaS landing page best practices](https://www.grafit.agency/blog/saas-landing-page-best-practices)
