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
# Status file the Next.js app reads via /api/admin/backup-verify-status
# so /admin overview can surface a red banner if the most recent run
# failed. Always written, even on the failure paths below · the trap
# at the bottom of the file handles non-PASS exits.
STATUS_FILE="${BACKUP_VERIFY_STATUS_FILE:-/var/log/counsel-day/backup-verify-status.json}"
STATUS_DIR=$(dirname "$STATUS_FILE")

# Make sure we always leave a status row behind, even when the script
# exits via `set -e` or trap. The variables are set as we go; the EXIT
# trap formats and writes them out.
LAST_STATUS="UNKNOWN"
LAST_REASON=""
LAST_FILE=""
LAST_USERS=""
LAST_DECISIONS=""
LAST_SESSIONS=""

write_status_file() {
  mkdir -p "$STATUS_DIR" 2>/dev/null || true
  cat > "$STATUS_FILE" <<EOF
{
  "status": "$LAST_STATUS",
  "checked_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "backup_file": "$LAST_FILE",
  "rows": { "users": ${LAST_USERS:-null}, "decisions": ${LAST_DECISIONS:-null}, "sessions": ${LAST_SESSIONS:-null} },
  "reason": "$LAST_REASON"
}
EOF
  # Group-readable so the deploy user (running the Next.js app) can
  # read it via /api/admin/backup-verify-status without needing root.
  chmod 644 "$STATUS_FILE" 2>/dev/null || true
}
trap 'write_status_file' EXIT
# Verify-DB connection: we connect via `sudo -u postgres psql` (peer
# auth on the Unix socket). This avoids needing a password-bearing
# Postgres role for the deploy OS user, mirrors the existing RUNBOOK
# pattern (sudo -u postgres pg_dump …) and keeps least-privilege:
# counsel_day_app does not need CREATEDB just so we can verify a dump.
# The systemd unit must NOT set NoNewPrivileges=true · sudo needs the
# setuid bit to elevate.

if ! command -v psql >/dev/null 2>&1; then
  echo "[verify · ERROR] psql not in PATH; install postgresql-client" >&2
  exit 1
fi

# Locate the newest dump.
LATEST=$(find "$BACKUP_DIR" -maxdepth 1 -name 'postgres-*.sql.gz' -printf '%T@ %p\n' \
  | sort -nr | head -n1 | awk '{print $2}')

if [ -z "${LATEST:-}" ] || [ ! -f "$LATEST" ]; then
  echo "[verify · ERROR] no backup file found under $BACKUP_DIR" >&2
  LAST_STATUS="FAIL"
  LAST_REASON="no backup file found under $BACKUP_DIR"
  exit 2
fi
LAST_FILE="$LATEST"

SIZE=$(stat -c%s "$LATEST")
echo "[verify · start] $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "[verify · file ] $LATEST ($SIZE bytes)"

# A dump < 4 KB is almost certainly empty · refuse to restore (failure
# would also be loud but this catches it before psql even runs).
if [ "$SIZE" -lt 4096 ]; then
  echo "[verify · ERROR] dump is suspiciously small ($SIZE bytes)" >&2
  LAST_STATUS="FAIL"
  LAST_REASON="dump suspiciously small ($SIZE bytes)"
  exit 3
fi

STAMP=$(date -u +%Y%m%d%H%M%S)
TEST_DB="counsel_day_verify_${STAMP}"
echo "[verify · target db] $TEST_DB"

cleanup() {
  # Drop the test DB whether the restore succeeded or not. Use IF EXISTS
  # so we don't error if creation failed early.
  sudo -n -u postgres psql -d postgres -v ON_ERROR_STOP=1 \
    -c "DROP DATABASE IF EXISTS \"$TEST_DB\";" >/dev/null 2>&1 || true
}
trap cleanup EXIT

sudo -n -u postgres psql -d postgres -v ON_ERROR_STOP=1 \
  -c "CREATE DATABASE \"$TEST_DB\";" >/dev/null

# Restore. Pipe failures should abort because pg_dump dumps with
# --clean --if-exists, restore is forgiving of object-exists noise.
# We capture stderr to summarise; full output goes to journalctl.
RESTORE_ERR=$(gunzip -c "$LATEST" \
  | sudo -n -u postgres psql -d "$TEST_DB" -v ON_ERROR_STOP=1 2>&1 >/dev/null)
RC=$?

if [ $RC -ne 0 ]; then
  echo "[verify · FAIL] restore exited $RC" >&2
  echo "$RESTORE_ERR" | tail -n 50 >&2
  LAST_STATUS="FAIL"
  LAST_REASON="restore exited $RC"
  exit 4
fi

# Sanity-check that expected tables exist and have rows we'd expect on
# a non-trivial production database. The numbers are intentionally low
# floors (presence > volume) · this is a "did the schema land" check,
# not a content audit.
ROW_USERS=$(sudo -n -u postgres psql -d "$TEST_DB" -tAc "SELECT COUNT(*) FROM users;" || echo "0")
ROW_DECISIONS=$(sudo -n -u postgres psql -d "$TEST_DB" -tAc "SELECT COUNT(*) FROM decisions;" || echo "0")
ROW_SESSIONS=$(sudo -n -u postgres psql -d "$TEST_DB" -tAc "SELECT COUNT(*) FROM sessions;" || echo "0")

echo "[verify · rows] users=$ROW_USERS decisions=$ROW_DECISIONS sessions=$ROW_SESSIONS"
LAST_USERS="$ROW_USERS"
LAST_DECISIONS="$ROW_DECISIONS"
LAST_SESSIONS="$ROW_SESSIONS"

# users is the one table that should ALWAYS have at least one row
# (James). decisions and sessions can legitimately be zero on a fresh
# environment, so we only floor on users.
if ! [[ "$ROW_USERS" =~ ^[0-9]+$ ]] || [ "$ROW_USERS" -lt 1 ]; then
  echo "[verify · FAIL] users table has $ROW_USERS rows · expected ≥ 1" >&2
  LAST_STATUS="FAIL"
  LAST_REASON="users table has $ROW_USERS rows · expected ≥ 1"
  exit 5
fi

echo "[verify · PASS] backup $LATEST is restorable"
echo "[verify · done] $(date -u +%Y-%m-%dT%H:%M:%SZ)"
LAST_STATUS="PASS"
LAST_REASON=""
exit 0
