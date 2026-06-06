/**
 * Feature flags · env-driven boolean switches for experiments and
 * gradual rollouts. Read once at request time; no state.
 *
 * Conventions:
 *   · Env var name: ENABLE_<FEATURE_NAME>
 *   · Accepted truthy values: '1', 'true', 'yes' (case-insensitive)
 *   · Anything else (or unset) is false
 *
 * Usage from a route:
 *   import { isFeatureEnabled } from '@/lib/feature-flags';
 *   if (!isFeatureEnabled('COMPOSE_FIRST_SIGNUP')) return 404;
 *
 * Usage from the static client:
 *   GET /api/feature-flags returns the public-safe flag set so the
 *   marketing site can branch on it (e.g. show different homepage CTA).
 *
 * SAFETY · flags listed in PUBLIC_FLAGS are exposed via the JSON API;
 * everything else is server-only. Adding a flag to PUBLIC_FLAGS makes
 * its current state observable by anyone · only do that when the
 * branching needs to happen client-side.
 */

const TRUE_VALUES = new Set(['1', 'true', 'yes']);

export function isFeatureEnabled(name: string): boolean {
  const v = process.env[`ENABLE_${name}`];
  if (!v) return false;
  return TRUE_VALUES.has(v.toLowerCase());
}

/**
 * Flags safe to expose via the public /api/feature-flags endpoint.
 * Add a flag to this set ONLY when the marketing site genuinely needs
 * to branch on it client-side.
 */
export const PUBLIC_FLAGS = ['COMPOSE_FIRST_SIGNUP'] as const;
export type PublicFlagName = typeof PUBLIC_FLAGS[number];

export function publicFlagsSnapshot(): Record<PublicFlagName, boolean> {
  const out = {} as Record<PublicFlagName, boolean>;
  for (const name of PUBLIC_FLAGS) out[name] = isFeatureEnabled(name);
  return out;
}
