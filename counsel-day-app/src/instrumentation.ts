/**
 * Next.js instrumentation hook · runs ONCE on each runtime startup.
 * This is where Sentry registers its hooks so error capture works
 * for both /api/* routes and the middleware.
 *
 * Lives in src/ because the project uses src/-based routing. Next.js
 * looks for src/instrumentation.ts OR instrumentation.ts at root.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config');
  }
}
