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
// unset. With it set, auto-instruments API routes, middleware, and server
// components. With SENTRY_AUTH_TOKEN also set (build-time only), uploads
// source maps so production stack traces deminify.
//
// Per Sentry's official Next.js skill guide:
//   https://github.com/getsentry/sentry-for-ai/tree/main/skills/sentry-nextjs-sdk
// Auto-instrumentation of server functions + middleware is on by default
// in @sentry/nextjs 8.x · explicit flags for it were dropped from the API.
export default withSentryConfig(config, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  // Upload a wider set of client-side files so browser stack traces
  // resolve to original source instead of compiled chunks.
  widenClientFileUpload: true,
  // Don't leak source maps to the public · only upload them to Sentry.
  hideSourceMaps: true,
  telemetry: false,
  // The tunnel route lets the browser SDK POST through our own domain
  // rather than directly to sentry.io · hides from ad-blockers. MUST
  // sit under /api/ because Caddy only reverse-proxies /api/* to the
  // Next.js process · everything else hits file_server and 404s.
  tunnelRoute: '/api/monitoring',
  // Disable Sentry's own logger output at runtime (we only want
  // breadcrumbs, not "[Sentry] Loaded integration X" noise).
  disableLogger: true,
});
