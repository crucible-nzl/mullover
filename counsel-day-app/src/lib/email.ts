/**
 * Email sender. Stub for v1: logs to stdout and returns success.
 * Wire up Brevo's transactional API in the next round.
 *
 * Brevo docs: https://developers.brevo.com/reference/sendtransacemail
 */

interface SendArgs {
  to: { email: string; name?: string };
  subject: string;
  htmlContent: string;
  textContent: string;
}

/**
 * Sender: must be a validated sender in Brevo (Senders & IP → Senders) OR
 * a domain authenticated via DKIM/SPF/DMARC. counsel.day is authenticated
 * as of 17 May 2026, so hello@counsel.day is the canonical From: address.
 * BREVO_SENDER_EMAIL env var overrides for testing / migrations.
 */
const SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL ?? 'hello@counsel.day';
const SENDER_NAME = process.env.BREVO_SENDER_NAME ?? 'Counsel.day';

export async function sendTransactional(args: SendArgs): Promise<{ ok: true } | { ok: false; reason: string }> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.log('[email · stub · no BREVO_API_KEY set]', {
      to: args.to.email,
      subject: args.subject,
    });
    return { ok: true };
  }

  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { email: SENDER_EMAIL, name: SENDER_NAME },
        to: [args.to],
        subject: args.subject,
        htmlContent: args.htmlContent,
        textContent: args.textContent,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      const reason = `brevo ${res.status}: ${body.slice(0, 200)}`;
      console.warn('[email · brevo rejected]', { to: args.to.email, subject: args.subject, reason });
      return { ok: false, reason };
    }
    const payload = (await res.json().catch(() => ({}))) as { messageId?: string };
    console.log('[email · sent]', { to: args.to.email, subject: args.subject, messageId: payload.messageId });
    return { ok: true };
  } catch (err) {
    const reason = (err as Error).message;
    console.warn('[email · transport error]', { to: args.to.email, subject: args.subject, reason });
    return { ok: false, reason };
  }
}

export function buildVerificationEmail(opts: { firstName: string; verifyUrl: string }) {
  const greeting = opts.firstName ? `Hi ${opts.firstName},` : 'Hi,';
  const text = [
    greeting,
    '',
    'Thanks for starting an account at Counsel.day. Click the link below to verify your email and finish signup. The link is good for one hour.',
    '',
    opts.verifyUrl,
    '',
    'If you did not start a Counsel.day account, you can ignore this message. Nothing else will happen.',
    '',
    '· Counsel.day',
  ].join('\n');
  const html = `
    <p>${greeting}</p>
    <p>Thanks for starting an account at <strong>Counsel.day</strong>. Click the link below to verify your email and finish signup. The link is good for one hour.</p>
    <p><a href="${opts.verifyUrl}" style="color: #722F37;">${opts.verifyUrl}</a></p>
    <p>If you did not start a Counsel.day account, you can ignore this message. Nothing else will happen.</p>
    <p>· Counsel.day</p>
  `.trim();
  return { text, html };
}

/**
 * Invite email sent to a partner / family member when a decision is composed
 * with their email address. Preview is public; accepting requires creating
 * an account (or signing in) and posting to /api/invite/accept.
 *
 * `ownerName` is the inviter's first name; `displayName` is the name the
 * owner chose for THIS participant; `question` is the decision question.
 */
export function buildInviteEmail(opts: {
  ownerName: string;
  displayName: string;
  question: string;
  inviteUrl: string;
}) {
  const greeting = opts.displayName ? `Hi ${opts.displayName},` : 'Hi,';
  const safeQuestion = opts.question.length > 200 ? opts.question.slice(0, 197) + '...' : opts.question;
  const text = [
    greeting,
    '',
    `${opts.ownerName} has invited you to take part in a Counsel.day decision. The question is:`,
    '',
    `  ${safeQuestion}`,
    '',
    'Counsel.day is a sealed-vote tool. You vote privately each day for the duration of the decision; no one (including the other side) sees any vote until the close date. Open the link below to read the full invitation and accept.',
    '',
    opts.inviteUrl,
    '',
    'If you were not expecting this invitation, you can ignore this message. Nothing else will happen.',
    '',
    '· Counsel.day',
  ].join('\n');
  const html = `
    <p>${greeting}</p>
    <p><strong>${escapeHtml(opts.ownerName)}</strong> has invited you to take part in a Counsel.day decision. The question is:</p>
    <blockquote style="margin: 16px 0; padding: 12px 16px; border-left: 3px solid #722F37; color: #1c1a17;">${escapeHtml(safeQuestion)}</blockquote>
    <p>Counsel.day is a sealed-vote tool. You vote privately each day for the duration of the decision; no one (including the other side) sees any vote until the close date. Open the link below to read the full invitation and accept.</p>
    <p><a href="${opts.inviteUrl}" style="color: #722F37;">${opts.inviteUrl}</a></p>
    <p>If you were not expecting this invitation, you can ignore this message. Nothing else will happen.</p>
    <p>· Counsel.day</p>
  `.trim();
  return { text, html };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
