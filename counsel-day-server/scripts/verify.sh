#!/usr/bin/env bash
#
# counsel-day-server/scripts/verify.sh
#
# Sanity-check the server hardening from bootstrap.sh. Run with sudo.
# Exits non-zero on the first failed check. Re-run after any change.
#
# Usage:
#   scp scripts/verify.sh counsel@<HETZNER_IP>:/home/counsel/
#   ssh counsel@<HETZNER_IP> 'chmod +x verify.sh && sudo ./verify.sh'

set -uo pipefail
IFS=$'\n\t'

if [[ "$(id -u)" -ne 0 ]]; then
  echo "verify.sh must run as root. Try: sudo $0" >&2
  exit 1
fi

PASS=0
FAIL=0

ok()   { printf '  [PASS] %s\n' "$*"; PASS=$((PASS + 1)); }
bad()  { printf '  [FAIL] %s\n' "$*"; FAIL=$((FAIL + 1)); }
head() { printf '\n== %s ==\n' "$*"; }

# ----------------------------------------------------------------------------
head "SSH hardening"
# ----------------------------------------------------------------------------
if grep -qE '^PermitRootLogin no' /etc/ssh/sshd_config; then
  ok "PermitRootLogin no"
else
  bad "PermitRootLogin is not set to 'no'"
fi

if grep -qE '^PasswordAuthentication no' /etc/ssh/sshd_config; then
  ok "PasswordAuthentication no"
else
  bad "PasswordAuthentication is not set to 'no'"
fi

if grep -qE '^AllowUsers counsel' /etc/ssh/sshd_config; then
  ok "AllowUsers restricted to counsel"
else
  bad "AllowUsers does not restrict to 'counsel'"
fi

# ----------------------------------------------------------------------------
head "Firewall (UFW)"
# ----------------------------------------------------------------------------
UFW_STATUS=$(ufw status verbose 2>/dev/null | head -1)
if [[ "$UFW_STATUS" == *"Status: active"* ]]; then
  ok "UFW is active"
else
  bad "UFW is not active"
fi

if ufw status | grep -qE '^22.*ALLOW'; then ok "UFW allows 22/tcp"; else bad "UFW does not allow 22/tcp"; fi
if ufw status | grep -qE '^80.*ALLOW'; then ok "UFW allows 80/tcp"; else bad "UFW does not allow 80/tcp"; fi
if ufw status | grep -qE '^443.*ALLOW'; then ok "UFW allows 443/tcp"; else bad "UFW does not allow 443/tcp"; fi

# ----------------------------------------------------------------------------
head "Intrusion prevention (fail2ban)"
# ----------------------------------------------------------------------------
if systemctl is-active --quiet fail2ban; then
  ok "fail2ban is running"
else
  bad "fail2ban is not running"
fi

if fail2ban-client status sshd &>/dev/null; then
  ok "fail2ban sshd jail is configured"
else
  bad "fail2ban sshd jail is missing"
fi

# ----------------------------------------------------------------------------
head "Automatic security updates"
# ----------------------------------------------------------------------------
if grep -qE '^APT::Periodic::Unattended-Upgrade "1"' /etc/apt/apt.conf.d/20auto-upgrades 2>/dev/null; then
  ok "Unattended-upgrades enabled"
else
  bad "Unattended-upgrades not enabled"
fi

# ----------------------------------------------------------------------------
head "Docker"
# ----------------------------------------------------------------------------
if command -v docker &>/dev/null; then
  ok "Docker CLI present: $(docker --version)"
else
  bad "Docker is not installed"
fi

if systemctl is-active --quiet docker; then
  ok "Docker service is running"
else
  bad "Docker service is not running"
fi

if docker compose version &>/dev/null; then
  ok "Docker Compose plugin: $(docker compose version | head -1)"
else
  bad "Docker Compose plugin missing"
fi

# ----------------------------------------------------------------------------
head "LUKS encrypted data volume"
# ----------------------------------------------------------------------------
if mountpoint -q /var/lib/postgres-data 2>/dev/null; then
  ok "/var/lib/postgres-data is mounted"
else
  bad "/var/lib/postgres-data is not mounted (expected after Phase B.4 + C.8)"
fi

if cryptsetup status pg-data-decrypted &>/dev/null; then
  ok "LUKS device pg-data-decrypted is open"
  # Verify cipher
  CIPHER=$(cryptsetup status pg-data-decrypted | grep cipher | awk '{print $2}')
  if [[ "$CIPHER" == "aes-xts-plain64" ]]; then
    ok "Cipher is aes-xts-plain64 (expected)"
  else
    bad "Unexpected cipher: $CIPHER (expected aes-xts-plain64)"
  fi
else
  bad "LUKS device pg-data-decrypted is not open"
fi

if [[ -f /var/lib/postgres-data/.luks-active ]]; then
  ok "Sentinel /var/lib/postgres-data/.luks-active present"
else
  bad "Sentinel file missing (was Phase B.4 step 6 completed?)"
fi

# ----------------------------------------------------------------------------
head "Sysctl hardening"
# ----------------------------------------------------------------------------
if [[ "$(sysctl -n net.ipv4.tcp_syncookies)" == "1" ]]; then
  ok "tcp_syncookies enabled"
else
  bad "tcp_syncookies disabled"
fi

if [[ "$(sysctl -n net.ipv4.conf.all.rp_filter)" == "1" ]]; then
  ok "rp_filter enabled (IP spoof protection)"
else
  bad "rp_filter disabled"
fi

# ----------------------------------------------------------------------------
head "Result"
# ----------------------------------------------------------------------------
printf '  Passed: %d\n' "$PASS"
printf '  Failed: %d\n' "$FAIL"
echo

if [[ "$FAIL" -gt 0 ]]; then
  echo "verify.sh: one or more checks FAILED. Fix them before continuing." >&2
  exit 1
fi

echo "verify.sh: all checks passed."
exit 0
