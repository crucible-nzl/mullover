#!/usr/bin/env bash
# ============================================================
# COUNSEL.DAY · BACKUP VERIFICATION
# Weekly test-restore of the most recent pg_dump into a throwaway
# database. Confirms the dump is restorable (not just "writes to
# disk and gzips"). Called by counsel-day-backup-verify.service
# (systemd timer, Sundays 04:15 UTC · one hour after the daily
# backup completes).
#
# Strategy:
#   1. Pick the most recent .sql.gz in BACKUP_DIR.
#   2. Create a clean throwaway database (counsel_day_verify_<stamp>).
#   3. gunzip | psql → restore into it.
#   4. Run a few sanity SELECTs against expected tables.
#   5. Drop the throwaway database.
#   6. Print PASS / FAIL banner. Exit non-zero on failure so the
#      systemd unit surfaces it in journalctl + status.
#
# Why this matters:
#   A backup that has never been restored is a wish, not a backup.
#   The daily pg_dump unit confirms the file was written; this unit
#   confirms the file can be loaded back into Postgres without
#   schema or extension errors. Run weekly so a regression in
#   pg_dump format is caught within 7 days.
# ============================================================
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/counsel-day}"
# Verify-DB connection: we connect as the deploy user against the
# local cluster, NOT the application's DATABASE_URL · the test DB is
# disposable and lives only for the duration of this run.
PG_HOST="${VERIFY_PG_HOST:-localhost}"
PG_USER="${VERIFY_PG_USER:-deploy}"
# Allow override for CI; defaults to the local socket via psql defaults.

if ! command -v pg_isready >/dev/null 2>&1; then
  echo "[verify · ERROR] pg_isready not in PATH; install postgresql-client" >&2
  exit 1
fi

# Locate the newest dump.
LATEST=$(find "$BACKUP_DIR" -maxdepth 1 -name 'postgres-*.sql.gz' -printf '%T@ %p\n' \
  | sort -nr | head -n1 | awk '{print $2}')

if [ -z "${LATEST:-}" ] || [ ! -f "$LATEST" ]; then
  echo "[verify · ERROR] no backup file found under $BACKUP_DIR" >&2
  exit 2
fi

SIZE=$(stat -c%s "$LATEST")
echo "[verify · start] $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "[verify · file ] $LATEST ($SIZE bytes)"

# A dump < 4 KB is almost certainly empty · refuse to restore (failure
# would also be loud but this catches it before psql even runs).
if [ "$SIZE" -lt 4096 ]; then
  echo "[verify · ERROR] dump is suspiciously small ($SIZE bytes)" >&2
  exit 3
fi

STAMP=$(date -u +%Y%m%d%H%M%S)
TEST_DB="counsel_day_verify_${STAMP}"
echo "[verify · target db] $TEST_DB"

cleanup() {
  # Drop the test DB whether the restore succeeded or not. Use IF EXISTS
  # so we don't error if creation failed early.
  psql -h "$PG_HOST" -U "$PG_USER" -d postgres -v ON_ERROR_STOP=1 \
    -c "DROP DATABASE IF EXISTS \"$TEST_DB\";" >/dev/null 2>&1 || true
}
trap cleanup EXIT

psql -h "$PG_HOST" -U "$PG_USER" -d postgres -v ON_ERROR_STOP=1 \
  -c "CREATE DATABASE \"$TEST_DB\";" >/dev/null

# Restore. Pipe failures should abort because pg_dump dumps with
# --clean --if-exists, restore is forgiving of object-exists noise.
# We capture stderr to summarise; full output goes to journalctl.
RESTORE_ERR=$(gunzip -c "$LATEST" \
  | psql -h "$PG_HOST" -U "$PG_USER" -d "$TEST_DB" -v ON_ERROR_STOP=1 2>&1 >/dev/null)
RC=$?

if [ $RC -ne 0 ]; then
  echo "[verify · FAIL] restore exited $RC" >&2
  echo "$RESTORE_ERR" | tail -n 50 >&2
  exit 4
fi

# Sanity-check that expected tables exist and have rows we'd expect on
# a non-trivial production database. The numbers are intentionally low
# floors (presence > volume) · this is a "did the schema land" check,
# not a content audit.
ROW_USERS=$(psql -h "$PG_HOST" -U "$PG_USER" -d "$TEST_DB" -tAc "SELECT COUNT(*) FROM users;" || echo "0")
ROW_DECISIONS=$(psql -h "$PG_HOST" -U "$PG_USER" -d "$TEST_DB" -tAc "SELECT COUNT(*) FROM decisions;" || echo "0")
ROW_SESSIONS=$(psql -h "$PG_HOST" -U "$PG_USER" -d "$TEST_DB" -tAc "SELECT COUNT(*) FROM sessions;" || echo "0")

echo "[verify · rows] users=$ROW_USERS decisions=$ROW_DECISIONS sessions=$ROW_SESSIONS"

# users is the one table that should ALWAYS have at least one row
# (James). decisions and sessions can legitimately be zero on a fresh
# environment, so we only floor on users.
if ! [[ "$ROW_USERS" =~ ^[0-9]+$ ]] || [ "$ROW_USERS" -lt 1 ]; then
  echo "[verify · FAIL] users table has $ROW_USERS rows · expected ≥ 1" >&2
  exit 5
fi

echo "[verify · PASS] backup $LATEST is restorable"
echo "[verify · done] $(date -u +%Y-%m-%dT%H:%M:%SZ)"
exit 0
