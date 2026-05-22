/**
 * Security-event notification emails.
 *
 * Hardening: when a state-changing event hits a user's account (password
 * changed, MFA enrolled, MFA disabled, email changed), send the user a
 * notification email so account-takeover attempts surface in real-time.
 *
 * Best-effort: a Brevo failure must not block the security action that
 * triggered it. All sends are fire-and-forget with a console.warn on
 * failure; the underlying action (password change, MFA toggle) already
 * succeeded by the time we get here.
 *
 * Audit: every send writes a 'security.notify.sent' row to audit_log
 * so the operator can see the notification history.
 */

import { db, schema } from './db';
import { eq } from 'drizzle-orm';
import { sendTransactional } from './email';

export type SecurityEvent =
  | 'password.changed'
  | 'password.set_first_time'
  | 'mfa.enrolled'
  | 'mfa.disabled'
  | 'email.changed';

const EVENT_COPY: Record<SecurityEvent, { subject: string; headline: string; body: string }> = {
  'password.changed': {
    subject: 'Your Counsel.day password was changed',
    headline: 'Password changed',
    body: 'The password on your Counsel.day account was just changed. If this was you, no action needed · this email is a routine security notice. If it was NOT you, reply to this message immediately and we will lock the account.',
  },
  'password.set_first_time': {
    subject: 'A password was set on your Counsel.day account',
    headline: 'Password set',
    body: 'A password was just set on your Counsel.day account, which previously used magic-link sign-in only. If this was you, no action needed. If it was NOT you, reply to this message immediately.',
  },
  'mfa.enrolled': {
    subject: 'Two-factor authentication enabled on your Counsel.day account',
    headline: 'MFA enabled',
    body: 'Two-factor authentication was just enabled on your Counsel.day account. From now on, signing in requires both your password AND a code from your authenticator app. If this was you, no action needed. If it was NOT you, reply to this message immediately.',
  },
  'mfa.disabled': {
    subject: 'Two-factor authentication DISABLED on your Counsel.day account',
    headline: 'MFA disabled',
    body: 'Two-factor authentication was just disabled on your Counsel.day account. Your account now uses password-only sign-in. If this was you, no action needed · you can re-enable MFA any time in Account -> Security. If it was NOT you, reply to this message immediately and we will lock the account.',
  },
  'email.changed': {
    subject: 'The email on your Counsel.day account was changed',
    headline: 'Email address changed',
    body: 'The email address on your Counsel.day account was just changed. This email is going to the OLD address as a security record. The new address is now the primary contact for your account. If this was NOT you, reply to this message immediately.',
  },
};

export async function notifySecurityEvent(args: {
  userId: string;
  event: SecurityEvent;
  ip?: string | null;
  userAgent?: string | null;
  // Optional override · used by email-change flow where we want to
  // notify the OLD address rather than the user's current one.
  toEmail?: string | null;
}): Promise<void> {
  try {
    const userRows = await db
      .select({ email: schema.users.email, firstName: schema.users.firstName })
      .from(schema.users)
      .where(eq(schema.users.id, args.userId))
      .limit(1);
    const user = userRows[0];
    if (!user) return;
    const to = args.toEmail ?? user.email;
    const copy = EVENT_COPY[args.event];
    if (!copy) return;

    const greeting = user.firstName ? `Hi ${user.firstName},` : 'Hi,';
    const when = new Date().toLocaleString('en-NZ', { dateStyle: 'long', timeStyle: 'short' });
    const ipLine = args.ip ? `\nFrom IP: ${args.ip}` : '';
    const uaLine = args.userAgent ? `\nDevice: ${args.userAgent.slice(0, 160)}` : '';

    const text = [
      greeting,
      '',
      copy.body,
      '',
      'When: ' + when + ipLine + uaLine,
      '',
      'You can review every change to your account at https://counsel.day/account.html · Security tab.',
      '',
      '· Counsel.day',
    ].join('\n');

    const html = `
      <p>${greeting}</p>
      <p style="font-family: Georgia, serif; font-size: 15px; line-height: 1.6;">${copy.body}</p>
      <div style="font-family: 'Geist Mono', monospace; font-size: 12px; color: #6b635a; border-left: 3px solid #722F37; padding: 8px 14px; margin: 20px 0;">
        <div><strong>When:</strong> ${when}</div>
        ${args.ip ? `<div><strong>IP:</strong> ${args.ip}</div>` : ''}
        ${args.userAgent ? `<div><strong>Device:</strong> ${String(args.userAgent).slice(0, 160).replace(/</g, '&lt;')}</div>` : ''}
      </div>
      <p style="font-family: Georgia, serif;">Review every change to your account at <a href="https://counsel.day/account.html" style="color: #722F37;">counsel.day/account.html</a> &middot; Security tab.</p>
      <p style="font-family: 'Geist Mono', monospace; font-size: 11px; color: #6b635a; margin-top: 24px;">&middot; Counsel.day</p>
    `.trim();

    await sendTransactional({
      to: { email: to, name: user.firstName ?? undefined },
      subject: copy.subject,
      textContent: text,
      htmlContent: html,
    });

    await db.insert(schema.auditLog).values({
      actorUserId: args.userId,
      action: 'security.notify.sent',
      targetType: 'user',
      targetId: args.userId,
      metadata: { event: args.event, ip: args.ip ?? null, sent_to: to },
    }).catch(() => {});
  } catch (err) {
    console.warn('[security-notify] send failed for ' + args.event + ':', (err as Error).message);
  }
}
