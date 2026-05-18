/**
 * Sentry server-side init. Runs in the Node.js process that serves
 * /api/* routes and the systemd cron jobs.
 *
 * Gated on SENTRY_DSN env var: when unset, Sentry init is a no-op and
 * the app boots normally. This lets us ship the package without
 * forcing a Sentry signup before the app can deploy.
 */

import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'production',
    // Counsel.day handles user-private data (votes, notes). Conservative
    // sampling: 10% of transactions; 100% of errors.
    tracesSampleRate: 0.1,
    // Default integrations are fine; we don't need browser-only ones here.
    sendDefaultPii: false,
    // Strip request bodies · they may contain decision notes
    beforeSend(event) {
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        // Keep headers but redact sensitive ones
        if (event.request.headers) {
          const h = event.request.headers as Record<string, string>;
          delete h.authorization;
          delete h.cookie;
          delete h['x-api-key'];
          delete h['stripe-signature'];
        }
      }
      return event;
    },
  });
}
