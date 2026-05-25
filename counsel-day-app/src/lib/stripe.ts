/**
 * Stripe client wrapper. Lazy-initialised so the app boots even when
 * STRIPE_SECRET_KEY is unset (during early scaffolding) · the routes that
 * actually call this will return 503 in that state.
 *
 * SKU → Stripe Price ID mapping is env-driven so the same code runs in
 * test mode (price IDs starting with price_test_) and live mode.
 */

import Stripe from 'stripe';

let _stripe: Stripe | null = null;

export function getStripe(): Stripe | null {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  _stripe = new Stripe(key, {
    apiVersion: '2024-12-18.acacia',
    typescript: true,
    appInfo: { name: 'counsel.day', version: '0.1.0', url: 'https://counsel.day' },
  });
  return _stripe;
}

export type Sku = 'solo_paid' | 'couple' | 'family';

/** Resolve a SKU to its Stripe Price ID via env var. */
export function priceIdForSku(sku: Sku): string | null {
  const map: Record<Sku, string | undefined> = {
    solo_paid: process.env.STRIPE_PRICE_SOLO_PAID,
    couple:    process.env.STRIPE_PRICE_COUPLE,
    family:    process.env.STRIPE_PRICE_FAMILY,
  };
  return map[sku] ?? null;
}

/** Mode: per-decision SKUs only (Consumer Annual retired 2026-05-25). */
export function modeForSku(_sku: Sku): 'payment' {
  return 'payment';
}

/** Display amount in cents (mirrors the static pricing page; used as fallback if Stripe API is down). */
export function amountCentsForSku(sku: Sku): number {
  switch (sku) {
    case 'solo_paid': return 999;   // $9.99 USD
    case 'couple':    return 1599;  // $15.99 USD
    case 'family':    return 2999;  // $29.99 USD
  }
}
