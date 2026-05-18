import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

const config: NextConfig = {
  // Standalone output bundles a self-contained server.js for systemd.
  // The static site (counsel-day-complete/) is NOT in this project; Caddy
  // serves it directly from /var/www/counsel.day. Next.js only owns the
  // dynamic routes (/api/*) and the eventual signed-in app surfaces.
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  // We are behind Caddy on the same box; trust its X-Forwarded headers.
  experimental: {
    serverActions: { bodySizeLimit: '512kb' },
  },
};

// Sentry wrapper · runs no-op (no network, no upload) when SENTRY_DSN is
// unset. With it set, auto-instruments API routes and middleware. With
// SENTRY_AUTH_TOKEN also set (build-time only), uploads source maps.
export default withSentryConfig(config, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  telemetry: false,
  // The tunnel route lets the browser SDK POST through our own domain
  // rather than directly to sentry.io · hides from ad-blockers.
  tunnelRoute: '/monitoring',
  autoInstrumentServerFunctions: true,
  autoInstrumentMiddleware: true,
  disableLogger: true,
});
