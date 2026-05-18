# Counsel.day: Product Brief

The condensed reference for the product. Read this for the whole story in twenty minutes.

## The product in one sentence

Both partners vote privately each evening on the same question for a duration they choose; on the final day both verdicts unlock together alongside an AI analysis of where they actually disagreed.

## The unique selling proposition

The only product that separates the voting from the conversation. Every other tool a couple might reach for (a journal, a relationship app, a couples-therapy session, a notes app, a spreadsheet) collapses both into the same moment, which contaminates the data. Counsel.day deliberately splits them: thirty private votes per partner across the period of their choosing, all sealed, then revealed together at the end with an analysis that names the actual axis of their disagreement.

The mechanism cannot be replicated by a journaling app, by therapy alone, or by a productivity tool, because the value depends on the privacy guarantee being absolute and the temporal spread being structural. A user cannot achieve the same outcome by writing in a notebook (no synthesis) or by talking to their partner more (anchoring), or by going to therapy (which is the conversation, not the data underneath it).

## The target customer

Any couples or small teams facing a meaningful joint decision they have been circling for weeks or months without resolution. The product is not built around a demographic; it is built around a shape of decision. We see users across a wide age range, in a wide range of relationship structures (married, unmarried, dating, same-sex, polyamorous, separated and trying again), and in non-couple two-person partnerships as well (co-founders, business partners, adult-child-and-parent, friends making a joint decision, a family making one). The decision is typically one of the following classes, in rough order of frequency:

- Family and reproduction: having a baby, having a second child, fertility treatment, schooling
- Home and place: buying a house, moving cities or countries, moving closer to family, downsizing
- Career: leaving a job, taking a role, changing careers
- Partnership itself: getting married, getting separated, opening or closing the relationship

The emotional state on arrival is consistent: tired, anxious, hopeful, sometimes slightly ashamed they have not been able to resolve the question themselves. Users are typically well-educated, capable, articulate, and accustomed to making other decisions confidently. They are in the broad demographic where premium consumer apps (Calm, Headspace, Day One, Notion) are unremarkable purchases.

A second customer segment, smaller but high-value, is the practising couples therapist who refers clients to the product as a preparation tool. The first three sessions of every new couple are typically spent doing this kind of private signal capture manually; the product does it before the first session.

## The market

Estimated TAM in the English-speaking developed markets (US, UK, Canada, Australia, New Zealand) is roughly 60 million couples in the target demographic, of whom approximately 20 percent will face at least one decision of this magnitude in any given year. Realistic SAM (those who would consider a premium consumer app to help with the decision) is more like 2 to 4 million annual decisions. SOM in the first three years, targeting word-of-mouth growth and therapist referrals, is in the low tens of thousands of decisions. The full numbers are in the business case PDF.

Adjacent reference points:

- Calm: 100 million downloads, around 4 million paying subscribers, USD 250 million ARR at peak
- Headspace: similar scale, USD 100 million plus ARR, premium consumer pricing
- Day One: smaller, premium consumer journaling, sustained low-eight-figure ARR
- Paired (couples app): around 1 million downloads, freemium model, much lower ARPU than Calm or Headspace
- Lasting (couples therapy app, now part of The Knot): subscription, content-led rather than data-led

The closest comparable in market positioning is Day One: a small, premium, considered product with a loyal paying user base, sold at price points well above the typical productivity-app range. The closest comparable in subject matter is Paired, but Paired sells daily relationship questions rather than decision support, and its tone is much lighter than what Counsel.day needs to be.

## Pricing

Three tiers:

Solo. Your first lifetime Solo decision is free, no card required. Additional Solo decisions are USD 4.99 each, charged upfront; Solo Annual is USD 49/year for up to 100 Solo decisions. All eight question formats, durations from a week to ninety days, day-by-day chart, CSV export. Solo voting only; partner mode requires Couple or Family. The free first decision lets a user run a full thirty-day Solo decision end to end before paying anything.

