#!/usr/bin/env bash
# ============================================================
# COUNSEL.DAY APP · FIRST-TIME SERVER INSTALL
# Run this ONCE per server. Creates /opt/counsel-day-app, installs the
# systemd unit, and reloads systemd. Does NOT start the unit (that
# happens at the end of scripts/deploy.sh).
#
# Prerequisites already met by Phase A1 of the scaffold:
#   - Node 20 installed
#   - Postgres 16 running, counsel_day DB created, app user created
#   - /etc/counsel-day-app/env.local exists with DATABASE_URL
# ============================================================
set -euo pipefail

SSH_KEY="${HOME}/.ssh/id_ed25519_counsel_day"
SSH_TARGET="deploy@46.225.133.203"

cd "$(dirname "$0")/.."

echo "[install] uploading systemd unit"
scp -i "${SSH_KEY}" ops/counsel-day-app.service "${SSH_TARGET}:/tmp/"

ssh -i "${SSH_KEY}" "${SSH_TARGET}" "
  set -e
  echo '[install] move unit into place'
  sudo mv /tmp/counsel-day-app.service /etc/systemd/system/counsel-day-app.service
  sudo chown root:root /etc/systemd/system/counsel-day-app.service
  sudo chmod 644 /etc/systemd/system/counsel-day-app.service

  echo '[install] create /opt/counsel-day-app + cache dir'
  sudo mkdir -p /opt/counsel-day-app
  sudo chown -R deploy:deploy /opt/counsel-day-app

  echo '[install] systemd daemon-reload + enable on boot'
  sudo systemctl daemon-reload
  sudo systemctl enable counsel-day-app
  echo '[install] done. Run scripts/deploy.sh to ship code + start the service.'
"
