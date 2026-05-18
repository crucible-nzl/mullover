#!/usr/bin/env bash
#
# /usr/local/sbin/luks-unlock.sh
#
# Counsel.day · boot-time LUKS unlock for the Postgres data volume.
#
# Invoked by systemd unit luks-unlock.service.
# Reads INFISICAL_TOKEN, INFISICAL_URL, INFISICAL_PROJECT_ID, INFISICAL_ENV
# from /etc/environment.d/infisical.conf (loaded by the systemd unit).
#
# Fetches LUKS_PASSPHRASE from Infisical, runs cryptsetup luksOpen against
# the data volume, and mounts /var/lib/postgres-data.
#
# Idempotent: if the volume is already mounted, exits 0.
# Fails loudly: any error here means Postgres will not start, which is
# the correct behaviour · we never want Postgres to start without LUKS
# active.

set -euo pipefail
IFS=$'\n\t'

# ----------------------------------------------------------------------------
# Configuration · update DATA_VOLUME_DEVICE after running:
#   ls -l /dev/disk/by-id/ | grep HC_Volume
# and pick the stable by-id path.
# ----------------------------------------------------------------------------
DATA_VOLUME_DEVICE="/dev/disk/by-id/scsi-0HC_Volume_REPLACE_ME"
DM_NAME="pg-data-decrypted"
MOUNT_POINT="/var/lib/postgres-data"
INFISICAL_BIN="/usr/local/bin/infisical"

# ----------------------------------------------------------------------------
log()  { printf '[luks-unlock] %s\n' "$*"; }
fail() { printf '[luks-unlock FAIL] %s\n' "$*" >&2; exit 1; }

# ----------------------------------------------------------------------------
# 1 · Sanity checks
# ----------------------------------------------------------------------------
[[ -n "${INFISICAL_TOKEN:-}" ]] || fail "INFISICAL_TOKEN not set (check /etc/environment.d/infisical.conf)"
[[ -n "${INFISICAL_URL:-}" ]]   || fail "INFISICAL_URL not set"
[[ -x "$INFISICAL_BIN" ]]       || fail "Infisical CLI not found at $INFISICAL_BIN · install per SETUP.md C.7"

if [[ "$DATA_VOLUME_DEVICE" == *REPLACE_ME* ]]; then
  fail "DATA_VOLUME_DEVICE is still the placeholder. Edit /usr/local/sbin/luks-unlock.sh."
fi

[[ -b "$DATA_VOLUME_DEVICE" ]] || fail "Data volume $DATA_VOLUME_DEVICE not found · is the Hetzner volume attached?"

# ----------------------------------------------------------------------------
# 2 · If already mounted, nothing to do
# ----------------------------------------------------------------------------
if mountpoint -q "$MOUNT_POINT"; then
  log "$MOUNT_POINT already mounted · nothing to do"
  exit 0
fi

# ----------------------------------------------------------------------------
# 3 · Fetch the LUKS passphrase from Infisical
# ----------------------------------------------------------------------------
log "Fetching LUKS_PASSPHRASE from Infisical at $INFISICAL_URL"

# Use a tmpfs-backed file so the passphrase never lands on persistent disk.
PASS_FILE="$(mktemp --tmpdir=/run luks-pass.XXXXXX)"
chmod 600 "$PASS_FILE"
trap 'shred -u "$PASS_FILE" 2>/dev/null || rm -f "$PASS_FILE"' EXIT

# Use --silent so secret values do not leak into the journal.
if ! "$INFISICAL_BIN" secrets get LUKS_PASSPHRASE \
      --token="$INFISICAL_TOKEN" \
      --domain="$INFISICAL_URL" \
      --projectId="${INFISICAL_PROJECT_ID}" \
      --env="${INFISICAL_ENV:-production}" \
      --silent \
      --plain > "$PASS_FILE"; then
  fail "Infisical secrets fetch failed · check token, project ID, environment"
fi

[[ -s "$PASS_FILE" ]] || fail "Infisical returned an empty LUKS_PASSPHRASE"

# ----------------------------------------------------------------------------
# 4 · Open the LUKS device
# ----------------------------------------------------------------------------
if cryptsetup status "$DM_NAME" &>/dev/null; then
  log "LUKS device /dev/mapper/$DM_NAME already open · skipping luksOpen"
else
  log "Opening LUKS device $DATA_VOLUME_DEVICE as /dev/mapper/$DM_NAME"
  cryptsetup luksOpen \
    --key-file "$PASS_FILE" \
    "$DATA_VOLUME_DEVICE" \
    "$DM_NAME" || fail "cryptsetup luksOpen failed"
fi

# ----------------------------------------------------------------------------
# 5 · Mount it
# ----------------------------------------------------------------------------
mkdir -p "$MOUNT_POINT"

log "Mounting /dev/mapper/$DM_NAME at $MOUNT_POINT"
mount -t ext4 \
  -o noatime,nodiratime \
  "/dev/mapper/$DM_NAME" \
  "$MOUNT_POINT" || fail "mount failed"

# ----------------------------------------------------------------------------
# 6 · Verify sentinel · the file we wrote during initial provisioning
# ----------------------------------------------------------------------------
if [[ -f "$MOUNT_POINT/.luks-active" ]]; then
  log "Sentinel present: $(cat "$MOUNT_POINT/.luks-active")"
else
  log "WARNING: sentinel $MOUNT_POINT/.luks-active not found · is this the correct volume?"
fi

log "LUKS unlock + mount complete"
exit 0