Couple. USD 9.99 per paid decision (two participants), charged upfront on the day the decision is composed. Unlocks partner mode, the full five-layer divergence analysis, theme extraction with frequencies, the conversation prompt, and the designed PDF verdict. The owner of the decision is the one charged; the invited partner is invited via a single-use magic link and is not charged separately. One decision, one charge, two participants.

Family. USD 14.99 per paid decision (three to six participants), charged upfront. Same mechanism as Couple, with a seven-layer family-aware verdict and a trajectory chart with up to six lines.

Annual plans: Solo Annual USD 49/year (up to 100 Solo decisions), Couple Annual USD 99/year (up to 100 Couple decisions), Family Annual USD 149/year (up to 100 Family decisions). The 100-decision/year cap exists to prevent abuse, not to penalise heavy users; each annual plan breaks even at ten paid decisions per year. Past per-decision purchases credit toward the annual upgrade pro-rata.

Revenue is recognised at composition (upfront charging), which simplifies cohort revenue reporting compared to a pre-auth + capture pattern. Twelve-month payback on customer acquisition cost in the base case channel mix.

## The five-layer divergence analysis

The core paid feature, generated on the final day of a shared decision. Powered by Claude. Five layers stacked:

1. Agreement rate. Of the days both partners voted, what percentage did they agree, and how did agreement move across the period (rising, falling, flat).

2. Conviction trajectory. For each partner, how did their conviction change from the first vote to the last. Rising trajectories indicate the partner moved toward a yes over the period; falling trajectories indicate movement toward no; flat trajectories indicate stability of position. The trajectory is more informative than any single vote.

3. Theme extraction with frequencies. Every written note from both partners is clustered into themes (typically four to eight per decision), with frequency counts per partner per theme. This is the layer that makes the analysis specific to the couple rather than generic.

4. The synthesis paragraph. One paragraph, written by Claude, that names the underlying axis of disagreement. Not whether the partners disagreed (already known from the verdicts), but what they were disagreeing about underneath. The paragraph references specific note frequencies to ground the claim.

5. The conversation prompt. One actionable question for the conversation that follows. Not "communicate more openly"; a specific, actionable question shaped by the data above.

Generation cost per analysis at current Claude pricing is in the low tens of cents, leaving healthy gross margin on the USD 9.99 charge (approximately 95 to 97 percent before payment processing).

## The nine question formats

Different decisions deserve different vote shapes. The format is chosen once, at the start of the decision.

- Yes / No. Clean binaries. "Should we have a baby."
- Strong / Lean (four-point conviction scale). The recommended default for most life decisions. "Should we move into the city."
- A vs B. Two named alternatives. "Wellington or Auckland."
- Photo A vs B. Daily tap between two images. "Wedding dress A or B."
- Scale 1 to 10. Magnitude rather than direction. "How ready are we to start trying."
- Pros vs Cons. Reasons accumulate over time, with the daily vote being the direction of the strongest reason that day.
- Pick best (of N). One of several alternatives, daily. "Which of these four houses."
- Rank options. Daily ordering of N options. "Rank the schools."
- Round-robin pairwise. The owner enters up to ten named options; each evening the participants see a small set of randomly drawn pairs and tap their preference for each (name A or name B); across the period every pair has been shown to each participant multiple times; the verdict ranks the options by win count. The format for naming decisions (a baby, a brand, a pet, a business) and for narrowed-down location decisions.

## The go-to-market sequence

Four phases, sequenced deliberately to test the funnel before paying to scale it.

Phase one, founder network and word-of-mouth. The first hundred users come from James's personal and professional network in New Zealand. The goal is product feedback and validation of the per-decision price point, not revenue. Target conversion rate from free decision to paid verdict above 30 percent. Target verdict-quality rating from users above 4.0 out of 5.

Phase two, organic SEO and content. A small body of editorial content on the marketing site targeting search queries like "how to decide whether to have a baby," "should we move," "couple disagreeing about a house." The content is high-quality long-form, not SEO-bait. The conversion event is starting a free solo decision. Target CAC under USD 10 in the organic channel.

