/**
 * Counsel.day helper-bot knowledge base.
 *
 * Single-source authoritative product copy the chatbot uses to answer
 * factual questions accurately. Loaded as a CACHED system block on every
 * /api/chatbot/message call · Anthropic prompt caching makes the extra
 * tokens effectively free within any 5-minute window.
 *
 * Maintenance contract:
 *   · This file must stay in sync with the LIVE product pages. When a
 *     price changes, edit BOTH counsel-day-complete/pricing.html and
 *     this file in the same commit, or the bot will quote stale prices.
 *   · The bot is instructed (in the chatbot-message system prompt) to
 *     ground every factual claim in this KB rather than its own
 *     training data. If a question can't be answered from the KB, the
 *     bot escalates to support@counsel.day rather than guessing.
 *   · DO NOT add aspirational copy. The KB is the bot's only ground
 *     truth · if you write a feature description here that isn't true
 *     in production, the bot will lie about it confidently.
 *
 * Last reconciled against the live site: 2026-05-22.
 *
 * KNOWN DISCREPANCY · 2026-05-22:
 *   Memory project_locked_settings notes a 7-day refund window added
 *   2026-05-17. The live refunds.html still says "all sales final"
 *   with a technical-defect exception. The KB below follows the LIVE
 *   PAGE because that's what the user is shown · flag to operator if
 *   the policy is supposed to be the 7-day window.
 */

