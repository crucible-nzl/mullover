#!/usr/bin/env bash
# ============================================================
# COUNSEL.DAY · POSTGRES BACKUP
# Daily pg_dump → gzip → /var/backups/counsel-day/.
# Called by counsel-day-backup.service (systemd timer, 03:15 UTC).
#
# Restore:
#   gunzip -c /var/backups/counsel-day/postgres-YYYYMMDD-HHMMSS.sql.gz \
#     | psql "$DATABASE_URL"
# (--clean --if-exists in the dump means restore is idempotent · safe
# to re-run; existing objects are dropped and recreated.)
#
# Retention: keep the last RETENTION_DAYS daily dumps (default 14).
# Offsite backup is provided by Hetzner Cloud Backups (server-level
# snapshots, separate disk, separate trust boundary).
# ============================================================
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/counsel-day}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[backup · ERROR] DATABASE_URL is unset. Aborting." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
STAMP=$(date -u +%Y%m%d-%H%M%S)
OUT="$BACKUP_DIR/postgres-$STAMP.sql.gz"

echo "[backup · start] $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "[backup · target] $OUT"

# --no-owner / --no-acl: portable across users (restore doesn't need to
# match the original owner). --clean --if-exists: restore drops existing
# objects first, idempotent. Skip the audit_log table to keep dumps
# small if/when it grows (uncomment if needed):
#   --exclude-table-data=audit_log
pg_dump \
  --no-owner --no-acl \
  --clean --if-exists \
  --format=plain \
  "$DATABASE_URL" \
  | gzip -9 > "$OUT"

SIZE=$(stat -c%s "$OUT")
echo "[backup · wrote] $OUT (${SIZE} bytes)"

# Smoke-check: dump must be at least 1 KB (an empty dump is < 200 bytes
# and indicates pg_dump failed silently · fail loudly so the timer
# surfaces it in journalctl).
if [ "$SIZE" -lt 1024 ]; then
  echo "[backup · ERROR] dump is suspiciously small ($SIZE bytes). Aborting before prune." >&2
  exit 2
fi

# Prune old dumps. `-mtime +N` matches files modified MORE than N*24h ago.
echo "[backup · prune] removing dumps older than ${RETENTION_DAYS} days"
DELETED=$(find "$BACKUP_DIR" -maxdepth 1 -name 'postgres-*.sql.gz' -mtime "+${RETENTION_DAYS}" -delete -print | wc -l)
echo "[backup · prune] removed ${DELETED} old dump(s)"

# Quick state summary
REMAINING=$(find "$BACKUP_DIR" -maxdepth 1 -name 'postgres-*.sql.gz' | wc -l)
TOTAL_BYTES=$(du -sb "$BACKUP_DIR" | cut -f1)
echo "[backup · state] ${REMAINING} dump(s) in $BACKUP_DIR, ${TOTAL_BYTES} bytes total"

echo "[backup · done] $(date -u +%Y-%m-%dT%H:%M:%SZ)"
