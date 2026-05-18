-- ============================================================
-- COUNSEL.DAY · MIGRATION 0005 · ADD users.is_admin
-- ============================================================
-- Replaces the Caddy basic-auth gate on /admin with a Next.js
-- session check. The admin portal auth chain becomes:
--   1. browser has a session cookie (issued by /api/signin)
--   2. Caddy forward_auth → /api/admin-auth-check
--   3. that endpoint verifies the session AND that
--      users.is_admin = true
--   4. only then does Caddy serve /admin.html
--
-- Default false · ZERO accounts are admins until explicitly
-- promoted. After this migration applies, the post-migration
-- step must promote admin@counsel.day before the next deploy,
-- or admin access will be locked out (see scripts/promote-admin.sh).

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS users_is_admin_idx ON users (is_admin) WHERE is_admin = true;
