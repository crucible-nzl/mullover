# Mull Over: Product Brief

The condensed reference for the product. Read this for the whole story in twenty minutes.

## The product in one sentence

Both partners vote privately each evening on the same question for a duration they choose; on the final day both verdicts unlock together alongside an AI analysis of where they actually disagreed.

## The unique selling proposition

The only product that separates the voting from the conversation. Every other tool a couple might reach for (a journal, a relationship app, a couples-therapy session, a notes app, a spreadsheet) collapses both into the same moment, which contaminates the data. Mull Over deliberately splits them: thirty private votes per partner across the period of their choosing, all sealed, then revealed together at the end with an analysis that names the actual axis of their disagreement.

The mechanism cannot be replicated by a journaling app, by therapy alone, or by a productivity tool, because the value depends on the privacy guarantee being absolute and the temporal spread being structural. A user cannot achieve the same outcome by writing in a notebook (no synthesis) or by talking to their partner more (anchoring), or by going to therapy (which is the conversation, not the data underneath it).

## The target customer

Couples in their thirties and forties facing a meaningful joint decision they have been circling for weeks or months without resolution. The decision is typically one of the following classes, in rough order of frequency:

- Family and reproduction: having a baby, having a second child, fertility treatment, schooling
- Home and place: buying a house, moving cities or countries, moving closer to family, downsizing
- Career: leaving a job, taking a role, changing careers
- Partnership itself: getting married, getting separated, opening or closing the relationship

The emotional state on arrival is consistent: tired, anxious, hopeful, sometimes slightly ashamed they have not been able to resolve the question themselves. They are well-educated, capable, articulate, and accustomed to making other decisions confidently. They are in the demographic where premium consumer apps (Calm, Headspace, Day One, Notion) are unremarkable purchases.

A second customer segment, smaller but high-value, is the practising couples therapist who refers clients to the product as a preparation tool. The first three sessions of every new couple are typically spent doing this kind of private signal capture manually; the product does it before the first session.

## The market

Estimated TAM in the English-speaking developed markets (US, UK, Canada, Australia, New Zealand) is roughly 60 million couples in the target demographic, of whom approximately 20 percent will face at least one decision of this magnitude in any given year. Realistic SAM (those who would consider a premium consumer app to help with the decision) is more like 2 to 4 million annual decisions. SOM in the first three years, targeting word-of-mouth growth and therapist referrals, is in the low tens of thousands of decisions. The full numbers are in the business case PDF.

Adjacent reference points:

- Calm: 100 million downloads, around 4 million paying subscribers, USD 250 million ARR at peak
- Headspace: similar scale, USD 100 million plus ARR, premium consumer pricing
- Day One: smaller, premium consumer journaling, sustained low-eight-figure ARR
- Paired (couples app): around 1 million downloads, freemium model, much lower ARPU than Calm or Headspace
- Lasting (couples therapy app, now part of The Knot): subscription, content-led rather than data-led

The closest comparable in market positioning is Day One: a small, premium, considered product with a loyal paying user base, sold at price points well above the typical productivity-app range. The closest comparable in subject matter is Paired, but Paired sells daily relationship questions rather than decision support, and its tone is much lighter than what Mull Over needs to be.

## Pricing

Three tiers:

Edition I, Solo Reader. Free, no card required, no expiry. Solo decisions only, all eight question formats, durations from a week to ninety days, day-by-day chart, CSV export. No partner mode, no AI synthesis. Designed to be generous enough that a user can run a full thirty-day decision end to end and decide for themselves whether to pay for the partner version.

Edition II, A Single Question. USD 19.99 per paid decision, charged only on the day the verdict reveals, refundable for seven days afterwards. Unlocks partner mode, the full five-layer divergence analysis, theme extraction with frequencies, the conversation prompt, and the branded PDF verdict. The most-converting moment in the product is the day-thirty verdict screen, where the user has just lived through a thirty-day commitment and is about to see the analysis. Friction is removed at that exact moment via one-click Stripe Checkout.

Edition III, A Full Year. USD 99 per year. Unlimited shared decisions, up to five in parallel, durations up to 365 days, priority push delivery, past per-decision purchases credit toward the upgrade, vector search across past verdicts. The unit economics work above approximately five paid decisions per year, so the annual edition serves both the heavy-user case and the gift-card case (a therapist giving a couple a year of access).

Revenue is recognised at the verdict moment, not at the start of the decision, which means cohort revenue is delayed by the average decision duration (around 35 days in the prototype data). This is unusual for a SaaS product but better aligned with the customer's actual willingness to pay: people will commit to a thirty-day voting period for free, but they will only pay for the analysis they have already decided is valuable. Twelve-month payback on customer acquisition cost in the base case channel mix.

## The five-layer divergence analysis

The core paid feature, generated on the final day of a shared decision. Powered by Claude. Five layers stacked:

1. Agreement rate. Of the days both partners voted, what percentage did they agree, and how did agreement move across the period (rising, falling, flat).

2. Conviction trajectory. For each partner, how did their conviction change from the first vote to the last. Rising trajectories indicate the partner moved toward a yes over the period; falling trajectories indicate movement toward no; flat trajectories indicate stability of position. The trajectory is more informative than any single vote.

3. Theme extraction with frequencies. Every written note from both partners is clustered into themes (typically four to eight per decision), with frequency counts per partner per theme. This is the layer that makes the analysis specific to the couple rather than generic.

