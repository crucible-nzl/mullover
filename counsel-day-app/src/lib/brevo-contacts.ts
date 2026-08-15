/**
 * Brevo CONTACTS sync · the missing half of the Brevo integration.
 *
 * Why this exists: Brevo keeps its transactional pipe (/v3/smtp/email, which
 * lib/email.ts uses for magic links) completely separate from its Contacts
 * database. Sending someone transactional mail never creates a contact, so
 * months of signups produced exactly zero contacts · the dashboard showed
 * only the hand-created admin@counsel.day. Discovered 2026-08-16 when the
 * user list (6 accounts) was compared against Brevo (1 contact).
 *
 * This module upserts a contact (create-or-update, idempotent) with:
 *   FIRSTNAME          · Brevo built-in attribute
 *   MARKETING_CONSENT  · custom boolean attribute · MUST exist in Brevo
 *                        (Contacts > Settings > Contact attributes) or the
 *                        API rejects the call; we then retry once without
 *                        custom attributes so the contact still lands.
 *
 * Consent posture: creating the contact is operational (Brevo already
 * processes these addresses as our transactional sender, and is a listed
 * sub-processor). MARKETING_CONSENT travels as data so campaign sends can
 * target ONLY the consented segment · sending marketing to consent=false
 * contacts stays forbidden, per privacy.html ("marketing email is opt-in
 * only, everywhere").
 *
 * Every call is best-effort: a Brevo outage must never break signup,
 * verification, or a profile save. Callers use `void upsertBrevoContact(...)`.
 */

const BREVO_CONTACTS_URL = 'https://api.brevo.com/v3/contacts';

export async function upsertBrevoContact(input: {
  email: string;
  firstName?: string | null;
  marketingConsent?: boolean | null;
}): Promise<{ ok: boolean; status: number | null }> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return { ok: false, status: null }; // dev / not configured

  // Optional: drop new contacts into a specific Brevo list (numeric id from
  // the Brevo UI). Without it, contacts land unlisted but searchable.
  const listId = Number(process.env.BREVO_SIGNUP_LIST_ID || '') || null;

  const base: Record<string, unknown> = {
    email: input.email.toLowerCase(),
    updateEnabled: true, // upsert semantics · re-verifying refreshes, never duplicates
    ...(listId ? { listIds: [listId] } : {}),
  };

  const withAttrs = {
    ...base,
    attributes: {
      ...(input.firstName ? { FIRSTNAME: input.firstName } : {}),
      ...(typeof input.marketingConsent === 'boolean'
        ? { MARKETING_CONSENT: input.marketingConsent }
        : {}),
    },
  };

  async function post(body: Record<string, unknown>): Promise<number> {
    const res = await fetch(BREVO_CONTACTS_URL, {
      method: 'POST',
      headers: { 'api-key': apiKey as string, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    return res.status;
  }

  try {
    let status = await post(withAttrs);
    // 400 usually means an attribute Brevo doesn't know (MARKETING_CONSENT
    // not created yet). Retry bare so the contact still lands · a contact
    // without attributes beats no contact, which is exactly the failure
    // mode that went unnoticed for three months.
    if (status === 400) {
      console.warn('[brevo-contacts] 400 with attributes (is MARKETING_CONSENT created in Brevo?) · retrying bare for', input.email.replace(/(.).*(@.*)/, '$1***$2'));
      status = await post(base);
    }
    // 201 created · 204 updated
    return { ok: status === 201 || status === 204, status };
  } catch (err) {
    console.warn('[brevo-contacts] upsert failed:', (err as Error).message);
    return { ok: false, status: null };
  }
}
