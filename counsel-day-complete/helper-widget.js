/* helper-widget.js · floating Counsel.day helper bot.
 *
 * Mounts a fixed bottom-right launcher on every page that includes
 * this script. Clicking opens a slide-up drawer with a small chat
 * surface.
 *
 * TASK 7 · This version runs ENTIRELY in the browser. No backend
 * call, no paid LLM. A deterministic knowledge base + fuzzy keyword
 * scorer answers questions about Counsel.day's product, pricing,
 * sealed-vote method, billing, refunds, brand, and operational
 * questions. Drawer is 50% bigger than the previous iteration so
 * answers (often multi-paragraph) fit without scrolling.
 *
 * Idempotency: tags itself with data-cd-helper-installed=1 so a
 * duplicate include is a no-op.
 */
(function () {
  'use strict';
  if (document.documentElement.getAttribute('data-cd-helper-installed') === '1') return;
  document.documentElement.setAttribute('data-cd-helper-installed', '1');

  // Skip on the helper page itself · the floating widget would be
  // redundant when the user is already on /helper.html.
  if (/\/helper(\.html)?$/.test(window.location.pathname)) return;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, attrs, html) {
    var n = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'style') n.style.cssText = attrs[k];
        else if (k.indexOf('on') === 0) n.addEventListener(k.slice(2), attrs[k]);
        else n.setAttribute(k, attrs[k]);
      });
    }
    if (html != null) n.innerHTML = html;
    return n;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c];
    });
  }

  // ---------------------------------------------------------------------
  // KNOWLEDGE BASE · every fact the bot can answer. Each entry has:
  //   keywords  · tokens to match against the user's question
  //   q         · canonical question (also used as the chip label)
  //   a         · answer in plain text · two newlines split into <p>
  //   tags      · optional product tag (Decision, Journal, Billing, Brand, Tech, Privacy)
  //
  // Add new entries here · no backend redeploy needed since this file
  // is part of the static site.
  // ---------------------------------------------------------------------
  var KB = [
    // ---------------- PRICING · DECISION ----------------
    {
      tags: ['Decision', 'Pricing'],
      keywords: ['solo', 'price', 'cost', 'first', 'free', 'trial', 'single'],
      q: 'How much does a Solo decision cost?',
      a: 'Your first Solo decision on Counsel.day is FREE.\n\nAfter the first one, a Solo decision is $9.99 USD. You pay per decision at compose time · no subscription, no recurring charge. Each decision runs for the duration you set (7 to 30 days) and seals until the final day.'
    },
    {
      tags: ['Decision', 'Pricing'],
      keywords: ['couple', 'pair', 'partner', 'price', 'cost', 'two'],
      q: 'How much does the Couple tier cost?',
      a: 'Couple is $15.99 USD per decision.\n\nIt covers two participants voting nightly on the same question, sealed for the duration you set. Both invites are included. Charged once at compose · no subscription.'
    },
    {
      tags: ['Decision', 'Pricing'],
      keywords: ['family', 'three', 'four', 'kids', 'household', 'price', 'cost'],
      q: 'How much does the Family tier cost?',
      a: 'Family is $29.99 USD per decision.\n\nIt covers three to six participants voting nightly on the same question. Useful when the decision affects everyone in the household · a move, a school choice, a major spend. Charged once at compose.'
    },
    {
      tags: ['Decision', 'Pricing'],
      keywords: ['subscription', 'monthly', 'recurring', 'sub', 'membership', 'plan'],
      q: 'Is there a subscription for Counsel.day Decision?',
      a: 'No. Counsel.day Decision is paid PER DECISION at compose time · no monthly fee, no annual fee. You buy a decision when you have one to decide, and that\'s it.\n\nCounsel Journal is a separate product with a $4.99 USD/month subscription · but that is the evening reflection journal, not the decision tool.'
    },

    // ---------------- PRICING · JOURNAL ----------------
    {
      tags: ['Journal', 'Pricing'],
      keywords: ['journal', 'daily', 'evening', 'reflection', 'price', 'cost', 'subscription', 'month'],
      q: 'How much does Counsel Journal cost?',
      a: 'Counsel Journal is $4.99 USD per month. One price. One subscription.\n\nIt includes the nightly entry (text or voice), the seven-day seal, the weekly Monday verdict reading the past seven days, the monthly themed verdict on the first Monday of every month, and unlimited history. Cancel any time · access continues until the end of the current billing period.'
    },
    {
      tags: ['Journal', 'Pricing'],
      keywords: ['journal', 'free', 'trial', 'try', 'tier'],
      q: 'Is there a free tier for Counsel Journal?',
      a: 'No. Counsel Journal is paid-only at $4.99 USD/month. Counsel.day does not run a free tier for the Journal · the editorial verdict written by Claude Opus 4.7 each Monday is not viable to subsidise.\n\nCancel any time in your account · you keep access until the period ends.'
    },

    // ---------------- HOW DECISION WORKS ----------------
    {
      tags: ['Decision'],
      keywords: ['how', 'work', 'method', 'sealed', 'vote', 'process'],
      q: 'How does a Counsel.day decision actually work?',
      a: 'You write the question (and pick a duration · 7 to 30 days). Each participant votes once each evening on whether to go ahead, with an optional one-line note.\n\nEvery vote is sealed · no one (not even you) sees anyone else\'s votes until the final day. On reveal day, the system shows the trajectory, the themes, and a synthesis paragraph from Claude Opus 4.7 on what the pattern actually means.\n\nThe seal is the point. Without it, the first vote anchors everything that follows · with it, every evening is its own clean reading.'
    },
    {
      tags: ['Decision'],
      keywords: ['duration', 'days', 'long', 'how long', 'short', 'week', 'month'],
      q: 'How long can a decision run?',
      a: 'Between 7 and 30 days. You pick at compose time. Most people pick 14 days. Shorter feels rushed; longer drifts.\n\nThe duration is locked once the first vote lands · you can\'t extend it. Pick what fits the question.'
    },
    {
      tags: ['Decision'],
      keywords: ['change', 'edit', 'extend', 'modify', 'cancel', 'after'],
      q: 'Can I change a decision after it starts?',
      a: 'No. Once the first vote is in, the question, the participants, and the duration are locked. This is by design · the value of the sealed vote depends on the rules not moving while you decide.\n\nYou can REFUND a decision before any vote lands (full refund). After the first vote, the decision must complete.'
    },
    {
      tags: ['Decision'],
      keywords: ['invite', 'partner', 'send', 'email', 'sms', 'join'],
      q: 'How do I invite my partner / co-deciders?',
      a: 'After payment, you enter each invitee\'s email (and optionally a personal note). The system sends each one a sealed-invite email with a one-tap accept link. They sign up (or sign in if they already have a Counsel.day account) and the decision starts the evening everyone has accepted.\n\nIf an invitee doesn\'t accept within 7 days, the decision auto-refunds and is cancelled.'
    },

    // ---------------- JOURNAL FLOW ----------------
    {
      tags: ['Journal'],
      keywords: ['journal', 'evening', 'how', 'work', 'nightly', 'use'],
      q: 'How does Counsel Journal work day-to-day?',
      a: 'Each evening you record between 30 and 180 seconds about the day · type or speak. Whisper transcribes voice. The entry seals immediately for seven days · you can\'t re-read it.\n\nEvery Monday morning a verdict ships in a real human voice (Claude Opus 4.7) that names three to five things that kept working, one or two that strained, the throughline, and one specific question for the week ahead.\n\nOn the first Monday of every month a themed verdict reads the past four weekly verdicts together and names what the month was actually about.'
    },
    {
      tags: ['Journal'],
      keywords: ['voice', 'audio', 'speak', 'record', 'microphone', 'whisper'],
      q: 'Can I record by voice?',
      a: 'Yes. Tap the mic, speak for 30 to 180 seconds, and the entry uploads to be transcribed by Whisper. You can also type. Both are sealed the same way.\n\nAudio and the transcript are both kept · the audio plays back from the vault page once the seal opens (seven days later).'
    },
    {
      tags: ['Journal'],
      keywords: ['vault', 'recordings', 'history', 'past', 'old', 'playback', 'listen'],
      q: 'Where are my recordings stored?',
      a: 'On /vault.html · your private vault page. Every entry you file appears there, sorted newest first.\n\nSealed entries show as locked rows with a "opens on [date]" indicator · the body is hidden until the seven-day seal lifts. Unsealed entries show the full transcript and play back the audio in-browser. Audio files live on Cloudflare R2 with signed short-lived URLs · the raw URL is never exposed to the client.'
    },
    {
      tags: ['Journal'],
      keywords: ['edit', 'change', 'rewrite', 'delete', 're-read'],
      q: 'Can I re-read or edit a sealed entry?',
      a: 'No. The seven-day seal is the entire point. The journal exists so future-you reads what tonight-you actually wrote, not what you wish you had. Re-reading IS editing.\n\nThe seal removes the option. After seven days the entry opens and you can re-read it · but by then your evening-self has moved on, and you read it as the new person you are.'
    },
    {
      tags: ['Journal'],
      keywords: ['skip', 'miss', 'forgot', 'gap', 'break', 'every night'],
      q: 'What if I skip a night?',
      a: 'Nothing happens. The weekly verdict treats skipped days as data · "what was the trajectory across the days you actually filed?" · not as a flaw.\n\nThere\'s no streak counter, no shaming, no "your habit is broken." The seven-day strip shows skipped days as faint marks and the verdict reads the pattern around them.'
    },
    {
      tags: ['Journal'],
      keywords: ['weekly', 'monday', 'verdict', 'report', 'summary', 'review'],
      q: 'What is in the weekly Monday verdict?',
      a: 'Three to five things that kept working (with specific evidence from your entries), one or two that strained, the throughline of the week, and ONE specific question for the week ahead.\n\nIt arrives Monday morning, reads the past seven days, and lands in your /journal feed (and in your inbox if you opted in). Written in a real human voice by Claude Opus 4.7 · not a mood graph, not a sentiment score.'
    },
    {
      tags: ['Journal'],
      keywords: ['monthly', 'themed', 'first monday', 'review', 'big picture'],
      q: 'What is the monthly themed verdict?',
      a: 'On the first Monday of every month, a deep-read ships that reads the past four weekly verdicts TOGETHER. It names what the month was actually about · the shape of it, not the moments.\n\nThis is the part you don\'t get from any other journal app. Streaks, mood charts, daily prompts all work at the day level. Counsel Journal works at the week and the month level too.'
    },

    // ---------------- BILLING & PAYMENT ----------------
    {
      tags: ['Billing'],
      keywords: ['stripe', 'card', 'payment', 'billing', 'process'],
      q: 'How does payment work?',
      a: 'All payments are processed by Stripe · cards stored on Stripe\'s vault, not on Counsel.day. We never see your full card number.\n\nDecisions are charged once at compose. Counsel Journal is charged monthly on the first day you subscribed (recurring on the same date each month). Both billed in US dollars worldwide.'
    },
    {
      tags: ['Billing'],
      keywords: ['cancel', 'subscription', 'stop', 'end', 'unsubscribe'],
      q: 'How do I cancel my Counsel Journal subscription?',
      a: 'Open /account.html and click "Cancel subscription" on the Journal tile. Or open the Stripe portal from the same tile and cancel there.\n\nYou keep access until the end of the current billing period. The subscription stops automatically at that date · no further charges.'
    },
    {
      tags: ['Billing'],
      keywords: ['refund', 'money back', 'cancel decision', 'return'],
      q: 'Can I refund a decision?',
      a: 'Yes, in two cases · automatically.\n\n1) BEFORE THE FIRST VOTE LANDS · full refund, no questions. The decision is cancelled, all invites are withdrawn.\n\n2) IF AN INVITEE DOESN\'T ACCEPT WITHIN 7 DAYS · automatic full refund. The decision is cancelled.\n\nAfter the first vote lands, the decision must run to completion. The seal is a contract · refunding mid-decision would undermine it. For exceptional cases email support@counsel.day.'
    },
    {
      tags: ['Billing'],
      keywords: ['receipt', 'invoice', 'tax', 'vat', 'gst'],
      q: 'Where are my receipts?',
      a: 'Every charge sends a Stripe receipt to the email on the account. Re-download any past receipt from the Stripe portal · linked from /account.html on the relevant product tile.\n\nThe receipt shows the merchant as "Counsel.day". For tax purposes, Counsel.day is operated from New Zealand · GST applies for NZ customers; everywhere else billed in plain USD with no tax line.'
    },
    {
      tags: ['Billing'],
      keywords: ['currency', 'usd', 'dollar', 'price', 'exchange'],
      q: 'What currency are prices in?',
      a: 'Every price on Counsel.day is in US Dollars (USD). Worldwide.\n\nYour card issuer converts to your local currency at their exchange rate · we don\'t set it. The amount on your statement may differ slightly from the USD price shown at compose, depending on the day\'s rate and any FX fee your card adds.'
    },

    // ---------------- PRIVACY · SECURITY ----------------
    {
      tags: ['Privacy'],
      keywords: ['privacy', 'data', 'gdpr', 'delete', 'share', 'sell'],
      q: 'What does Counsel.day do with my data?',
      a: 'Nothing other than running the product. Your entries are stored encrypted at rest, the audio sits on Cloudflare R2 with signed short-lived playback URLs, and the AI verdict is generated from your own entries only.\n\nWe do not sell, share, or train external models on your content. Right to erasure is built in · delete your account at /account.html and all entries are soft-deleted immediately and hard-deleted after 14 days. GDPR + UK PECR compliant.'
    },
    {
      tags: ['Privacy'],
      keywords: ['partner', 'see', 'visible', 'share', 'shared', 'other person'],
      q: 'Can my partner see what I voted?',
      a: 'No. Not until reveal day. Every vote is sealed · the other participant sees only that you voted, not what you voted.\n\nOn reveal day, both votes unlock and both strips are visible to both participants. The synthesis paragraph then reads both trajectories together. Before reveal day · your column is YOURS, their column is THEIRS, and nothing crosses.'
    },
    {
      tags: ['Privacy'],
      keywords: ['mfa', 'two factor', '2fa', 'security', 'login', 'password'],
      q: 'Is two-factor authentication available?',
      a: 'Yes. Enable MFA in /account.html under Security. We support TOTP authenticator apps (Google Authenticator, 1Password, etc.).\n\nDestructive admin actions (deleting an account, cancelling subscriptions) require a FRESH MFA challenge · within five minutes of the action · even if you\'re already signed in. The sign-in itself uses magic-link by default; MFA layers on top for admins and any user who enables it.'
    },

    // ---------------- BRAND / DESIGN ----------------
    {
      tags: ['Brand'],
      keywords: ['why', 'name', 'counsel', 'mean', 'about', 'who'],
      q: 'What does "Counsel.day" mean?',
      a: 'COUNSEL is the deliberate, listened version of advice. DAY is the unit · the day is where decisions are actually made.\n\nThe domain came first; the product followed the name. Most decisions in your life aren\'t made on the day you "decide" · they\'re made by what you carried each evening for a while. Counsel.day is the surface where that carrying is visible.'
    },
    {
      tags: ['Brand'],
      keywords: ['therapy', 'therapist', 'clinical', 'doctor', 'mental health'],
      q: 'Does this replace therapy?',
      a: 'No. Counsel.day is not therapy and is not built, tested, or endorsed by clinicians. It is a deliberation tool, not a clinical tool.\n\nIf you are in distress, please contact a qualified professional or a crisis service in your country. Counsel.day is most useful for joint decisions where the question is real but not urgent · what to do about a job, a move, a relationship, a major spend.'
    },
    {
      tags: ['Brand'],
      keywords: ['ai', 'claude', 'opus', 'verdict', 'who writes', 'who generates'],
      q: 'Who writes the verdicts?',
      a: 'Claude Opus 4.7 from Anthropic, with a specific Counsel.day prompt that asks for a real human voice, plain prose, and grounded references to your actual entries.\n\nThe verdict cites your own words and dates · it does not invent. The Counsel.day prompt is reviewed and tuned regularly by James (founder) in the admin portal. Your entries are not used to train Claude or any other external model.'
    },

    // ---------------- ACCOUNTS · TECHNICAL ----------------
    {
      tags: ['Tech'],
      keywords: ['signup', 'register', 'create', 'account', 'sign up', 'join'],
      q: 'How do I sign up?',
      a: 'Open /signup.html and enter your email · we send a magic-link to verify the address. Click the link, set your first name and a password (optional · magic-link works on its own) and you\'re in.\n\nYou can sign up for either product · the Decision tool or Counsel Journal · or both. They share one account.'
    },
    {
      tags: ['Tech'],
      keywords: ['signin', 'login', 'log in', 'sign in', 'access'],
      q: 'How do I sign in?',
      a: 'Open /signin.html and enter your email · we send a magic-link to sign you in. Click the link and you\'re in.\n\nIf you set a password during sign-up, you can use that instead. MFA-enabled accounts get prompted for the TOTP code after the magic-link / password step.'
    },
    {
      tags: ['Tech'],
      keywords: ['delete', 'remove', 'erase', 'account', 'gdpr', 'forget'],
      q: 'How do I delete my account?',
      a: 'In /account.html under "Delete account". The button does what it says · soft-deletes the account immediately (you can\'t sign in any more, all entries become inaccessible) and triggers a 14-day grace window. After 14 days the rows are hard-deleted from the database and from R2.\n\nThis is GDPR Article 17 (right to erasure). No human intervention required · the deletion is automatic.'
    },
    {
      tags: ['Tech'],
      keywords: ['mobile', 'app', 'android', 'ios', 'iphone', 'phone'],
      q: 'Is there a mobile app?',
      a: 'The web is the product right now · it works on mobile browsers and is installable as a PWA. An Android app is in scope (Expo / React Native, scoped 2026-05-25) · roughly 70 hours of work to a Play Store build. iOS will follow.\n\nThe app uses bearer-token auth, the Stripe in-app browser for payment (not Play Billing), and Expo Push for notifications.'
    },
    {
      tags: ['Tech'],
      keywords: ['email', 'contact', 'support', 'help', 'human', 'someone'],
      q: 'How do I contact support?',
      a: 'Email support@counsel.day · the inbox is monitored by a human (James) and we reply within one business day, usually faster.\n\nFor billing issues, include the Stripe receipt or charge ID. For privacy / data issues, write "GDPR" in the subject and we treat it as a formal request.'
    },

    // ---------------- WORLDWIDE / OPERATIONAL ----------------
    {
      tags: ['Brand'],
      keywords: ['where', 'country', 'worldwide', 'available', 'region'],
      q: 'Is Counsel.day available worldwide?',
      a: 'Yes. Worldwide product, English-language UI, priced in US Dollars. Servers run in Europe (Hetzner Cloud) and the CDN (Cloudflare) is global.\n\nGDPR + UK PECR compliant for European customers. New Zealand operation (the founder is based there) handles GST locally.'
    },
    {
      tags: ['Brand'],
      keywords: ['practitioner', 'therapist', 'coach', 'referral', 'professional'],
      q: 'Do you work with practitioners (coaches, therapists, mediators)?',
      a: 'Yes · a practitioner referral program is in scope. The idea: a practitioner refers a client to Counsel.day, the client subscribes, and the practitioner sees (with the client\'s explicit permission) the verdict layer on the decisions the client runs.\n\nThe practitioner does not see individual votes or entries · only the synthesised verdict, the same the client gets. The pricing for the practitioner tier is being worked out. Email partner@counsel.day if you\'re a practitioner interested in the program.'
    },
    {
      tags: ['Brand'],
      keywords: ['founder', 'james', 'who', 'team', 'company'],
      q: 'Who is behind Counsel.day?',
      a: 'James Graham (data executive · not a clinician). Counsel.day is built solo. The product is pre-launch as of mid-2026.\n\nJames is reachable at admin@counsel.day for anything that doesn\'t fit support@. The codebase is in active development; you may see frequent ship notes.'
    },

    // ---------------- EXAMPLE QUESTIONS · the FAQ section 09 carousel ----------------
    {
      tags: ['Decision', 'Brand'],
      keywords: ['questions', 'example', 'examples', 'sample', 'samples', 'ideas', 'starter', 'starters', 'suggestion', 'suggestions', 'prompts', 'ask', 'kind', 'sort', 'types', 'what', 'whatcanthistool', 'what kind', 'some'],
      q: 'What are some example questions?',
      a: 'There are a hundred real example questions on the FAQ page · 25 Solo, 50 Couple, 25 Family. Which group fits the decision you are carrying?\n\n· SOLO · a decision you make alone (career move, surgery, big purchase, hard truth to tell a friend).\n· COUPLE · two partners decide together (have a child, move overseas, sell the house, go to therapy).\n· FAMILY · a whole household decides (three to six people · move country, sell the family home, send a child to boarding school).\n\nFull list: https://counsel.day/faq.html#example-questions\n\nNone of those fit? Write your own in the composer · the only rule is that it can be answered yes or no and that more than one evening of you has something to say about it.'
    },
    {
      tags: ['Decision'],
      keywords: ['solo', 'questions', 'example', 'examples', 'sample', 'samples', 'alone', 'personal', 'individual'],
      q: 'Show me example Solo questions.',
      a: 'Five from the Solo set (full 25 at https://counsel.day/faq.html#eq-pane-solo):\n\n· Should I leave the job I have for the contract on the table?\n· Should I quit my job and write the book?\n· Should I move to a new country for a year?\n· Should I take the surgery the consultant recommended?\n· Should I take the long flight to see my estranged parent before they die?\n\nSolo decisions cost $9.99 USD each · your first Solo is free. Every example is editable in the composer before you file.'
    },
    {
      tags: ['Decision'],
      keywords: ['couple', 'partner', 'partners', 'two', 'questions', 'example', 'examples', 'sample', 'samples', 'relationship', 'spouse', 'husband', 'wife', 'us'],
      q: 'Show me example Couple questions.',
      a: 'Five from the Couple set (full 50 at https://counsel.day/faq.html#eq-pane-couple):\n\n· Should we have a baby this year?\n· Should we sell the house and rent?\n· Should we move overseas for the year?\n· Should we go to couples therapy?\n· Should we file for divorce?\n\nCouple decisions cost $15.99 USD each · two participants vote nightly, every vote stays sealed until reveal day.'
    },
    {
      tags: ['Decision'],
      keywords: ['family', 'household', 'kids', 'children', 'parents', 'questions', 'example', 'examples', 'sample', 'samples', 'home', 'multigeneration'],
      q: 'Show me example Family questions.',
      a: 'Five from the Family set (full 25 at https://counsel.day/faq.html#eq-pane-family):\n\n· Should we move to a different country as a family?\n· Should we sell the family home?\n· Should we get a family dog?\n· Should we send our eldest to boarding school?\n· Should we move our parent into residential care?\n\nFamily decisions cost $29.99 USD each · three to six participants vote nightly.'
    },

    // ---------------- ACCOUNT · BILLING · SUBSCRIPTION MANAGEMENT ----------------
    {
      tags: ['Billing', 'Tech'],
      keywords: ['comped', 'comp', 'free', 'unlimited', 'granted', 'gift', 'practitioner', 'partner'],
      q: 'I see "Comped" on my account · what does that mean?',
      a: 'A comped account has been granted free unlimited access by Counsel.day. The reason appears on your account page · usually you are an early supporter, partner, practitioner, or were granted free access for support reasons.\n\nWhile comped, you pay $0.00 USD for both products · compose any decision (Solo, Couple, Family) at no charge and use Counsel Journal without a subscription. There is nothing to cancel · the comp can be revoked or reinstated by an admin. See your status on https://counsel.day/account.html.'
    },
    {
      tags: ['Billing', 'Tech'],
      keywords: ['cancel', 'subscription', 'stop', 'unsubscribe', 'end', 'journal'],
      q: 'How do I cancel my Counsel Journal subscription?',
      a: 'Open https://counsel.day/account.html and find the Counsel Journal tile in the Subscription section. Two options:\n\n· "Cancel subscription" · cancels at the end of the current billing period. You keep access until then; no further charges.\n· "Manage in Stripe" · opens the Stripe portal where you can also update your card, download invoices, or cancel from there.\n\nCancellations are reversible from the Stripe portal until the period closes.'
    },
    {
      tags: ['Billing', 'Tech'],
      keywords: ['plan', 'summary', 'paying', 'this month', 'total', 'spending', 'cost', 'overview'],
      q: 'How do I see what I am paying right now?',
      a: 'On https://counsel.day/account.html the "Your current plan and renewal" section opens with a three-cell summary strip: Decision (pay-per-decision), Counsel Journal (subscription state and renewal date), and "This month" (current total).\n\nFor receipts and full billing history, open https://counsel.day/billing.html · per-decision charges and Journal renewals appear in one place.'
    },
    {
      tags: ['Billing'],
      keywords: ['refund', 'money', 'back', 'decision', 'mistake', 'change mind'],
      q: 'Can I refund a decision?',
      a: 'Two automatic-refund cases:\n\n1) BEFORE the first vote lands · full refund, instant, no questions. The decision is cancelled and any invites withdrawn.\n2) IF an invitee does not accept within 7 days · automatic full refund. The decision is cancelled.\n\nAfter the first vote, the decision must run to completion · the seal is a contract. For exceptional cases (a clear product failure, an emergency) email support@counsel.day with the decision ID.'
    },

    // ---------------- SECURITY · MFA · ACCOUNT MANAGEMENT ----------------
    {
      tags: ['Privacy', 'Tech'],
      keywords: ['mfa', 'two factor', '2fa', 'security', 'totp', 'authenticator', 'protect'],
      q: 'How do I enable two-factor authentication (MFA)?',
      a: 'Open https://counsel.day/account.html under "Security" and click Enable MFA. We support TOTP authenticator apps (Google Authenticator, 1Password, Authy, etc.).\n\nFor admin accounts: destructive admin actions (promote, demote, delete a user) require a FRESH MFA challenge · within five minutes of the action · even if you are already signed in. For non-admin accounts MFA is optional but recommended.'
    },
    {
      tags: ['Tech'],
      keywords: ['session', 'sign out', 'device', 'logout', 'logged in', 'devices'],
      q: 'How do I sign out from another device?',
      a: 'On https://counsel.day/account.html under "Devices and sessions" you see every active session · device label, last-active timestamp, and a "Revoke" button. Click Revoke and that session is killed; the device has to sign back in.\n\nIf you suspect unauthorised access, click "Sign out everywhere" to kill every session at once (you stay signed in on your current device).'
    },

    // ---------------- VAULT · SEALED ENTRIES · READING-MODE ----------------
    {
      tags: ['Journal'],
      keywords: ['vault', 'sealed', 'opens', 'cant see', 'where is my entry', 'missing', 'lost'],
      q: 'My latest Journal entry is showing as "sealed" · is it lost?',
      a: 'No · it is saved and safe. Every entry seals for seven days the moment you submit. During those seven days the vault shows the row with a "SEALED · opens [date]" badge instead of the body. You cannot re-read it · that is the point. The seal removes the option so future-you reads what tonight-you actually wrote, not what you wish you had.\n\nOnce the seven days elapse the body unlocks · the text appears, the audio plays back, and that entry feeds into the next Monday verdict. Vault page: https://counsel.day/vault.html.'
    },
    {
      tags: ['Journal'],
      keywords: ['vault', 'audio', 'playback', 'replay', 'listen', 'recording'],
      q: 'How do I play back a Journal audio recording?',
      a: 'On https://counsel.day/vault.html · each entry is a row. Click an unsealed row to expand it · the audio player and full transcript appear together. We sign a short-lived URL to your R2-hosted audio file at click time so the raw audio URL never sits in the client.\n\nSealed entries (within the seven-day window) show a locked badge instead of the player · the seal is enforced server-side too, so a hand-crafted request cannot bypass it.'
    },

    // ---------------- HELPER BOT MECHANICS · so it can explain itself ----------------
    {
      tags: ['Brand', 'Tech'],
      keywords: ['bot', 'helper', 'chatbot', 'llm', 'ai', 'how this works', 'how do you work'],
      q: 'How does this Helper bot actually work?',
      a: 'Entirely in your browser. There is no paid LLM behind this widget · no Claude or OpenAI call when you ask a question. The answers come from a built-in knowledge base of around 40 Q/A entries that ship as part of /helper-widget.js. A keyword-weighted scorer picks the best matching entry and renders it; related entries appear as follow-up chips.\n\nThe upside is that answers come back in milliseconds and cost nothing to serve. The downside is that we cannot answer free-form questions outside the index · for those, email support@counsel.day.'
    },

    // ---------------- STATUS / OPERATIONAL ----------------
    {
      tags: ['Tech'],
      keywords: ['status', 'uptime', 'down', 'outage', 'incident', 'health', 'broken', 'working'],
      q: 'Is Counsel.day up? How do I check status?',
      a: 'Open https://counsel.day/status.html · the page lists every service (web, API, database, Stripe webhooks, Anthropic verdict generation, R2 audio storage, Whisper transcription, email) with its current state and last-checked timestamp. Incidents in the last 30 days are listed below.\n\nFor release-related downtime, the https://counsel.day/changelog.html lists every ship.'
    }
  ];

  // ---------------------------------------------------------------------
  // Lightweight tokenizer · lowercases, strips punctuation, removes
  // stop-words. The scorer awards a match on each remaining token,
  // weighted by token length (so "subscription" outweighs "the").
  // ---------------------------------------------------------------------
  var STOP = {
    'a':1,'an':1,'and':1,'are':1,'as':1,'at':1,'be':1,'by':1,'do':1,'does':1,'for':1,'from':1,
    'have':1,'has':1,'i':1,'if':1,'in':1,'is':1,'it':1,'its':1,'me':1,'my':1,'of':1,'on':1,
    'or':1,'so':1,'that':1,'the':1,'their':1,'them':1,'they':1,'this':1,'to':1,'was':1,
    'we':1,'what':1,'when':1,'where':1,'which':1,'who':1,'why':1,'with':1,'will':1,'you':1,
    'your':1,'yours':1,'can':1,'should':1,'would':1,'could':1,'about':1,'any':1,'all':1
  };
  function tokenize(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(function (t) { return t.length > 1 && !STOP[t]; });
  }

  // For each KB entry, pre-build a combined searchable token set
  // (keywords + question text + tags). Done once at load.
  KB.forEach(function (entry) {
    var bag = {};
    (entry.keywords || []).forEach(function (k) { bag[k.toLowerCase()] = (bag[k.toLowerCase()] || 0) + 3; });
    tokenize(entry.q).forEach(function (t) { bag[t] = (bag[t] || 0) + 1; });
    (entry.tags || []).forEach(function (t) { bag[t.toLowerCase()] = (bag[t.toLowerCase()] || 0) + 2; });
    entry._bag = bag;
  });

  function bestMatch(query) {
    var qtokens = tokenize(query);
    if (qtokens.length === 0) return null;
    var scored = KB.map(function (entry) {
      var score = 0;
      qtokens.forEach(function (t) { if (entry._bag[t]) score += entry._bag[t] * Math.min(t.length, 6); });
      return { entry: entry, score: score };
    }).filter(function (x) { return x.score > 0; });
    scored.sort(function (a, b) { return b.score - a.score; });
    if (scored.length === 0 || scored[0].score < 3) return null;
    // Return top match + up to 4 alternatives if their score is at least
    // half of the top score · gives the user a chance to disambiguate.
    // 4 (was 2) so the example-questions entry can fan out Solo / Couple
    // / Family chips alongside other related entries.
    var alts = scored.slice(1, 5).filter(function (x) { return x.score >= scored[0].score * 0.5; });
    return { top: scored[0].entry, alts: alts.map(function (x) { return x.entry; }) };
  }

  // ---------------------------------------------------------------------
  // DOM · launcher + drawer. Drawer dimensions are 50% larger than the
  // prior iteration (570×810 vs 380×540). Launcher button is also
  // bumped so it doesn't look orphaned next to the bigger drawer.
  // ---------------------------------------------------------------------
  var style = document.createElement('style');
  style.textContent = [
    '.cd-help-launcher { position: fixed; right: 22px; bottom: 22px; z-index: 9998; }',
    '.cd-help-launcher-btn { display: inline-flex; align-items: center; gap: 10px; padding: 14px 22px; background: var(--wine, #722F37); color: var(--paper, #ffffff); border: 1px solid var(--wine, #722F37); font-family: var(--font-mono, ui-monospace, monospace); font-size: 14px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer; border-radius: 0; box-shadow: 0 4px 12px rgba(0,0,0,0.12); }',
    '.cd-help-launcher-btn:hover { background: var(--wine-deep, #5a242c); border-color: var(--wine-deep, #5a242c); }',
    '.cd-help-launcher-btn:focus-visible { outline: 2px solid #ffffff; outline-offset: 2px; }',
    '.cd-help-launcher-btn .ico { display: inline-block; width: 18px; height: 18px; flex-shrink: 0; }',
    '.cd-help-launcher-btn .ico svg { width: 100%; height: 100%; display: block; }',

    /* 712 × 1012 · TASK 5 (2026-06-05) bump · further 25% bigger than
       the prior 570 × 810 widget (which was itself 50% bigger than the
       original 380 × 540). Caps via max-width/height so it still fits
       a phone in landscape. */
    '.cd-help-drawer { position: fixed; right: 22px; bottom: 22px; z-index: 9999; width: 712px; max-width: calc(100vw - 36px); height: 1012px; max-height: calc(100vh - 36px); background: var(--paper, #ffffff); border: 1px solid var(--ink, #1c1a17); display: none; flex-direction: column; box-shadow: 0 10px 36px rgba(0,0,0,0.18); font-family: var(--font-body, ui-serif, serif); }',
    '.cd-help-drawer.is-open { display: flex; }',
    '.cd-help-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 14px 18px; background: var(--ink, #1c1a17); color: var(--paper, #ffffff); }',
    '.cd-help-head-l { display: flex; align-items: center; gap: 10px; }',
    '.cd-help-head .lbl { font-family: var(--font-mono, ui-monospace, monospace); font-size: 12px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--paper, #ffffff); }',
    '.cd-help-head .sub { font-family: var(--font-mono, ui-monospace, monospace); font-size: 10px; letter-spacing: 0.08em; color: rgba(255,255,255,0.6); margin-left: 8px; }',
    '.cd-help-close { background: transparent; border: 1px solid rgba(255,255,255,0.3); color: var(--paper, #ffffff); font-family: var(--font-mono, ui-monospace, monospace); font-size: 11px; letter-spacing: 0.08em; padding: 6px 10px; cursor: pointer; border-radius: 0; }',
    '.cd-help-close:hover { border-color: rgba(255,255,255,0.6); }',

    '.cd-help-body { flex: 1; overflow-y: auto; padding: 18px 20px; }',
    '.cd-help-empty { font-family: var(--font-body, ui-serif, serif); font-size: 14px; line-height: 1.55; color: var(--ink-soft, #38332f); }',
    '.cd-help-empty p { margin: 0 0 10px; }',
    '.cd-help-empty .lead { font-family: var(--font-display, ui-serif, serif); font-weight: 400; font-size: 19px; color: var(--ink); margin-bottom: 6px; }',
    '.cd-help-chips { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 14px; }',
    '.cd-help-chip { text-align: left; padding: 9px 12px; background: var(--paper, #ffffff); border: 1px solid var(--rule, #e3dfd9); color: var(--ink, #1c1a17); font-family: var(--font-body, ui-serif, serif); font-size: 13px; line-height: 1.4; cursor: pointer; border-radius: 0; }',
    '.cd-help-chip:hover { border-color: var(--wine, #722F37); background: var(--wine-soft, #f6e8e9); }',
    '.cd-help-tagstrip { display: flex; flex-wrap: wrap; gap: 5px; margin: 10px 0 0; }',
    '.cd-help-tag { font-family: var(--font-mono, ui-monospace, monospace); font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; padding: 3px 7px; border: 1px solid var(--rule, #e3dfd9); color: var(--ink-soft, #38332f); background: var(--paper, #ffffff); cursor: pointer; border-radius: 0; }',
    '.cd-help-tag.is-on { background: var(--wine, #722F37); color: var(--paper, #ffffff); border-color: var(--wine, #722F37); }',

    '.cd-help-msg { margin-bottom: 14px; }',
    '.cd-help-msg .role { font-family: var(--font-mono, ui-monospace, monospace); font-size: 10px; font-weight: 600; letter-spacing: 0.12em; color: var(--muted, #8a847d); text-transform: uppercase; margin-bottom: 4px; }',
    '.cd-help-msg .bubble { font-family: var(--font-body, ui-serif, serif); font-size: 14px; line-height: 1.55; color: var(--ink, #1c1a17); padding: 12px 14px; background: var(--paper-deep, #faf8f4); border-left: 3px solid var(--rule, #e3dfd9); }',
    '.cd-help-msg .bubble p { margin: 0 0 10px; }',
    '.cd-help-msg .bubble p:last-child { margin-bottom: 0; }',
    '.cd-help-msg.user .bubble { border-left-color: var(--wine, #722F37); }',
    '.cd-help-msg.system .bubble { background: #fdecea; border-left-color: #c0392b; color: #6b1e16; }',
    '.cd-help-msg .alts { margin-top: 8px; }',
    '.cd-help-msg .alts-lbl { font-family: var(--font-mono, ui-monospace, monospace); font-size: 10px; letter-spacing: 0.08em; color: var(--muted, #8a847d); text-transform: uppercase; margin-bottom: 4px; }',

    '.cd-help-form { display: flex; gap: 8px; border-top: 1px solid var(--rule, #e3dfd9); padding: 12px 14px; }',
    '.cd-help-input { flex: 1; min-height: 42px; max-height: 110px; resize: vertical; padding: 9px 11px; font-family: var(--font-body, ui-serif, serif); font-size: 14px; border: 1px solid var(--rule, #e3dfd9); background: var(--paper, #ffffff); color: var(--ink, #1c1a17); border-radius: 0; }',
    '.cd-help-input:focus { outline: none; border-color: var(--wine, #722F37); }',
    '.cd-help-send { padding: 9px 16px; background: var(--wine, #722F37); color: var(--paper, #ffffff); border: 1px solid var(--wine, #722F37); font-family: var(--font-mono, ui-monospace, monospace); font-size: 12px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; cursor: pointer; border-radius: 0; }',
    '.cd-help-send:hover { background: var(--wine-deep, #5a242c); }',
    '.cd-help-foot { padding: 8px 14px; font-family: var(--font-mono, ui-monospace, monospace); font-size: 10px; letter-spacing: 0.08em; color: var(--muted, #8a847d); text-transform: uppercase; border-top: 1px solid var(--rule, #e3dfd9); }',
    '.cd-help-foot a { color: var(--wine, #722F37); }',

    '@media (max-width: 700px) {',
      '.cd-help-drawer { right: 10px; left: 10px; bottom: 10px; width: auto; max-width: none; height: 86vh; }',
      '.cd-help-launcher { right: 12px; bottom: 12px; }',
      '.cd-help-launcher-btn { padding: 12px 16px; }',
      '.cd-help-chips { grid-template-columns: 1fr; }',
    '}',
  ].join('\n');
  document.head.appendChild(style);

  // Build launcher.
  var launcher = el('div', { 'class': 'cd-help-launcher', 'role': 'region', 'aria-label': 'Helper bot' });
  var launcherBtn = el('button', {
    type: 'button',
    'class': 'cd-help-launcher-btn',
    'aria-haspopup': 'dialog',
    'aria-expanded': 'false',
    'aria-controls': 'cd-help-drawer',
  }, '<span class="ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg></span><span>Help</span>');
  launcher.appendChild(launcherBtn);

  // Build drawer.
  var drawer = el('div', {
    id: 'cd-help-drawer',
    'class': 'cd-help-drawer',
    role: 'dialog',
    'aria-label': 'Counsel.day helper bot',
  });

  // Build the initial-state chip grid · 8 starter questions across
  // both products. The user can click a chip OR type their own.
  // TASK 5 · "Can I refund a decision?" is moved into the umbrella
  // refund entry; "What are some example questions?" takes the lead
  // chip since the carousel is the most-clicked surface right now.
  var STARTER_QS = [
    'What are some example questions?',
    'How does a Counsel.day decision actually work?',
    'How much does the Couple tier cost?',
    'How much does Counsel Journal cost?',
    'How does Counsel Journal work day-to-day?',
    'Does this replace therapy?',
    'What does Counsel.day do with my data?',
    'How do I cancel my Counsel Journal subscription?'
  ];

  drawer.innerHTML =
    '<div class="cd-help-head">' +
      '<div class="cd-help-head-l">' +
        '<span class="lbl">Helper</span>' +
        '<span class="sub">offline · no LLM · indexed answers</span>' +
      '</div>' +
      '<button type="button" class="cd-help-close" id="cd-help-close" aria-label="Close helper">Close</button>' +
    '</div>' +
    '<div class="cd-help-body" id="cd-help-body">' +
      '<div class="cd-help-empty" id="cd-help-empty">' +
        '<p class="lead">Ask about Counsel.day.</p>' +
        '<p>Factual questions · pricing, the sealed-vote method, billing, refunds, the Journal, privacy. Answers come from a built-in index, not a paid LLM, so this widget stays free to run and ships in milliseconds.</p>' +
        '<p>For your actual decision, the product is the answer.</p>' +
        '<div class="cd-help-chips">' +
          STARTER_QS.map(function (q) { return '<button type="button" class="cd-help-chip" data-q="' + esc(q) + '">' + esc(q) + '</button>'; }).join('') +
        '</div>' +
      '</div>' +
    '</div>' +
    '<form class="cd-help-form" id="cd-help-form">' +
      '<textarea class="cd-help-input" id="cd-help-input" placeholder="Ask about pricing, billing, the seal, the Journal, refunds…" maxlength="1000" required></textarea>' +
      '<button type="submit" class="cd-help-send" id="cd-help-send">Ask</button>' +
    '</form>' +
    '<div class="cd-help-foot">Need a human? <a href="mailto:support@counsel.day?subject=Helper%20question">Email support@counsel.day</a></div>';

  document.body.appendChild(launcher);
  document.body.appendChild(drawer);

  var bodyEl = $('#cd-help-body', drawer);
  var emptyEl = $('#cd-help-empty', drawer);
  var form = $('#cd-help-form', drawer);
  var input = $('#cd-help-input', drawer);
  var closeBtn = $('#cd-help-close', drawer);

  function openDrawer() {
    drawer.classList.add('is-open');
    launcher.style.display = 'none';
    launcherBtn.setAttribute('aria-expanded', 'true');
    setTimeout(function () { input && input.focus(); }, 60);
  }
  function closeDrawer() {
    drawer.classList.remove('is-open');
    launcher.style.display = '';
    launcherBtn.setAttribute('aria-expanded', 'false');
  }

  launcherBtn.addEventListener('click', openDrawer);
  closeBtn.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && drawer.classList.contains('is-open')) closeDrawer();
  });

  // Render answer text into HTML paragraphs. URLs are auto-linked
  // AFTER esc() so the answers can include https://counsel.day/… and
  // friends and the user can click through (e.g. to the FAQ example-
  // questions carousel) without losing the same-origin context.
  function paragraphs(text) {
    var urlRe = /(https?:\/\/[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+)/g;
    return String(text || '').split(/\n\n+/).map(function (p) {
      var safe = esc(p).replace(/\n/g, '<br>');
      var linked = safe.replace(urlRe, function (m) {
        // Local links open in-place · external open in a new tab so the
        // helper drawer state isn't lost.
        var external = m.indexOf('counsel.day') === -1;
        return '<a href="' + m + '"' + (external ? ' target="_blank" rel="noopener"' : '') + ' style="color: var(--wine, #722F37); border-bottom: 1px solid var(--wine, #722F37); padding-bottom: 1px; text-decoration: none;">' + m + '</a>';
      });
      return '<p>' + linked + '</p>';
    }).join('');
  }

  function appendMsg(role, html) {
    if (emptyEl && !emptyEl.classList.contains('is-hidden')) {
      emptyEl.classList.add('is-hidden');
      emptyEl.style.display = 'none';
    }
    var wrap = el('div', { 'class': 'cd-help-msg ' + role });
    wrap.innerHTML =
      '<div class="role">' + (role === 'user' ? 'You' : 'Helper') + '</div>' +
      '<div class="bubble">' + html + '</div>';
    bodyEl.appendChild(wrap);
    bodyEl.scrollTop = bodyEl.scrollHeight;
    return wrap;
  }

  function answer(query) {
    var match = bestMatch(query);
    if (!match) {
      var sysWrap = appendMsg('assistant',
        paragraphs('I don\'t have a direct answer for that question in the built-in index. Try rephrasing with a keyword like pricing, refund, seal, vault, MFA, or therapy · or email support@counsel.day for a human reply.') +
        '<div class="alts"><div class="alts-lbl">Topics in the index</div><div class="cd-help-chips">' +
          ['Pricing', 'Decision', 'Journal', 'Billing', 'Privacy', 'Tech', 'Brand'].map(function (t) { return '<button type="button" class="cd-help-tag" data-tag="' + esc(t) + '">' + esc(t) + '</button>'; }).join('') +
        '</div></div>'
      );
      return;
    }
    var html = paragraphs(match.top.a);
    if (match.alts && match.alts.length > 0) {
      html += '<div class="alts"><div class="alts-lbl">Related</div><div class="cd-help-chips">' +
        match.alts.map(function (e) { return '<button type="button" class="cd-help-chip" data-q="' + esc(e.q) + '">' + esc(e.q) + '</button>'; }).join('') +
        '</div></div>';
    }
    appendMsg('assistant', html);
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var text = String(input.value || '').trim();
    if (!text) return;
    input.value = '';
    appendMsg('user', esc(text));
    answer(text);
  });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
  });

  // Click handlers · chips (set the textarea + submit), tags (filter
  // the KB to that tag and show the top three entries from it).
  bodyEl.addEventListener('click', function (e) {
    var chip = e.target.closest('.cd-help-chip');
    if (chip) {
      var q = chip.getAttribute('data-q') || chip.textContent.trim();
      input.value = q;
      form.requestSubmit();
      return;
    }
    var tag = e.target.closest('.cd-help-tag');
    if (tag) {
      var t = tag.getAttribute('data-tag');
      var inTag = KB.filter(function (entry) { return (entry.tags || []).indexOf(t) !== -1; }).slice(0, 4);
      appendMsg('assistant',
        '<p>Top questions tagged <strong>' + esc(t) + '</strong>:</p>' +
        '<div class="alts"><div class="cd-help-chips">' +
          inTag.map(function (entry) { return '<button type="button" class="cd-help-chip" data-q="' + esc(entry.q) + '">' + esc(entry.q) + '</button>'; }).join('') +
        '</div></div>'
      );
    }
  });
})();
