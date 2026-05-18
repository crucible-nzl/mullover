/**
 * Password hashing and verification using Argon2id (winner of the 2015
 * Password Hashing Competition). Tuned for ~250ms per hash on the CAX11
 * server · slow enough to defeat offline cracking, fast enough that 100
 * concurrent signins do not pile up.
 *
 * Reference: https://github.com/P-H-C/phc-winner-argon2
 */

import { hash, verify } from '@node-rs/argon2';

/** OWASP-recommended Argon2id parameters as of 2024 (memory-cost = 19 MiB).
 *  algorithm = 2 means Argon2id (the recommended variant). The literal is
 *  used because the named enum is a TypeScript ambient const enum and
 *  cannot be referenced under isolatedModules. */
const ARGON2_PARAMS = {
  algorithm: 2 as const,
  memoryCost: 19_456, // KiB · 19 MiB
  timeCost: 2,        // iterations
  parallelism: 1,
};

export async function hashPassword(plain: string): Promise<string> {
  if (plain.length < 8) throw new Error('password must be at least 8 characters');
  if (plain.length > 1024) throw new Error('password is too long');
  return hash(plain, ARGON2_PARAMS);
}

export async function verifyPassword(stored: string, supplied: string): Promise<boolean> {
  if (!stored || !supplied) return false;
  try {
    return await verify(stored, supplied, ARGON2_PARAMS);
  } catch {
    return false;
  }
}