Phase three, therapist partnerships. Practising couples therapists in New Zealand and Australia are offered free or discounted access in exchange for referring clients to the product as a preparation tool. The product is positioned to the therapist as a way to save the first two or three sessions of every new client engagement. Therapists do not earn commissions; the alignment is purely clinical.

Phase four, paid Meta acquisition. Only opens once the unpaid funnel is producing predictable LTV. Initial campaigns target lookalike audiences of the early paying users, with creative built around the divergence-analysis verdict reveal (the most visually compelling moment in the product). The Meta playbook with 2026 benchmark CPA figures is in the expanded business case.

The product is intentionally not launched with broad PR. The customer's emotional state at the point of purchase is private and slightly ashamed; a high-visibility launch creates surface area that makes the product feel less private, which is exactly the wrong direction.

## Competitive positioning

In the couples-app category (Paired, Lasting, Coupleness, Coral, Relish), Counsel.day is positioned as a decision tool, not a relationship-quality tool. Those products sell daily prompts and content; Counsel.day sells the analysis of a specific decision. The pricing model is also different: per-decision rather than per-month subscription.

In the journaling category (Day One, Reflectly, Stoic), Counsel.day is positioned as a structured single-question journal with a synthesis at the end. Day One is the closest analogue in tone and price point but it cannot do the synthesis, the partner mode, or the privacy reveal.

In the therapy-adjacent category (BetterHelp, Talkspace, Lasting), Counsel.day is positioned as a complement, not a substitute. The product produces the data; therapy uses it. Several practising therapists already see Counsel.day as a referral target.

In the productivity-decision-tool category (decision matrices, weighted-scoring tools, Roam), Counsel.day is positioned as a longitudinal capture rather than a structured argument. The competition assumes that a single sitting can capture the decision; Counsel.day assumes it cannot.

## Brand and tone

Brand DNA: The Knot logo, two interlocked rings (one Forest green, one Burgundy, with the Forest ring woven over the Burgundy at the top crossing) representing two partners bound to a single decision. The visual mark is used sparingly. The wordmark sets "Counsel" in Newsreader (weight 500) and ".day" in Newsreader (weight 400, burgundy).

Tone: warm, slow, considered. Closer to a thoughtful literary publication than to a SaaS product. The marketing surface reads as if written by adults for adults facing a serious question. No exclamation marks, no urgency tactics, no countdown timers, no startup-energy copy. The font choices and the editorial layout do a lot of the brand work; the copy itself stays plain and direct.

Voice for copy: short declarative sentences. Italic accents on the emotionally loaded word in each headline (kept to single loaded words, not multi-word phrases). Numbered sections rather than slick chip badges. References to the publication metaphor throughout ("Solo," "Couple," "Family," ", ," "Plate I").

## The five-year vision

Year one: validate the product with the New Zealand founder network and reach 1000 paying decisions across solo and shared, with an annual run rate near USD 100,000.

Year two: extend to Australia and the UK via therapist partnerships and organic SEO, opening paid Meta only at the end of the year, reaching an ARR near USD 1 million.

Year three: open the United States and Canada, scale Meta in the validated channels, introduce the annual edition heavily, and ship the B2B Teams pilot (a version of the product for organisational decision-making, sold to consulting firms and venture capital partnerships). Target ARR near USD 5 million.

Year four: deepen the product into adjacent decisions (gift, travel, financial allocation, second-child timing, fertility treatment specifically), reach a paying user base in the low six figures globally.

Year five: a profitable, durable, premium consumer business at around USD 20 million ARR with low single-digit-million headcount. The product remains private, considered, and unhurried. The goal is not exit; the goal is a sustained product that solves a specific class of problem well.

## The single sentence to remember

A small private vote, every evening, for as long as the decision deserves; the verdict and the analysis arrive together at the end.
