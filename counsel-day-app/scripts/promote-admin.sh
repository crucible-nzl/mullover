#!/usr/bin/env bash
# ============================================================
# COUNSEL.DAY · PROMOTE A USER TO ADMIN
# Usage:  bash scripts/promote-admin.sh <email>
# Runs on the server (or via SSH wrapper). Updates users.is_admin
# = true for the matching email. Required for /admin access after
# migration 0005 lands · the Caddy gate now consults this flag.
#
# This script intentionally has NO authentication of its own ·
# anyone with shell access on the box can grant admin. That's the
# correct trust boundary: shell access is root-equivalent anyway.
# ============================================================
set -euo pipefail

if [ -z "${1:-}" ]; then
  echo "Usage: $0 <email>" >&2
  exit 1
fi
EMAIL="$1"

if [ -z "${DATABASE_URL:-}" ]; then
  if [ -f /etc/counsel-day-app/env.local ]; then
    DATABASE_URL=$(grep '^DATABASE_URL=' /etc/counsel-day-app/env.local | cut -d= -f2-)
  fi
fi
if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL not in env and /etc/counsel-day-app/env.local not readable. Run with: sudo bash $0 <email>" >&2
  exit 2
fi

EXISTS=$(psql "$DATABASE_URL" -tA -c "SELECT 1 FROM users WHERE LOWER(email) = LOWER('$EMAIL') AND deleted_at IS NULL LIMIT 1;")
if [ "$EXISTS" != "1" ]; then
  echo "ERROR: no active user with email '$EMAIL'." >&2
  exit 3
fi

psql "$DATABASE_URL" -c "UPDATE users SET is_admin = true, updated_at = NOW() WHERE LOWER(email) = LOWER('$EMAIL');"
echo "[promote-admin] $EMAIL is now an admin"
