/**
 * POST /api/chatbot/message
 *
 * The Counsel.day helper chatbot. Answers PRODUCT questions only ·
 * pricing, how the sealed-vote method works, account/billing, refunds,
 * privacy, technical issues. Refuses anything that smells like a
 * personal decision, relationship advice, or therapy.
 *
 * Why this exists: support volume on a sealed-vote product is mostly
 * "how does the duration work" / "where's my verdict" / "how do I
 * cancel" · the chatbot deflects the obvious ones; everything else
 * escalates cleanly to support@counsel.day.
 *
 * Request body:
 *   { history?: [{ role: 'user'|'assistant', content: string }], message: string }
 * Response body:
 *   { ok: true, reply: string, escalate: boolean, conversation_tokens: number }
 *
 * Auth: signed-in users only. Anonymous traffic would let abuse drain
 * the API ledger; the rate limit per user is 30 messages / hour, 200 /
 * day. Hit either and the next call returns 429.
 */

import { NextResponse } from 'next/server';
import { readSession, readSessionCookie } from '@/lib/sessions';
import { checkRateLimit, rateLimitResponse, getClientIp } from '@/lib/rate-limit';
import { callAnthropic } from '@/lib/anthropic-call';
import { getAnthropic } from '@/lib/anthropic';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Chatbot uses the cheapest Sonnet-class model the operator has wired
// up. Override via env if we ever flip to Haiku for cost (chatbot
// answers are short, Haiku 4.5 would be ~5x cheaper). Default falls
// back to the same VERDICT_AI_MODEL so a single env var controls both.
const CHATBOT_MODEL = process.env.CHATBOT_AI_MODEL
  || process.env.VERDICT_AI_MODEL
  || 'claude-sonnet-4-6';

const CHATBOT_SYSTEM_PROMPT = `You are the Counsel.day helper bot. You answer FACTUAL questions about the product only. You do not give advice about decisions, relationships, mental health, or life choices · those belong inside the product itself (one sealed vote per evening, for a duration the user chose).

SCOPE · what you answer
- How Counsel.day works (sealed votes, durations, tiers, verdicts).
- Pricing: Solo Free is $0 USD (numerical summary only, no AI verdict). Solo Paid is $9.99 USD per decision. Couple is $19.99 USD per decision. Family is $29.99 USD per decision. All prices in USD, worldwide.
- Account management (sign-in, password reset, MFA setup, billing portal, refunds).
- Technical issues (verdict not generating, vote not saving, can't sign in, email not arriving).
- Privacy, GDPR, data export, data deletion, how to delete an account.
- What features exist on which tier.
- How time capsules work (6 / 12 / 24 month re-delivery).
- How the verdict report (premium) differs from the basic verdict reveal.

SCOPE · what you refuse
- Personal decision questions ("should I move?", "should we have a baby?", "is my marriage okay?"). The answer is always the product itself.
- Relationship, parenting, family, friendship advice.
- Mental health, therapy, medical, legal, financial recommendations.
- Anything outside Counsel.day product knowledge.

When you refuse, say (exactly, do not paraphrase, do not soften):
"I only answer questions about how Counsel.day works. For your actual decision, the product is the answer · open a sealed vote and let time do the work."

When you do not know the answer, escalate:
"I don't know the answer to that. Email support@counsel.day and the team will reply within one business day."

TONE
- Concise. 2 to 4 sentences unless the question genuinely needs more.
- No em-dashes or en-dashes ever. Use the middle dot ( · ), a colon, or a semicolon as separators within sentences.
- No emoji. No bullet lists unless the question is a literal list ("what tiers exist").
- First-person plural ("we") when speaking for Counsel.day. Never "I think" · the bot has no opinion.
- Never claim to be a human; if asked, say "I'm the Counsel.day helper bot. A real person on the team replies to support@counsel.day."

CRITICAL · safety rails
- Never recommend therapy, never discourage therapy, never refer to anyone as a "therapist" except in the context of the Counsel.day therapist referral program (which is a sales channel, not a clinical service).
- Never tell a user they are "right" or "wrong" about a decision. Counsel.day reports; it does not judge.
- Never store, repeat back, or quote a user's decision content beyond what is necessary to answer their product question.`;

