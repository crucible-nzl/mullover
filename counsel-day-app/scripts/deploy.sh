#!/usr/bin/env bash
# ============================================================
# COUNSEL.DAY APP · DEPLOY SCRIPT
# Run from this machine. Pushes source to /opt/counsel-day-app on the
# Hetzner box, runs npm ci + build + migrate, restarts systemd.
#
# Usage:  bash scripts/deploy.sh
# Requires: rsync, ssh with the deploy key
# ============================================================
set -euo pipefail

SSH_KEY="${HOME}/.ssh/id_ed25519_counsel_day"
SSH_TARGET="deploy@46.225.133.203"
REMOTE_PATH="/opt/counsel-day-app"

cd "$(dirname "$0")/.."

# Stamp the current git short-sha so /api/health can report which build
# is live. Falls back to "unknown" if not in a git checkout.
GIT_REV=$(git rev-parse --short HEAD 2>/dev/null || echo unknown)
echo "[deploy] 0/5 · build tag CD_GIT_REV=${GIT_REV}"

echo "[deploy] 1/5 · typecheck (skipped if local node_modules missing)"
if [ -d node_modules ]; then
  npx tsc --noEmit
else
  echo "  · skipped (run 'npm install' locally to enable pre-deploy typecheck)"
fi

echo "[deploy] 2/5 · push source to ${SSH_TARGET}:${REMOTE_PATH} (tar-over-ssh)"
ssh -i "${SSH_KEY}" "${SSH_TARGET}" "sudo mkdir -p ${REMOTE_PATH} && sudo chown -R deploy:deploy ${REMOTE_PATH}"
tar -czf - \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='.env' \
  --exclude='.env.local' \
  --exclude='.git' \
  . | ssh -i "${SSH_KEY}" "${SSH_TARGET}" "tar -xzf - -C ${REMOTE_PATH}"

echo "[deploy] 3/5 · npm install + build on server"
ssh -i "${SSH_KEY}" "${SSH_TARGET}" "
  set -e
  cd ${REMOTE_PATH}
  # Stamp the current git short-sha into .git-rev so /api/health can
  # report it at runtime. Read by src/lib/version.ts at module load.
  echo '${GIT_REV}' > ${REMOTE_PATH}/.git-rev
  # Regenerate the lockfile whenever package.json is newer (or no lockfile
  # exists). Skipping this would let 'npm ci' fail with ERESOLVE on every
  # dep bump because the pinned lockfile won't match the new package.json.
  if [ ! -f package-lock.json ] || [ package.json -nt package-lock.json ]; then
    echo '  (package.json changed or no lockfile · running npm install to regenerate)'
    rm -f package-lock.json
    npm install
  else
    npm ci
  fi
  set -a; source /etc/counsel-day-app/env.local; set +a
  npm run build
  echo '[deploy] · npm audit (high+critical only · non-blocking)'
  npm audit --audit-level=high || true
"

echo "[deploy] 4/5 · run database migrations"
ssh -i "${SSH_KEY}" "${SSH_TARGET}" "
  set -e
  cd ${REMOTE_PATH}
  set -a; source /etc/counsel-day-app/env.local; set +a
  npm run db:migrate
"

echo "[deploy] 5/5 · restart systemd unit"
ssh -i "${SSH_KEY}" "${SSH_TARGET}" "
  sudo systemctl daemon-reload
  sudo systemctl restart counsel-day-app
  sleep 2
  sudo systemctl is-active counsel-day-app
"

echo "[deploy] smoke test /api/health"
sleep 1
curl -sS https://counsel.day/api/health | head -1
echo
echo "[deploy] done"
