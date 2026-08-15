# Handoff · Counsel.day house ads on calculate.co.nz

**Audience: the Claude Code session working in the calculate.co.nz project.**
This document is self-contained · everything you need is in here plus the 19
banner files that travel with it (`banners/counselday-*.html`). Written
2026-08-16 by the Counsel.day session; James approved the placement strategy.

## Context, in one paragraph

Counsel.day (counsel.day) is James's decision tool: couples/families/solo
deciders vote privately once per evening on one question for 7-90 days, votes
sealed until the final day, then a written verdict. First Solo decision free,
then $4.99-$19.99 USD per decision. Many calculate.co.nz visitors are standing
in exactly the moment Counsel.day serves (deciding on a second child, a first
home, a redundancy offer) · these placements put the tool in front of them.
It is James's own product: no third party, no data crossing, no tracking
beyond the click.

## The two placement types

1. **In-content module** (the priority · outperforms banners): a short,
   editorial-styled block placed after the calculator's result area (or
   mid-article on guide pages). Build it once as an include, style it to
   calculate.co.nz's own look (do NOT import Counsel.day fonts/colours ·
   it should read as a sibling recommendation, not a foreign ad). Text per
   category is in the table below; link URLs must keep their UTMs.
2. **House banners** (the 19 supplied files): standard sizes 300x250,
   728x90, 320x50 per category. Self-contained HTML, inline styles, no
   external requests, click-through URLs embedded with UTMs. Serve them
   however your ad stack does house inventory: GAM house line items if you
   run GAM; direct includes in self-managed slots otherwise. **Do not edit
   the banner copy** · it is brand-controlled on the Counsel.day side
   (notably: no em-dashes; do not "fix" the middle dots).

## Allocation rules (the economics · do not soften these)

- **Unfilled inventory: 100% house.** Any slot that would render blank or a
  PSA gets a Counsel.day banner. This is free and unlimited.
- **GOLD pages (list below): in-content module always** + banners at full
  house priority in self-managed/remnant slots. Do NOT displace premium
  finance demand: if a gold page's slot is earning real finance CPMs, keep
  the paid ad and rely on the module.
- **SILVER pages: 10% house rotation** maximum, banners only, no module.
- **Everything else (the other ~2,280 calculators): nothing.** A GST
  calculator's impressions are worth nothing to Counsel.day; don't spend
  goodwill there.
- **Excluded outright** (never place, any format):
  `separation-asset-split-calculator.php`, the separation/divorce finance
  guides (`separation-divorce-finances-guide`, `splitting-kiwisaver-
  separation-guide`), and `dog-chocolate-toxicity-calculator.php` (that
  visitor has an emergency). These exclusions are ethical, not commercial ·
  they hold even if the numbers would work.

## GOLD placements · module + banners

| Pages (slugs, .php) | Banner category | Module link target |
|---|---|---|
| baby-number-two · cost-of-a-baby · cost-of-raising-a-child · cost-of-raising-a-child-to-18 · childcare-vs-stay-home · childcare-cost · parental-leave (all 4 variants) · maternity-pay-top-up · school-costs | `kids` | https://counsel.day/deciding-to-have-a-child?utm_source=calculate_co_nz&utm_medium=module&utm_campaign=kids |
| rent-vs-buy · rent-vs-buy-breakeven · first-home-buyer (all 7 first-home-* variants) · moving-costs · cost-of-living-comparison · build-cost-per-square-metre · home-renovation-budget · renovation-cost-per-room · renovation-value-uplift | `home` | https://counsel.day/deciding-where-to-live?utm_source=calculate_co_nz&utm_medium=module&utm_campaign=home |
| redundancy-vs-new-job · redundancy-runway · redundancy-pay · redundancy-entitlement · lump-sum-redundancy-tax · contractor-vs-employee · career-break-investment-impact · ceasing-self-employment · self-employed-replacement-income · self-employed-emergency-fund · first-year-self-employed-tax-bill · business-startup-cost · break-even · pay-rise · pay-rise-lifetime-value · apprenticeship-vs-degree · tertiary-study-budget | `career` | https://counsel.day/deciding-to-change-career?utm_source=calculate_co_nz&utm_medium=module&utm_campaign=career |
| retire-early-vs-work-longer · early-retirement-bridge · partial-retirement · retirement-date · retirement-calculator · retirement-how-long-money-last | `retirement` | https://counsel.day/deciding-alone?utm_source=calculate_co_nz&utm_medium=module&utm_campaign=retirement |
| engagement-ring-budget · wedding-budget | `relationship` | https://counsel.day/deciding-about-the-relationship?utm_source=calculate_co_nz&utm_medium=module&utm_campaign=relationship |
| pet-cost · pet-lifetime-cost | `pets` | https://counsel.day/?utm_source=calculate_co_nz&utm_medium=module&utm_campaign=pets |

