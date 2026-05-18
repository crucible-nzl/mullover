/**
 * Session management.
 *
 * Cookie shape:
 *   - name:   cd_session
 *   - value:  opaque random 32-byte session id (nanoid alphabet)
 *   - flags:  HttpOnly, Secure, SameSite=Lax, Path=/
 *   - maxAge: 30 days (sliding · refreshed on each /api/auth-check)
 *
 * Sessions are stored server-side in the `sessions` table. The cookie holds
 * only the id; all auth data lives in the DB. Logout = delete row + clear
 * cookie.
 */

import { db, schema } from './db';
import { eq, lt, sql } from 'drizzle-orm';
import { newToken } from './tokens';

export const SESSION_COOKIE = 'cd_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface SessionContext {
  ip: string | null;
  userAgent: string | null;
}

export function ctxFromHeaders(headers: Headers): SessionContext {
  return {
    ip: headers.get('x-forwarded-for')?.split(',')[0].trim() ?? null,
    userAgent: headers.get('user-agent') ?? null,
  };
}

/** Create a new session row for the user; returns the cookie value. */
export async function createSession(userId: string, ctx: SessionContext): Promise<{ id: string; expiresAt: Date }> {
  const id = newToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(schema.sessions).values({
    id,
    userId,
    expiresAt,
    userAgent: ctx.userAgent,
    ipAddress: ctx.ip,
  });
  return { id, expiresAt };
}

/** Look up + validate a session id; returns the user or null. */
export async function readSession(sessionId: string | undefined): Promise<{ userId: string; expiresAt: Date } | null> {
  if (!sessionId) return null;
  const rows = await db
    .select({ userId: schema.sessions.userId, expiresAt: schema.sessions.expiresAt })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .limit(1);
  if (rows.length === 0) return null;
  if (rows[0].expiresAt.getTime() < Date.now()) {
    // Expired · fire-and-forget delete
    void destroySession(sessionId);
    return null;
  }
  return rows[0];
}

/** Hard-delete a session row (logout). */
export async function destroySession(sessionId: string): Promise<void> {
  await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
}

/** Sliding window: extend expiry on read. Cheap. */
export async function touchSession(sessionId: string): Promise<Date> {
  const newExpiry = new Date(Date.now() + SESSION_TTL_MS);
  await db
    .update(schema.sessions)
    .set({ expiresAt: newExpiry })
    .where(eq(schema.sessions.id, sessionId));
  return newExpiry;
}

/** Maintenance · remove expired sessions. Called by a daily cron later. */
export async function purgeExpiredSessions(): Promise<number> {
  const result = await db
    .delete(schema.sessions)
    .where(lt(schema.sessions.expiresAt, sql`NOW()`));
  return Array.isArray(result) ? result.length : 0;
}

/** Build the Set-Cookie header value · production-safe defaults. */
export function buildSessionCookie(id: string, expiresAt: Date): string {
  const parts = [
    `${SESSION_COOKIE}=${id}`,
    `Path=/`,
    `Expires=${expiresAt.toUTCString()}`,
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    `HttpOnly`,
    `Secure`,
    `SameSite=Lax`,
  ];
  return parts.join('; ');
}

/** Build the Set-Cookie header that clears the session cookie (logout). */
export function buildClearedSessionCookie(): string {
  return [
    `${SESSION_COOKIE}=`,
    `Path=/`,
    `Expires=Thu, 01 Jan 1970 00:00:00 GMT`,
    `Max-Age=0`,
    `HttpOnly`,
    `Secure`,
    `SameSite=Lax`,
  ].join('; ');
}

/** Parse the Cookie request header and pull the session id out. */
export function readSessionCookie(headers: Headers): string | undefined {
  const raw = headers.get('cookie');
  if (!raw) return undefined;
  for (const pair of raw.split(/;\s*/)) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    if (pair.slice(0, eq) === SESSION_COOKIE) return pair.slice(eq + 1);
  }
  return undefined;
}