4. The synthesis paragraph. One paragraph, written by Claude, that names the underlying axis of disagreement. Not whether the partners disagreed (already known from the verdicts), but what they were disagreeing about underneath. The paragraph references specific note frequencies to ground the claim.

5. The conversation prompt. One actionable question for the conversation that follows. Not "communicate more openly"; a specific, actionable question shaped by the data above.

Generation cost per analysis at current Claude pricing is in the low tens of cents, leaving comfortable gross margin on the USD 19.99 charge.

## The eight question formats

Different decisions deserve different vote shapes. The format is chosen once, at the start of the decision.

- Yes / No. Clean binaries. "Should we have a baby."
- Strong / Lean (four-point conviction scale). The recommended default for most life decisions. "Should we move into town."
- A vs B. Two named alternatives. "Wellington or Auckland."
- Photo A vs B. Daily tap between two images. "Wedding dress A or B."
- Scale 1 to 10. Magnitude rather than direction. "How ready are we to start trying."
- Pros vs Cons. Reasons accumulate over time, with the daily vote being the direction of the strongest reason that day.
- Pick best (of N). One of several alternatives, daily. "Which of these four houses."
- Rank options. Daily ordering of N options. "Rank the schools."

## The go-to-market sequence

Four phases, sequenced deliberately to test the funnel before paying to scale it.

Phase one, founder network and word-of-mouth. The first hundred users come from James's personal and professional network in New Zealand. The goal is product feedback and validation of the per-decision price point, not revenue. Target conversion rate from free decision to paid verdict above 30 percent. Target verdict-quality rating from users above 4.0 out of 5.

Phase two, organic SEO and content. A small body of editorial content on the marketing site targeting search queries like "how to decide whether to have a baby," "should we move," "couple disagreeing about a house." The content is high-quality long-form, not SEO-bait. The conversion event is starting a free solo decision. Target CAC under USD 10 in the organic channel.

Phase three, therapist partnerships. Practising couples therapists in New Zealand and Australia are offered free or discounted access in exchange for referring clients to the product as a preparation tool. The product is positioned to the therapist as a way to save the first two or three sessions of every new client engagement. Therapists do not earn commissions; the alignment is purely clinical.

Phase four, paid Meta acquisition. Only opens once the unpaid funnel is producing predictable LTV. Initial campaigns target lookalike audiences of the early paying users, with creative built around the divergence-analysis verdict reveal (the most visually compelling moment in the product). The Meta playbook with 2026 benchmark CPA figures is in the expanded business case.

The product is intentionally not launched with broad PR. The customer's emotional state at the point of purchase is private and slightly ashamed; a high-visibility launch creates surface area that makes the product feel less private, which is exactly the wrong direction.

## Competitive positioning

In the couples-app category (Paired, Lasting, Coupleness, Coral, Relish), Mull Over is positioned as a decision tool, not a relationship-quality tool. Those products sell daily prompts and content; Mull Over sells the analysis of a specific decision. The pricing model is also different: per-decision rather than per-month subscription.

In the journaling category (Day One, Reflectly, Stoic), Mull Over is positioned as a structured single-question journal with a synthesis at the end. Day One is the closest analogue in tone and price point but it cannot do the synthesis, the partner mode, or the privacy reveal.

In the therapy-adjacent category (BetterHelp, Talkspace, Lasting), Mull Over is positioned as a complement, not a substitute. The product produces the data; therapy uses it. Several practising therapists already see Mull Over as a referral target.

In the productivity-decision-tool category (decision matrices, weighted-scoring tools, Roam), Mull Over is positioned as a longitudinal capture rather than a structured argument. The competition assumes that a single sitting can capture the decision; Mull Over assumes it cannot.

## Brand and tone

Brand DNA: the vesica piscis logo, two intersecting circles representing two partners with a shared region in the middle. The visual mark is used sparingly. The wordmark sets "Mull" in Newsreader regular and "Over" in Newsreader italic.

Tone: warm, slow, considered. Closer to a thoughtful literary publication than to a SaaS product. The marketing surface reads as if written by adults for adults facing a serious question. No exclamation marks, no urgency tactics, no countdown timers, no startup-energy copy. The font choices and the editorial layout do a lot of the brand work; the copy itself stays plain and direct.

Voice for copy: short declarative sentences. Italic accents on the emotionally loaded word in each headline. Numbered sections rather than slick chip badges. References to the publication metaphor throughout ("Edition I," "Edition II," "Vol. I, Edition One," "Plate I").

## The five-year vision

Year one: validate the product with the New Zealand founder network and reach 1000 paying decisions across solo and shared, with an annual run rate near USD 100,000.

Year two: extend to Australia and the UK via therapist partnerships and organic SEO, opening paid Meta only at the end of the year, reaching an ARR near USD 1 million.

Year three: open the United States and Canada, scale Meta in the validated channels, introduce the annual edition heavily, and ship the B2B Teams pilot (a version of the product for organisational decision-making, sold to consulting firms and venture capital partnerships). Target ARR near USD 5 million.

Year four: deepen the product into adjacent decisions (gift, travel, financial allocation, second-child timing, fertility treatment specifically), reach a paying user base in the low six figures globally.

Year five: a profitable, durable, premium consumer business at around USD 20 million ARR with low single-digit-million headcount. The product remains private, considered, and unhurried. The goal is not exit; the goal is a sustained product that solves a specific class of problem well.

## The single sentence to remember

A small private vote, every evening, for as long as the decision deserves; the verdict and the analysis arrive together at the end.
