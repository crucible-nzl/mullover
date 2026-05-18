/**
 * Sentry init for the Edge runtime (Next.js middleware).
 * Same DSN-gating pattern as server config.
 */

import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'production',
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
  });
}
