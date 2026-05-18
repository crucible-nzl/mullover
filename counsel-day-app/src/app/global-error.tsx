/**
 * App Router root-level error boundary.
 *
 * Next.js renders this component when an error escapes every other
 * error boundary, including errors in the root layout itself. Without
 * it, Sentry cannot capture root-render failures · they crash before
 * any client-side instrumentation runs.
 *
 * Counsel.day's app is almost entirely API routes + (eventually) auth
 * surfaces, so this boundary mostly catches root-layout TypeScript
 * regressions and Next.js framework errors. The fallback UI is
 * intentionally minimal · the marketing site is static and is unaffected.
 */
'use client';

import * as Sentry from '@sentry/nextjs';
import NextError from 'next/error';
import { useEffect } from 'react';

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
