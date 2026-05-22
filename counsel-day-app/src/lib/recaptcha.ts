/**
 * Google reCAPTCHA v2 server-side verification.
 *
 * Activation: set RECAPTCHA_SITE_KEY + RECAPTCHA_SECRET_KEY in
 * /etc/counsel-day-app/env.local. Register the keys at
 * https://www.google.com/recaptcha/admin · choose reCAPTCHA v2
 * ("I'm not a robot" checkbox), add counsel.day as an allowed
 * domain. Without keys the helpers below return null / false and
 * callers should treat the captcha as not configured (i.e. fall
 * back to a hard rate limit rather than blocking the user).
 *
 * Used by the chatbot burst gate (src/app/api/chatbot/message) ·
 * after 5 messages in 10 minutes the next request gets a 429 with
 * `recaptcha_required: true`. The browser renders the widget,
 * collects a token, posts it back, server verifies via Google. On
 * success the burst counter resets for that user.
 */

const VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';

export function recaptchaConfigured(): boolean {
  return !!(process.env.RECAPTCHA_SITE_KEY && process.env.RECAPTCHA_SECRET_KEY);
}

export function recaptchaSiteKey(): string | null {
  return process.env.RECAPTCHA_SITE_KEY?.trim() || null;
}

/**
 * Verifies a v2 token with Google. Returns true on success, false on
 * any failure mode (bad token, network error, key not configured).
 * Logs the failure reason to the server console for diagnosis · does
 * NOT leak Google's error codes to the caller.
 */
export async function verifyRecaptchaToken(token: string, remoteIp?: string): Promise<boolean> {
  const secret = process.env.RECAPTCHA_SECRET_KEY?.trim();
  if (!secret) {
    console.warn('[recaptcha] RECAPTCHA_SECRET_KEY not set; rejecting verify call');
    return false;
  }
  if (!token || token.length < 20) return false;

  const form = new URLSearchParams();
  form.set('secret', secret);
  form.set('response', token);
  if (remoteIp) form.set('remoteip', remoteIp);

  try {
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    if (!res.ok) {
      console.warn('[recaptcha] verify HTTP', res.status);
      return false;
    }
    const data = (await res.json()) as { success?: boolean; 'error-codes'?: string[] };
    if (!data.success) {
      console.warn('[recaptcha] verify failed:', (data['error-codes'] ?? []).join(', '));
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[recaptcha] verify threw:', (err as Error).message);
    return false;
  }
}