**Guide pages (module only, placed mid-article):** comparing-job-offers-guide
(→ career) · cost-of-having-a-baby-nz-guide, cost-of-raising-child-guide,
childcare-costs-subsidies-guide (→ kids) · first-home-buyer-guide,
kainga-ora-first-home-guide, first-home-legal-guide (→ home) ·
how-much-to-retire-nz-guide, guaranteed-retirement-income-guide
(→ retirement) · student-loan-guide (→ career).

## SILVER placements · banners only, 10% rotation

deposit-savings · house-deposit-savings · bridging-loan ·
kiwisaver-first-home-withdrawal · kiwisaver-first-home-vs-keep-invested ·
kainga-ora-first-home-partner (→ home) · notice-period ·
self-employed-take-home · studylink-allowance-eligibility ·
student-loan-overseas + overseas-based · working-holiday-tax (→ career) ·
nz-super trio · drawdown family · annuity-vs-drawdown (→ retirement) ·
wedding-guest-cost · wedding-catering-per-head (→ relationship) ·
pet-food-cost · pet-bond · pet-insurance-vs-savings (→ pets) ·
babysitting-cost · nappy-cost (→ kids) · travel-budget (→ retirement
creative works; or career) · ev-vs-petrol · vehicle-running-cost ·
petrol-vs-public-transport (→ home creative; one-car decisions).

## Module copy per category (use verbatim · tone is deliberate)

- **kids**: "The number says you can. Whether you should is a different kind
  of question · Counsel.day settles it over thirty sealed evenings, one
  private vote a night from each of you. First Solo decision free."
- **home**: "You've run the numbers three times. It was never a numbers
  question. Counsel.day settles the should-we over a season of sealed
  nightly votes · first Solo decision free."
- **career**: "The payout is calculated. The decision isn't. One private
  vote each evening until your answer holds still · Counsel.day, first
  Solo decision free."
- **retirement**: "When you can isn't when you should. Decide it over a
  season, not a Sunday · Counsel.day, one sealed vote a night."
- **relationship**: "You've budgeted the ring. The other question deserves
  thirty sealed evenings · Counsel.day, private until the final day."
- **pets**: "The lifetime cost is the easy part. Whether you're ready is
  the real question · decide it together on Counsel.day, sealed votes,
  one verdict."

## UTM discipline

Every link: `utm_source=calculate_co_nz`, `utm_medium=house_banner` (banners,
already embedded in the files) or `utm_medium=module` (modules),
`utm_campaign=<category>`. Do not add gclid-style params or extra tracking ·
Counsel.day measures arrivals first-party and via GA4; calculate.co.nz needs
no analytics work for this.

## Rollout order

1. The module on the top-10 gold pages: baby-number-two, cost-of-a-baby,
   rent-vs-buy, first-home-buyer, redundancy-vs-new-job, redundancy-runway,
   contractor-vs-employee, retire-early-vs-work-longer, engagement-ring-
   budget, childcare-vs-stay-home.
2. Unfilled-inventory house banners network-wide.
3. Remaining gold modules + banners, then silver rotation.

Questions or anything ambiguous in your codebase's ad stack: flag it back to
James rather than improvising · especially anything that would put a
Counsel.day placement on an excluded page.
