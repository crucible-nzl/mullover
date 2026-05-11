# Mull Over

Project archive, captured Monday 11 May 2026.

A small private-voting product for couples facing decisions a single conversation cannot resolve. Both partners vote privately each evening for a duration of their choosing. On the final day both verdicts unlock together alongside an AI analysis of where they actually disagreed.

Built by James Graham at RCONZ Limited, Christchurch, New Zealand. Domain mullover.ai. Companion product to realtor.co.nz and calculate.co.nz in the RCONZ portfolio.

## What is in this archive

`homepage.html`
The current marketing homepage, rebuilt in a small-publication editorial style. Pure HTML and CSS with two pages routed by URL hash: the marketing landing at `/#/`, and a working voting page demo at `/#/vote` showing a Yes / No vote on Day 14 of a 30-day decision. Set in Newsreader for display, Source Serif 4 for body prose, Geist for UI, Geist Mono for technical labels. Palette is warm bone with terracotta-clay and dusty-rose accents. Open it in any browser; no build step.

`product-brief.md`
The condensed reference for the product: the unique selling proposition, the target customer, the market, the pricing model, the eight question formats, the divergence analysis (the "five layers"), the go-to-market sequence, and the position relative to comparable products (couples apps, journaling apps, decision tools, therapy-adjacent products). Read this first if you want the whole story in twenty minutes.

`design-notes.md`
The design system specification for the new editorial direction. Typography pairings, the warm bone palette, the layout grammar, the editorial voice in copy, and the deliberate choices that pull the product away from generic SaaS aesthetics. Includes the journey through six prior design iterations and why each was discarded.

`business-case.pdf` (68 pages)
The full business case in editorial form. The product vision, the market analysis, the unit economics, the channel plan, the operational plan, the risks. Magazine-style typography. The most polished long-form document in the archive.

`business-case-expanded.pdf` (64 pages)
An earlier, denser version of the business case with additional sections that were trimmed from the final editorial version: a probability table for each marketing channel, the full Meta Ads playbook with 2026 benchmark cost-per-action figures, a more detailed B2B teams section, and expanded competitor research notes. Useful if you want the raw material rather than the polished narrative.

## How to read these in order

If you have ten minutes: open `homepage.html` and scroll through the page. The product is fully explained in the marketing copy, and the voting page demo shows the daily interaction model.

If you have an hour: read `product-brief.md` first for the framing, then open `homepage.html` and read it against the brief. Notice which claims on the page connect to which sections of the brief.

If you have a half day: read `business-case.pdf` cover to cover, then the brief, then the design notes. The PDF contains the full strategic argument; the brief and the notes are summaries.

## What is intentionally not in this archive

The application itself (the React Native PWA, the FastAPI backend, the database schema, the deployment scripts) lives in a separate working repository and was not included here. This archive is the marketing surface and the strategic context, not the codebase.

## The current state

The product is in late prototype. The marketing homepage is in its seventh design iteration after six earlier directions were tried and discarded (productivity SaaS, futuristic instrument, editorial journal, three Figma-style attempts, and finally this editorial-publication direction which is the one we are keeping). The application is partly built. The first paying customers will be drawn from the founder's personal network, then from organic SEO and partnerships with practising couples therapists in New Zealand and Australia, with paid acquisition through Meta following only once the unpaid funnel has been validated.

The single sample decision used throughout the marketing surfaces, Decision Number 0047 (the country place question, James and Alexandra), is illustrative; the names are not real but the structure of the analysis is exactly what the product will produce.
