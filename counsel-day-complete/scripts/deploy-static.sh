#!/usr/bin/env bash
# ============================================================
# COUNSEL.DAY STATIC SITE · DEPLOY SCRIPT
# Run from this machine. Tar+ssh the static HTML/CSS/JS in
# counsel-day-complete/ into /var/www/counsel.day on the Hetzner box,
# where Caddy serves it.
#
# Usage:  bash counsel-day-complete/scripts/deploy-static.sh
# Requires: tar, ssh with the deploy key configured via ~/.ssh/config
#           (Host alias `counsel-day-prod-01`)
# ============================================================
set -euo pipefail

SSH_TARGET="${SSH_TARGET:-counsel-day-prod-01}"
SSH_KEY="${SSH_KEY:-}"
REMOTE_PATH="/var/www/counsel.day"

# Build the ssh -i flag only when SSH_KEY is explicitly set; otherwise
# rely on ssh_config IdentityFile. Mirrors counsel-day-app/scripts/deploy.sh.
if [ -n "$SSH_KEY" ]; then
  SSH_OPTS=(-i "$SSH_KEY")
else
  SSH_OPTS=()
fi

cd "$(dirname "$0")/.."

echo "[static-deploy] 1/3 · brand-verify (run from PowerShell separately if needed)"
echo "  · skipping inline · run powershell.exe -File ./scripts/brand-verify.ps1 before deploying critical changes"

echo "[static-deploy] 2/3 · tar+ssh to ${SSH_TARGET}:${REMOTE_PATH}"
tar -czf - \
  --exclude='og-image-generator.html' \
  --exclude='homepage.html' \
  --exclude='*.zip' \
  --exclude='scripts' \
  --exclude='ops' \
  . | ssh "${SSH_OPTS[@]}" "${SSH_TARGET}" \
    "tar -xzf - -C ${REMOTE_PATH} \
     && rm -f ${REMOTE_PATH}/styles.css ${REMOTE_PATH}/posthog.js ${REMOTE_PATH}/business-case.pdf ${REMOTE_PATH}/business-case-expanded.pdf \
     && find ${REMOTE_PATH} -type f -exec chmod 644 {} \;"

# NOTE: tar-over-ssh does not prune files removed from the repo · the rm above
# clears the known dead files. For a full prune, switch to rsync --delete once
# the web root is confirmed to hold no runtime-only dirs (e.g. generated audio).

echo "[static-deploy] 3/3 · smoke test /admin.html headers"
curl -sSI https://counsel.day/admin.html | head -3
echo "[static-deploy] done"
