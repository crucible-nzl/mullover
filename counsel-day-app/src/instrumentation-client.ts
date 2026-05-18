/**
 * Sentry browser init (Next.js 15+ canonical path).
 *
 * Loaded automatically by Next.js for every client-rendered page or
 * client component. Counsel.day's app surface is mostly server-rendered
 * + auth-gated, so the browser footprint here is small.
 *
 * Static marketing pages live in counsel-day-complete/ and are NOT
 * served by Next.js · they don't load this config. If we ever want
 * browser-side error tracking on those pages, embed the Sentry CDN
 * loader directly in their <head>.
 *
 * Gated on NEXT_PUBLIC_SENTRY_DSN so the file ships safely with no
 * runtime cost when Sentry isn't configured yet.
 */

import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'production',
    tracesSampleRate: 0.1,
    // Don't ship console.log noise; only console.warn/error
    integrations: [
      Sentry.captureConsoleIntegration({ levels: ['warn', 'error'] }),
      Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }),
    ],
    replaysSessionSampleRate: 0,        // no proactive session replay
    replaysOnErrorSampleRate: 0.1,      // 10% replay on errors
    sendDefaultPii: false,              // we never want IP / cookies attached
  });
}

// Captures client-side navigation transition spans for App Router pages.
// Required export per Sentry Next.js 8+ for full client tracing.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
