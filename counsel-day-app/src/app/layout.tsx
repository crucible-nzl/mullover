/**
 * Root layout for the Next.js app. Most counsel.day pages are static HTML
 * served by Caddy directly. This Next.js app exists primarily for /api/*
 * routes and (later) the signed-in app surfaces. The HTML response for
 * any non-API page renders nothing meaningful; Caddy should reverse-proxy
 * only the routes Next.js owns.
 */
export const metadata = {
  title: 'Counsel.day',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
