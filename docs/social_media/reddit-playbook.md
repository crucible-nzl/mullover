# Reddit playbook

How to post on Reddit as Counsel.day without getting banned, unmasked, or
ignored. Read `persona.md` first; this file is mechanics.

Reddit is worth the care: threads rank on Google for years, so one good answer
in a "how did you decide" thread keeps sending high-intent visitors long after
the thread dies. Our own referrer data (page_hits.referrer_host, PR #30) shows
which subreddit actually sends humans · no UTM parameters needed, and never use
them on Reddit; redditors read a `?utm_source=` as "this is an ad."

## 1 · The rules we never break

1. **Disclose, always.** Any mention of Counsel.day carries "I built this" in
   the same comment or post. Sitewide, Reddit treats undisclosed promotion as
   content manipulation; the FTC treats an undisclosed material connection as
   deceptive endorsement; and communities unmask astroturfers for sport.
2. **One account.** James, as himself. No alts, no "my friend recommended,"
   no second account to agree with the first. Ban evasion is a sitewide
   suspension and a news story.
3. **No vote manipulation.** Never ask anyone to upvote. Reddit detects ring
   voting from fresh accounts faster than you would believe.
4. **Never DM-pitch.** Especially not people in sensitive subs. It is
   reportable, and it is creepy.
5. **Read the sidebar rules before every post, every time.** Rules change,
   automod configs change, and Reddit blocks our tools from fetching them, so
   this check is always manual. Some subs require pre-approval by modmail
   (r/Fencesitter did; we asked; that instinct was right).

## 2 · Account health

The posting account is u/ill_help_you (existing).

- **Warm up before any product mention**: two weeks of genuine comments in the
  target subs. Automod in most mid-size subs silently filters posts from
  accounts below karma/age thresholds; a comment history in the sub is also
  what readers check first when they smell marketing.
- Keep comment karma well ahead of post karma early on.
- Participate on topics that have nothing to do with us. A history that is
  100% decision-tool-adjacent reads as a marketing account even with
  disclosure.
- Never delete-and-repost to retry a flopped post; automod flags the pattern.
  One repost attempt per piece of content, reworded, days later, at most.

## 3 · What performs (and what dies)

Ranked by what actually works for a founder:

1. **Personal story with specifics.** "We circled a school decision for a
   year; on Tuesdays it was yes, Thursdays no" beats any feature list. The
   texture (real days, real numbers, one real regret) is what earns comments.
2. **A genuine ask.** Asking the community for their experience outperforms
   telling them yours. It has to be a real question you want answered;
   redditors smell a rhetorical setup instantly.
3. **Expert comments on other people's threads.** The 90/10 rule: ninety
   percent useful participation, ten percent anything that serves us. This is
   the default mode (see §6) and where most of the value is.
4. **Launch posts in launch subs.** r/SideProject and friends exist for
   disclosed self-promo. Different genre, same honesty.
5. **AMA, later.** Once there is traction worth asking about.

What dies, reliably: link drops with no context; marketing voice (see
persona.md); the same text posted to three subs (mods of adjacent subs compare
notes); anything that reads like it was written to convert rather than to
contribute; editing a link into a post after it gains traction (mods treat
that as bait-and-switch, because it is).

## 4 · Titles

The title is 80% of the outcome. Write five, pick the plainest specific one.

- Specific beats clever: "Deciding on a second kid when you flip weekly" beats
  "The decision that changed everything."
- First person, concrete nouns, a real number where honest.
- No title case, no colon-subtitle constructions, no question marks unless it
  is genuinely a question.
- If the title could sit above an ad, rewrite it.

## 5 · Mechanics

- **Text posts, no links,** in discussion subs. If someone asks for the name,
  answer plainly in a comment ("counsel.day · fair warning, I built it").
  Link only where the sub's rules invite links (launch subs).
- **Timing**: most target subs are US-heavy. Best windows are Tue-Thu
  8-11am US Eastern, which is **12am-3am NZT** · draft in the evening,
  schedule or post late, do not post at NZ-friendly hours into a sleeping sub.
  r/newzealand is the exception: NZ evenings.
- **The first two hours decide the post.** Early velocity feeds the ranking
  algorithm, and OP replies breed comments. Reply to every substantive comment
  in that window; short is fine.
- **One product mention per post, maximum.** Zero is often stronger; let the
  comments ask.
- **Flair** where the sub requires it; automod removes unflaired posts
  silently in many subs.

## 6 · Comment-led strategy (the default mode)

Posting is the exception. Most weeks, the work is:

1. Find live threads and old-but-Google-ranking threads where the question is
   ours. Searches that surface them:
   - `site:reddit.com "how did you decide" another baby`
   - `site:reddit.com "can't decide" move city partner`
   - `site:reddit.com decision "pros and cons list" doesn't work`
2. Answer the actual question first, fully, as if the product did not exist.
3. Mention the tool only if it is squarely on point, once, with disclosure,
   no link.
4. Skip any thread where the person is in acute distress (see §8).

## 7 · Monitoring

- **F5Bot (f5bot.com, free)**: email alerts when keywords appear anywhere on
  Reddit or Hacker News. Set: `counsel.day`, `counsel day`, `decision app
  couple`, `sealed vote`, plus competitor names as we learn them.
- **Our referrer data**: `/api/admin/traffic` (first_party.referrers) shows
  reddit.com arrivals; a per-sub view is visible in path+referrer pairs.
- **Post log**: each file in `posts/` gets an outcome section filled in within
  a week: votes, comments, removals, traffic seen, anything learned.

## 8 · Sensitive communities

r/Fencesitter, r/OneAndDone, the relationship subs: these are support spaces,
and we are guests in them. Extra rules on top of everything above:

- Comments over posts. Posts only with mod pre-approval.
- Never pitch to a person in distress. If a thread involves a crisis (safety,
  abuse, acute mental health), do not mention the product at all; acknowledge,
  be a decent human, point to qualified help if appropriate, leave.
- The product line for these subs is the honest one: it is a structured record
  of your own thinking over time, not therapy, and James is a data
  professional, not a clinician. This boundary is non-negotiable everywhere
  (see persona.md) and doubly so here.
- Do not argue with sceptics in these subs. Concede fast, thank, move on.

## 9 · When a post is removed or the account is banned

1. One polite modmail: "understood, apologies · anything I could change, or
   should I leave it?" Accept the answer.
2. Log it in the post file.
3. Never repost the removed content in the same sub, never evade with another
   account. A sub that stays closed stays closed.

## 10 · Per-post checklist (the skill)

Run this top to bottom for every post:

1. Re-read the sub's sidebar rules and last week's top posts (tone calibration).
2. Confirm the account has real recent history in this sub; if not, go
   participate first and postpone.
3. Draft in the persona (persona.md), as a text post, no links.
4. Write five titles; pick the plainest.
5. Disclosure present in the same body as any product mention? If the post
   cannot carry it, kill the post.
6. Boundary check: no clinical claims, no fake traction, prices as $X.XX USD
   if prices come up, crisis language nowhere near a pitch.
7. Dash check: no em-dashes or en-dashes anywhere (brand rule, and the single
   most-cited AI tell on Reddit).
8. Mod pre-approval if the sub's rules suggest it or the topic is promo-adjacent.
9. Post inside the sub's active window (usually 12am-3am NZT).
10. Stay for two hours; answer everything substantive.
11. Fill in the outcome section of the post file within a week.
12. Anything learned → fold back into this playbook.