export async function POST(req: Request) {
  const session = await readSession(readSessionCookie(req.headers));
  if (!session) {
    return NextResponse.json({ ok: false, message: 'Sign in to use the helper bot.' }, { status: 401 });
  }

  // Rate-limit on userId (primary) AND IP (defence in depth · two
  // hits from the same IP using different accounts are still both
  // counted). The user-level limit is the meaningful one.
  const ip = getClientIp(req);
  const hourly = await checkRateLimit(`chatbot-user-hour:${session.userId}`, 30, 3600);
  if (!hourly.allowed) return rateLimitResponse(hourly, 'You\'ve hit the helper-bot rate limit. Try again in an hour, or email support@counsel.day.');
  const daily = await checkRateLimit(`chatbot-user-day:${session.userId}`, 200, 86400);
  if (!daily.allowed) return rateLimitResponse(daily, 'Daily helper-bot limit reached. Email support@counsel.day if you need more.');
  // IP cap higher · we still want to slow down obvious abuse.
  const ipHourly = await checkRateLimit(`chatbot-ip-hour:${ip}`, 90, 3600);
  if (!ipHourly.allowed) return rateLimitResponse(ipHourly);

  let body: { history?: unknown; message?: unknown } = {};
  try { body = await req.json(); } catch { /* keep empty · validation below */ }

  const message = String(body.message ?? '').trim();
  if (!message) {
    return NextResponse.json({ ok: false, message: 'Empty message.' }, { status: 400 });
  }
  if (message.length > 2000) {
    return NextResponse.json({ ok: false, message: 'Message too long (max 2000 chars).' }, { status: 400 });
  }

  // History · max 12 turns retained, trimmed to last 8 to keep input
  // tokens predictable. Each role/content sanitised.
  const historyIn: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  if (Array.isArray(body.history)) {
    for (const turn of body.history.slice(-12)) {
      const t = turn as { role?: string; content?: string };
      if (t.role !== 'user' && t.role !== 'assistant') continue;
      const content = String(t.content ?? '').slice(0, 2000);
      if (!content) continue;
      historyIn.push({ role: t.role, content });
    }
  }
  const history = historyIn.slice(-8);

  if (!getAnthropic()) {
    return NextResponse.json({
      ok: false,
      message: 'The helper bot is offline (Anthropic key not configured). Email support@counsel.day for help.',
    }, { status: 503 });
  }

  try {
    const call = await callAnthropic(
      { source: 'chatbot' },
      {
        model: CHATBOT_MODEL,
        // Short answers; cap aggressively so a single bad turn can't
        // generate an unbounded essay.
        max_tokens: 600,
        system: [
          { type: 'text', text: CHATBOT_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
        ],
        messages: [
          ...history,
          { role: 'user', content: message },
        ],
      }
    );
    const msg = call.message;
    const reply = msg.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { text: string }).text)
      .join('\n')
      .trim();

    // Heuristic: if the reply contains the literal escalation phrase
    // from the system prompt, surface escalate=true so the frontend
    // can render the "Email support" button prominently.
    const escalate = /support@counsel\.day/i.test(reply);

    return NextResponse.json(
      {
        ok: true,
        reply,
        escalate,
        tokens_input: call.tokensInput,
        tokens_output: call.tokensOutput,
      },
      { status: 200, headers: { 'cache-control': 'private, no-store' } }
    );
  } catch (err) {
    console.warn('[chatbot] anthropic call failed:', (err as Error).message);
    return NextResponse.json({
      ok: false,
      message: 'The helper bot is having trouble right now. Email support@counsel.day if you need a quick answer.',
    }, { status: 502 });
  }
}
