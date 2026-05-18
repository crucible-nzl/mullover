import { nanoid } from 'nanoid';

/** Random opaque token suitable for one-time email verification links. */
export function newToken(): string {
  // 32 chars from the URL-safe alphabet · ~190 bits of entropy.
  return nanoid(32);
}
