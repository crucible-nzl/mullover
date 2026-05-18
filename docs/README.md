# Counsel.day

Project archive, captured Monday 11 May 2026.

A small private-voting product for couples facing decisions a single conversation cannot resolve. Both partners vote privately each evening for a duration of their choosing. On the final day both verdicts unlock together alongside an AI analysis of where they actually disagreed.

Built by James Graham in Christchurch, New Zealand. Domain counsel.day. Companion product to realtor.co.nz and calculate.co.nz, from the same workshop.

## Repository layout

```
_Counsel.day.ai/
├── docs/                                Prose, strategy, design
│   ├── README.md                        This file
│   ├── product-brief.md                 The product in twenty minutes
│   ├── design-notes.md                  Design system and project-wide rules
│   └── COUNSEL.DAY_SEO_STRATEGY.md         Organic search positioning and content architecture
│
└── counsel-day-complete/                   Deliverables, fonts in place, openable in a browser
    ├── homepage.html                    The marketing site and product demo
    ├── business-case.pdf                (68 pages) the polished editorial business case
    └── business-case-expanded.pdf       (64 pages) the longer raw version with more appendices
```

## What is in each file

`docs/product-brief.md`
The condensed reference for the product: the unique selling proposition, the target customer, the market, the pricing model, the eight question formats, the divergence analysis (the "five layers"), the go-to-market sequence, and the position relative to comparable products (couples apps, journaling apps, decision tools, therapy-adjacent products). Read this first if you want the whole story in twenty minutes.

`docs/design-notes.md`
The design system specification for the editorial direction and the project-wide rules that everything we ship is held to. Typography pairings, the warm bone palette, the layout grammar, the editorial voice in copy, the deliberate choices that pull the product away from generic SaaS aesthetics, the journey through six prior design iterations, the engineering and security posture, the market and currency stance, and the SEO standard.

`docs/COUNSEL.DAY_SEO_STRATEGY.md`
Organic search positioning, keyword research findings, and content architecture for counsel.day. Source data is the Google Ads Keyword Planner pulls from May 2026 across 2,253 keywords. Identifies four cornerstone keywords, the eight theme clusters, the proposed URL architecture, the phased implementation roadmap, and the KPIs that matter. The SEO rule in `design-notes.md` references this document as the canonical source.

`counsel-day-complete/homepage.html`
The current marketing homepage, in a small-publication editorial style. Pure HTML and CSS with three pages routed by URL hash: the marketing landing at `/#/`, the in-depth method reference at `/#/method`, and a working voting page demo at `/#/vote` showing a Yes / No vote on Day 14 of a 30-day decision. Set in Newsreader (display + body) and Manrope (UI + labels). Palette is cream-and-paper warm neutrals with Forest green and Burgundy accents (The Knot mark). Open it in any browser; no build step.

`counsel-day-complete/business-case.pdf` (68 pages)
The full business case in editorial form. The product vision, the market analysis, the unit economics, the channel plan, the operational plan, the risks. Magazine-style typography. The most polished long-form document in the project.

`counsel-day-complete/business-case-expanded.pdf` (64 pages)
An earlier, denser version of the business case with additional sections that were trimmed from the final editorial version: a probability table for each marketing channel, the full Meta Ads playbook with 2026 benchmark cost-per-action figures, a more detailed B2B teams section, and expanded competitor research notes. Useful if you want the raw material rather than the polished narrative.

## How to read these in order

If you have ten minutes: open `counsel-day-complete/homepage.html` and scroll through it, then click "The method" in the top nav. The product is fully explained in the marketing copy and the method page.

If you have an hour: read `docs/product-brief.md` first for the framing, then open the homepage and read it against the brief. Notice which claims on the page connect to which sections of the brief.

If you have a half day: read `counsel-day-complete/business-case.pdf` cover to cover, then the brief, then the design notes. The PDF contains the full strategic argument; the brief and the notes are summaries.

## What is intentionally not in this archive

The application itself (the React Native PWA, the FastAPI backend, the database schema, the deployment scripts) lives in a separate working repository and was not included here. This archive is the marketing surface and the strategic context, not the codebase.

## The current state

The product is in late prototype. The marketing homepage is in its seventh design iteration after six earlier directions were tried and discarded (productivity SaaS, futuristic instrument, editorial journal, three Figma-style attempts, and finally this editorial-publication direction which is the one we are keeping). The application is partly built. The first paying customers will be drawn from the founder's personal network, then from organic SEO and a referral program for practitioners (therapists, counsellors, coaches) who recommend the tool to clients, with paid acquisition through Meta following only once the unpaid funnel has been validated.

The single sample decision used throughout the marketing surfaces, Decision Number 0047 (the country place question, James and Alexandra), is illustrative; the names are not real but the structure of the analysis is exactly what the product will produce.

---

## Project conventions · non-negotiable

These rules apply to every file in the repo, every commit, every email, every PR, every comment, every doc:

1. **No em-dashes (U+2014) and no en-dashes (U+2013).** Use `·` (middle dot U+00B7), `:`, or `;`. Brand-verify Check 8 fails any commit that introduces one, project-wide (HTML, CSS, JS, TS, MD, PY, SQL, JSON, YAML, SH, PS1). See [BRAND.md §7](BRAND.md) for the full rule.
2. **No clinical claims.** James is a data professional, not a therapist. The product is not validated by clinicians.
3. **No "Claude" or "Anthropic" in user-facing marketing copy.** The AI vendor is abstracted as "our AI synthesis tool". Legal pages (privacy.html, sub-processors.html, security.html, terms.html) name Anthropic explicitly · this is mandatory under GDPR Article 28 sub-processor disclosure and the equivalent rules under UK GDPR, NZ Privacy Act, and Australian Privacy Act.
4. **No refund-window or change-of-mind refund language.** Refunds are limited to technical defects on our part (§02 of refunds.html) and to whatever local consumer-protection law mandates. See [refunds.html](../counsel-day-complete/refunds.html).
5. **USD only worldwide.** Every price shown as `$X USD`, never bare `$X`. Brand-verify Check 9 enforces.
6. **GA4 + GTM on every page.** Brand-verify Check 12 enforces. See [BRAND.md §13](BRAND.md).
7. **All commits must pass `counsel-day-complete/scripts/brand-verify.ps1` with exit code 0.**
