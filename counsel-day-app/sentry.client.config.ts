/**
 * Sentry browser init. Loads on any client-rendered Next.js page or
 * client component. Counsel.day's app surface is mostly server-rendered
 * + auth-gated, so the browser footprint here is small.
 *
 * Static marketing pages live in counsel-day-complete/ and are NOT
 * served by Next.js · they don't load this config. If we ever want
 * browser-side error tracking on those pages, embed the Sentry CDN
 * loader directly in their <head>.
 */

import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'production',
    tracesSampleRate: 0.1,
    // Don't ship console.log noise; only console.warn/error
    integrations: [Sentry.captureConsoleIntegration({ levels: ['warn', 'error'] })],
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0.1,
    sendDefaultPii: false,
  });
}
