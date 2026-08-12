/**
 * Next.js instrumentation hook · runs ONCE on each runtime startup.
 *
 * Sentry SDK 9 wants the init calls inlined here (sentry.server.config.ts
 * and sentry.edge.config.ts are deprecated · they fire a warning on every
 * build). DSN-gated, so unset = no-op and the app boots normally.
 *
 * Lives in src/ because the project uses src/-based routing; Next.js
 * looks for src/instrumentation.ts OR instrumentation.ts at root.
 */

import * as Sentry from '@sentry/nextjs';

export async function register() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV ?? 'production',
      // Counsel.day handles user-private data (votes, notes). Conservative
      // sampling: 10% of transactions; 100% of errors.
      tracesSampleRate: 0.1,
      sendDefaultPii: false,
      // Strip request bodies · they may contain decision notes.
      beforeSend(event) {
        if (event.request) {
          delete event.request.data;
          delete event.request.cookies;
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

  if (process.env.NEXT_RUNTIME === 'edge') {
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV ?? 'production',
      tracesSampleRate: 0.1,
      sendDefaultPii: false,
    });
  }
}

// Required by Next.js 15+ App Router so uncaught exceptions inside
// route handlers and server components are forwarded to Sentry.
// When SENTRY_DSN is unset, captureRequestError is a no-op.
export const onRequestError = Sentry.captureRequestError;
