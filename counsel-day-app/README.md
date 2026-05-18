# counsel-day-app

Backend for [counsel.day](https://counsel.day). Next.js 15 (App Router) + Drizzle ORM + Postgres 16, self-hosted on Hetzner CAX11 behind Caddy.

The static marketing site lives in `../counsel-day-complete/` and is served directly by Caddy from `/var/www/counsel.day`. This Next.js app owns the dynamic routes only: `/api/*` today, plus the signed-in app surfaces (`/account`, `/compose`, `/vote-today`, `/verdict-reveal`, etc.) as they get wired up.

## Status

| Surface | State |
|---|---|
| `/api/health` | ✅ stubbed; returns 200 with DB round-trip |
| `/api/signup` | ✅ stubbed; INSERT into `users` + issues email verification token; Brevo wired conditionally on `BREVO_API_KEY` |
| `/api/verify` | ⏳ planned · the GET handler for the email link |
| `/api/signin` `/api/signout` | ⏳ planned · session cookie auth |
| Stripe checkout + webhooks | ⏳ planned |
| `/api/compose` `/api/vote` `/api/verdict-cron` | ⏳ planned |

## Local dev

```bash
cd counsel-day-app
cp .env.example .env
# edit .env: at minimum set DATABASE_URL to your local postgres
npm install
npm run db:migrate
npm run dev      # http://localhost:3000
```

## Deploy

```bash
bash scripts/deploy.sh
```

See [docs/RUNBOOK.md](../docs/RUNBOOK.md) for everything operational. See [docs/INTEGRATION_BACKLOG.md](../docs/INTEGRATION_BACKLOG.md) for what's planned.

## Layout

```
src/
  app/
    layout.tsx              minimal root (most pages are static, served by Caddy)
    api/
      health/route.ts       GET /api/health · liveness + DB ping
      signup/route.ts       POST /api/signup · creates user + sends verify email
  lib/
    db.ts                   Drizzle client (one pool per process)
    schema.ts               canonical TypeScript schema · mirrors db/migrations/0001_init.sql
    validators.ts           Zod input schemas
    email.ts                Brevo client (stub when BREVO_API_KEY unset)
    tokens.ts               opaque random token generator (nanoid)
    migrate.ts              forward-only migration runner
db/
  migrations/0001_init.sql  initial schema · 10 tables
ops/
  counsel-day-app.service   systemd unit (installed once on the box)
scripts/
  deploy.sh                 typecheck + rsync + build + migrate + restart
  first-time-install.sh     installs the systemd unit on a fresh server (run once)
```
