/**
 * Counsel.day · TOTP MFA helpers.
 *
 * Per docs/SECURITY_PENTEST_2026-05-20.md item 1.6 and the locked
 * settings memory · MFA shipped 2026-05-20, optional for everyone.
 *
 * Storage model (see migration 0009):
 *   · mfa_secrets · one row per enrolled user. secret is base32
 *     plaintext (Postgres-level encryption at rest only); recovery
 *     codes are argon2id-hashed JSONB array.
 *   · mfa_challenges · five-minute single-use challenge tokens
 *     issued after password / magic-link verify when MFA is
 *     enabled. /api/signin/mfa-verify consumes them.
 *
 * Library: otplib (RFC 6238 TOTP, SHA1, 30s period, 6 digits ·
 * defaults match every common authenticator app).
 */

import { authenticator } from 'otplib';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';
import { nanoid } from 'nanoid';

// Period 30s, digits 6, window +/- 1 (allows clock skew up to 30s either way).
authenticator.options = { window: 1, step: 30, digits: 6 };

const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_LEN = 10; // 10 alphanumeric chars · ~52 bits of entropy

// Argon2 parameters · algorithm = 2 means Argon2id (literal because the
// @node-rs/argon2 named enum is an ambient const enum that can't be
// referenced under isolatedModules). Matches lib/auth.ts.
const ARGON2_OPTS = {
  algorithm: 2 as const,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

/**
 * Generate a fresh base32 TOTP secret (otplib's `generateSecret`
 * uses 20 random bytes, then base32-encodes to 32 chars).
 */
export function generateMfaSecret(): string {
  return authenticator.generateSecret(20);
}

/**
 * Build the otpauth:// URL the user pastes / scans into their app.
 * The issuer + accountName combination becomes the label.
 */
export function otpauthUrl(secret: string, email: string): string {
  return authenticator.keyuri(email, 'Counsel.day', secret);
}

/**
 * Verify a 6-digit TOTP code against the user's secret.
 */
export function verifyTotpCode(secret: string, code: string): boolean {
  if (!secret || !code) return false;
  const cleaned = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(cleaned)) return false;
  try {
    return authenticator.verify({ token: cleaned, secret });
  } catch {
    return false;
  }
}

/**
 * Mint 10 fresh recovery codes. Returns:
 *   · plaintext (shown to the user once at enrolment · then forgotten)
 *   · hashes   (stored in mfa_secrets.recovery_codes)
 */
export async function generateRecoveryCodes(): Promise<{ plaintext: string[]; hashes: string[] }> {
  const plaintext: string[] = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    plaintext.push(makeRecoveryCode());
  }
  const hashes = await Promise.all(plaintext.map((code) => argonHash(code, ARGON2_OPTS)));
  return { plaintext, hashes };
}

function makeRecoveryCode(): string {
  // 10 chars from A-Z 0-9 minus ambiguous (no O/0, I/1, L)
  const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(RECOVERY_CODE_LEN);
  let out = '';
  for (let i = 0; i < RECOVERY_CODE_LEN; i++) out += ALPHA[bytes[i] % ALPHA.length];
  // Format as XXXXX-XXXXX for readability
  return out.slice(0, 5) + '-' + out.slice(5);
}

/**
 * Verify a recovery code. Iterates the hash list (argon2 verify is
 * expensive but the list is small · 10 items max). Returns the
 * index of the matching hash so the caller can splice it out of
 * the list (recovery codes are single-use).
 */
export async function verifyRecoveryCode(plain: string, hashes: string[]): Promise<number> {
  const cleaned = plain.replace(/\s+/g, '').toUpperCase();
  for (let i = 0; i < hashes.length; i++) {
    try {
      const ok = await argonVerify(hashes[i], cleaned);
      if (ok) return i;
    } catch { /* malformed hash · skip */ }
  }
  return -1;
}

/**
 * Mint a new challenge id (used as the primary key in mfa_challenges).
 * 32-char nanoid · cryptographically random.
 */
export function newChallengeId(): string {
  return nanoid(32);
}