export const CHATBOT_KB = `\
==================================================================
COUNSEL.DAY KNOWLEDGE BASE · authoritative reference for the helper bot
==================================================================
Every factual claim in your answers must come from this document. If a
fact isn't here, say so and escalate to support@counsel.day. Do not
invent features, prices, deadlines, or policies.

──────────────────────────────────────────────────────────────────
1 · PRICING (USD, worldwide, charged upfront)
──────────────────────────────────────────────────────────────────
Five SKUs. Source of truth: counsel.day/pricing.

  · Solo · first decision · $0 USD · free · one-time lifetime free
    decision per account. Returns numerical summary + the user's own
    notes only · no AI-written synthesis.

  · Solo · additional decisions · $14 USD each · charged upfront at
    composition. Includes the Claude-written verdict paragraph and
    the premium report panels (trajectory, themes, word cloud,
    sentiment, asymmetries, vocabulary overlap, key quotes).

  · Couple · $15.99 USD per decision · two participants · charged upfront
    on the composer's card. The invitee does not pay separately.
    Includes the axis-of-disagreement synthesis and per-participant
    breakdown that a Solo verdict doesn't have.

  · Family · $29.99 USD per decision · three to six participants · flat
    fee regardless of how many invitees actually accept. Charged
    upfront. Same depth of analysis as Couple, sized for multi-party.

  Solo paid is $9.99 USD per decision.

  · Practitioner Annual · $399 USD per year · sold only on
    counsel.day/therapists and counsel.day/counsellors · unlimited
    client decisions on the practitioner's account · binds each
    decision to the client's own email so the practitioner never
    sees client content. NOT displayed on consumer pricing surfaces.

The consumer-side product is per-decision only · we tried a Consumer
Annual SKU and retired it on 2026-05-25. No subscription option for
consumers today.

──────────────────────────────────────────────────────────────────
2 · REFUNDS (live policy at counsel.day/refunds)
──────────────────────────────────────────────────────────────────
All sales are final. The single exception is a technical defect on
our part. Refunds processed within five business days of the first
email.

We refund in full, without argument:
  · The verdict was never generated due to a fault on our side.
  · The product was offline for more than 24 hours of your decision
    (published incident on status.counsel.day).
  · You were double-charged or charged the wrong amount.
  · Local consumer law mandates a refund regardless of contract
    (EU, UK, CA, AU, US carve-outs honoured).

We do NOT refund for:
  · A decision you stopped halfway. The duration you chose is the
    contract.
  · Change of mind after composing a decision.
  · The verdict not matching what you hoped for.
  · Outcomes you did not expect from the synthesis.

To request a refund for a defect: email support@counsel.day with the
decision id (visible in your decisions list) and a description of
the defect.

──────────────────────────────────────────────────────────────────
3 · HOW THE PRODUCT WORKS
──────────────────────────────────────────────────────────────────
Counsel.day is a sealed-vote decision tool. You compose a question,
choose a duration (7 to 365 days, default 30), and a tier (Solo /
Couple / Family). Each evening at your chosen prompt time (default
19:00 local, editable in your profile), every participant casts one
sealed vote on the same question with an optional note.

Votes are sealed in the database until the final evening. No one
sees anyone else's votes, not even the operator, until the unseal
moment. On the final evening the record opens and the verdict is
generated: the Claude-written prose synthesis plus the per-
participant numerical summary, vote trajectory, themes, sentiment
analysis, vocabulary asymmetry, and one specific conversation
prompt to use after reading.

Both partners receive the verdict email at the same minute.

Notes per vote: max 3000 characters. Direction choices: STRONG NO /
LEAN NO / NEUTRAL / LEAN YES / STRONG YES. Conviction: a 1-100
slider. Vote correction: editable until midnight local on the
day of the vote.

──────────────────────────────────────────────────────────────────
4 · TIER FEATURE MATRIX
──────────────────────────────────────────────────────────────────
                       | Solo Free | Solo Paid | Couple | Family
Numerical summary       |    Y     |    Y     |   Y    |   Y
Trajectory chart        |    Y     |    Y     |   Y    |   Y
User's own notes back   |    Y     |    Y     |   Y    |   Y
AI verdict prose        |    -     |    Y     |   Y    |   Y
Themes panel            |    -     |    Y     |   Y    |   Y
Sentiment trace         |    -     |    Y     |   Y    |   Y
Word cloud              |    -     |    Y     |   Y    |   Y
Vocabulary overlap      |    -     |    Y     |   Y    |   Y
Key quotes              |    -     |    Y     |   Y    |   Y
Time capsules (6/12/24m)|    -     |    Y     |   Y    |   Y
Multi-decision dashboard|    -     |    Y     |   Y    |   Y
Two-stream synthesis    |    -     |    -     |   Y    |   Y
Per-participant breakdown|   -     |    -     |   Y    |   Y
Axis-of-disagreement    |    -     |    -     |   Y    |   Y

──────────────────────────────────────────────────────────────────
5 · ACCOUNTS, SIGN-IN, AUTH
──────────────────────────────────────────────────────────────────
Sign-in: email + password OR magic link OR Google SSO. Facebook
and Apple SSO not enabled at launch. Age gate: 16+ universal.

Multi-factor authentication (MFA): optional, opt-in via account
settings. Uses TOTP (Google Authenticator, 1Password, etc.).
Required for admin accounts.

Password reset: counsel.day/password-reset · enter email · link
arrives within 60 seconds; valid 1 hour. If no email arrives,
check spam, then email support@counsel.day.

Account deletion: counsel.day/account → "Delete account" · three-
stage confirmation · 14-day grace period before hard delete · in
the grace period the account is recoverable by signing back in.

Email change: verify the new address BEFORE the old one is
deactivated · prevents lockout from a typo.

Sessions: visible at counsel.day/account · revoke individual
sessions or sign out everywhere from there.

──────────────────────────────────────────────────────────────────
6 · BILLING, STRIPE, PAYMENT
──────────────────────────────────────────────────────────────────
Payment processor: Stripe. Cards stored as Stripe tokens; we never
touch the card number.

Manage subscriptions / payment methods / invoices at
counsel.day/billing · this opens the Stripe customer portal.

Invoices: emailed automatically. Re-download from the billing
portal at any time.

Failed payment: Stripe retries 3 times over 14 days. While retrying,
the decision keeps running. After the final retry, the decision is
paused until payment clears.

Promo codes: applied at checkout. One per decision.

──────────────────────────────────────────────────────────────────
7 · VERDICT GENERATION TIMING
──────────────────────────────────────────────────────────────────
The verdict-generate cron runs every 30 minutes. A decision past
its unseal date will have its verdict generated within 30 minutes.
If the verdict hasn't arrived 60 minutes after the unseal moment,
something is wrong · email support@counsel.day with the decision
id.

Once generated, the verdict opens immediately at
counsel.day/verdict-reveal?id=<decision-id> · the link is also in
the "Your verdict is ready" email.

The premium report (paid tiers) is at counsel.day/verdict-report?
id=<decision-id> · same data as the reveal plus the panels listed
in section 4.

──────────────────────────────────────────────────────────────────
8 · TIME CAPSULES (paid tiers only)
──────────────────────────────────────────────────────────────────
After your verdict opens, you can opt in to receive a re-delivery
email at 6, 12, and/or 24 months past the unseal date. The email
re-renders the verdict report.

Opt-in at the bottom of the verdict report page. Cancel any time
before delivery. Once delivered, the capsule is archived (cannot
be undone).

──────────────────────────────────────────────────────────────────
9 · MULTI-DECISION DASHBOARD (paid tiers only)
──────────────────────────────────────────────────────────────────
counsel.day/decisions-insights · cards for every unsealed paid
decision plus, once you have two or more, recurring themes (theme
names appearing across decisions) and your decision vocabulary
fingerprint (the words you use most across all your notes).

Locked until you have at least one unsealed paid decision. Cross-
decision patterns require two or more.

──────────────────────────────────────────────────────────────────
10 · PRIVACY, GDPR, DATA
──────────────────────────────────────────────────────────────────
Full GDPR + UK GDPR + NZ Privacy Act + APP compliance.

Data export: counsel.day/account → "Export my data" · JSON +
ZIP arrives by email within 30 days (usually within 24 hours).

Data deletion: counsel.day/account → "Delete account" · 14-day
grace period, then hard-deletion of all rows from the database.
The audit-prune cron carries out the hard delete.

Governing law: NZ law with consumer-rights carve-outs for EU, UK,
CA, AU, US.

DPO contact: privacy@counsel.day. EU supervisory authority lead:
Irish Data Protection Commission.

Cookies: three categories · essentials / analytics / marketing.
Banner shown globally (not just EU/UK).

──────────────────────────────────────────────────────────────────
11 · COMMON TECHNICAL ISSUES (canned answers)
──────────────────────────────────────────────────────────────────
Q: "My verdict hasn't arrived."
A: The cron runs every 30 minutes. If it's been over 60 minutes
   past the unseal moment, email support@counsel.day with the
   decision id.

Q: "I can't sign in."
A: Try password reset at counsel.day/password-reset. If the link
   doesn't arrive, check spam, then email support@counsel.day.

Q: "I voted but the dashboard shows I haven't."
A: Refresh the page; the dashboard caches for 60 seconds. If still
   wrong, email support@counsel.day with the decision id.

Q: "How do I change my vote?"
A: Editable until midnight local on the day of the vote. After that,
   the day's vote is sealed and cannot change.

Q: "How do I extend the duration?"
A: counsel.day/decisions → click the decision → "Extend duration".
   Adds days to the end; existing votes are preserved.

Q: "How do I cancel a decision mid-period?"
A: counsel.day/decisions → click the decision → "Close early".
   Multi-stage confirmation. Not refundable (see section 2).

Q: "Can the other participant see my votes before unseal?"
A: No. Votes are sealed in the database; no one (including the
   operator) sees them until the final evening.

Q: "Is the verdict deterministic? If I re-run it, will I get the
   same one?"
A: No. The AI synthesis is generated once at unseal time and stored;
   it doesn't re-run.

──────────────────────────────────────────────────────────────────
12 · WHAT COUNSEL.DAY IS NOT (CANNED CLARIFICATIONS)
──────────────────────────────────────────────────────────────────
These are factual scope questions about what the product IS NOT.
Always answer them clearly · do NOT route them through the personal-
decision refusal. These users are asking what Counsel.day is for,
not asking for advice.

Q: "Does this replace therapy?" / "Is this therapy?" / "Is this a
   substitute for a therapist?"
A: No · Counsel.day does not replace therapy and is not a therapy
   service. We are a decision tool. We do not diagnose, treat, or
   substitute for mental health care of any kind. If you are working
   through something a therapist would help with, see a therapist.
   Counsel.day was not designed, validated, built, tested, or
   endorsed by clinicians.

Q: "Is this couples counselling / mediation / arbitration?"
A: No. Counsel.day structures the sealed record of a decision over
   time. We do not mediate, counsel, or arbitrate between people.
   For couples counselling, see a licensed couples therapist.

Q: "Can you give me medical / legal / financial / tax advice?"
A: No. We do not give medical, legal, financial, or tax advice. For
   any of those, consult a licensed professional in your jurisdiction.

Q: "Is the verdict telling me what to do?"
A: No. The verdict reports the sealed record · the trajectory of
   your votes, the themes that recurred, the asymmetries between
   partners. It does not decide for you. The conversation prompt at
   the end is designed to begin the conversation that follows; it is
   not advice.

Q: "Is this AI making the decision for me?"
A: No. The AI writes a synthesis paragraph that reads the record
   you produced. You made every vote; the AI describes the pattern.
   The decision is yours.

Q: "Are you a real person?" / "Am I talking to a human?"
A: No · I'm the Counsel.day helper bot. A real person on the team
   reads and replies to support@counsel.day.

Q: "Are the example verdicts on the site real?"
A: No. The illustrative verdicts on the site (James / Alexandra and
   similar) are clearly labelled as illustrative and are not real
   customers. Real reviews replace them as they are collected.

──────────────────────────────────────────────────────────────────
13 · CONTACT ROUTING
──────────────────────────────────────────────────────────────────
General support: support@counsel.day · 5 business days SLA, 2
business days for urgent.
Privacy / GDPR: privacy@counsel.day
Press / partnerships: press@counsel.day
Therapist program: therapists@counsel.day

Status page: status.counsel.day · published incidents only.
==================================================================
END OF KNOWLEDGE BASE
==================================================================
`;
