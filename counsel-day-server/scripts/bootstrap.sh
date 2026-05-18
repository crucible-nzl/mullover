#!/usr/bin/env bash
#
# counsel-day-server/scripts/bootstrap.sh
#
# Run as root on a fresh Ubuntu 24.04 Hetzner CPX31 host, once.
# See ../SETUP.md Phase B.3 for context.
#
# This script is idempotent: re-running it is safe and will report
# which steps were already completed. It does NOT touch the data volume
# (LUKS-format that manually per SETUP.md B.4).

set -euo pipefail
IFS=$'\n\t'

if [[ "$(id -u)" -ne 0 ]]; then
  echo "bootstrap.sh must run as root. Try: sudo $0" >&2
  exit 1
fi

HOSTNAME_NEW="counsel-day-app-1"
COUNSEL_USER="counsel"
SSH_PORT="22"

log()  { printf '[bootstrap] %s\n' "$*"; }
warn() { printf '[bootstrap WARN] %s\n' "$*" >&2; }
fail() { printf '[bootstrap FAIL] %s\n' "$*" >&2; exit 1; }

# ----------------------------------------------------------------------------
# 1 · hostname + timezone
# ----------------------------------------------------------------------------
log "Setting hostname to $HOSTNAME_NEW"
hostnamectl set-hostname "$HOSTNAME_NEW"

log "Setting timezone to Etc/UTC (servers run in UTC; humans translate)"
timedatectl set-timezone Etc/UTC

# ----------------------------------------------------------------------------
# 2 · apt update + base packages
# ----------------------------------------------------------------------------
log "Updating apt and installing base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get -y -qq dist-upgrade
apt-get -y -qq install \
  ufw \
  fail2ban \
  unattended-upgrades \
  age \
  cryptsetup \
  cryptsetup-bin \
  htop \
  curl \
  git \
  ca-certificates \
  gnupg \
  apt-transport-https \
  software-properties-common \
  jq \
  rsync \
  net-tools \
  dnsutils

# ----------------------------------------------------------------------------
# 3 · counsel user
# ----------------------------------------------------------------------------
if id "$COUNSEL_USER" &>/dev/null; then
  log "User $COUNSEL_USER already exists, skipping create"
else
  log "Creating user $COUNSEL_USER with sudo group"
  adduser --disabled-password --gecos "" "$COUNSEL_USER"
  usermod -aG sudo "$COUNSEL_USER"
fi

# Allow passwordless sudo for counsel so docker compose calls do not stall on prompts.
echo "$COUNSEL_USER ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/90-$COUNSEL_USER
chmod 440 /etc/sudoers.d/90-$COUNSEL_USER

# Copy authorised keys from root to counsel so SSH-key login works for the new user.
if [[ -f /root/.ssh/authorized_keys ]]; then
  install -d -m 700 -o "$COUNSEL_USER" -g "$COUNSEL_USER" "/home/$COUNSEL_USER/.ssh"
  install -m 600 -o "$COUNSEL_USER" -g "$COUNSEL_USER" \
    /root/.ssh/authorized_keys "/home/$COUNSEL_USER/.ssh/authorized_keys"
  log "Copied root authorised keys to /home/$COUNSEL_USER/.ssh/authorized_keys"
else
  warn "No /root/.ssh/authorized_keys found. Did you upload an SSH key in Hetzner?"
fi

# ----------------------------------------------------------------------------
# 4 · SSH hardening
# ----------------------------------------------------------------------------
log "Hardening sshd configuration"
SSHD_CONFIG=/etc/ssh/sshd_config
cp "$SSHD_CONFIG" "${SSHD_CONFIG}.bootstrap-backup"

sed -i \
  -e 's/^#\?PermitRootLogin.*/PermitRootLogin no/' \
  -e 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' \
  -e 's/^#\?PermitEmptyPasswords.*/PermitEmptyPasswords no/' \
  -e 's/^#\?ChallengeResponseAuthentication.*/ChallengeResponseAuthentication no/' \
  -e 's/^#\?KbdInteractiveAuthentication.*/KbdInteractiveAuthentication no/' \
  -e 's/^#\?UsePAM.*/UsePAM yes/' \
  -e 's/^#\?X11Forwarding.*/X11Forwarding no/' \
  -e 's/^#\?AllowAgentForwarding.*/AllowAgentForwarding no/' \
  -e 's/^#\?AllowTcpForwarding.*/AllowTcpForwarding no/' \
  -e 's/^#\?MaxAuthTries.*/MaxAuthTries 3/' \
  -e "s/^#\?Port.*/Port $SSH_PORT/" \
  "$SSHD_CONFIG"

# Restrict SSH to the counsel user only.
if ! grep -q "^AllowUsers " "$SSHD_CONFIG"; then
  echo "AllowUsers $COUNSEL_USER" >> "$SSHD_CONFIG"
fi

sshd -t || fail "sshd config test failed; restoring backup. Inspect ${SSHD_CONFIG}.bootstrap-backup"
systemctl restart ssh

# ----------------------------------------------------------------------------
# 5 · UFW
# ----------------------------------------------------------------------------
log "Configuring UFW firewall"
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow "$SSH_PORT"/tcp comment 'SSH (counsel only)'
ufw allow 80/tcp comment 'HTTP (Caddy redirects to HTTPS)'
ufw allow 443/tcp comment 'HTTPS (Caddy)'
ufw --force enable

# ----------------------------------------------------------------------------
# 6 · fail2ban
# ----------------------------------------------------------------------------
log "Configuring fail2ban for sshd"
cat > /etc/fail2ban/jail.d/sshd.local <<'EOF'
[sshd]
enabled = true
port = 22
filter = sshd
logpath = %(sshd_log)s
backend = systemd
maxretry = 5
findtime = 10m
bantime = 1h
EOF
systemctl restart fail2ban

# ----------------------------------------------------------------------------
# 7 · unattended-upgrades
# ----------------------------------------------------------------------------
log "Enabling unattended-upgrades for security patches"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
APT::Periodic::Download-Upgradeable-Packages "1";
EOF
cat > /etc/apt/apt.conf.d/50unattended-upgrades-counsel <<'EOF'
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}-security";
    "${distro_id}ESMApps:${distro_codename}-apps-security";
    "${distro_id}ESM:${distro_codename}-infra-security";
};
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
EOF

# ----------------------------------------------------------------------------
# 8 · Docker Engine + compose plugin
# ----------------------------------------------------------------------------
if command -v docker &>/dev/null; then
  log "Docker already installed, skipping"
else
  log "Installing Docker Engine from official Docker apt repo"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get -y -qq install \
    docker-ce \
    docker-ce-cli \
    containerd.io \
    docker-buildx-plugin \
    docker-compose-plugin
fi

# Add counsel user to docker group so they can run docker without sudo.
usermod -aG docker "$COUNSEL_USER"

systemctl enable --now docker

# ----------------------------------------------------------------------------
# 9 · sysctl hardening
# ----------------------------------------------------------------------------
log "Applying sysctl hardening"
cat > /etc/sysctl.d/99-counsel-day.conf <<'EOF'
# Counsel.day server hardening
# IP spoof protection
net.ipv4.conf.all.rp_filter=1
net.ipv4.conf.default.rp_filter=1
# Ignore ICMP redirects
net.ipv4.conf.all.accept_redirects=0
net.ipv6.conf.all.accept_redirects=0
# Ignore source-routed packets
net.ipv4.conf.all.accept_source_route=0
net.ipv6.conf.all.accept_source_route=0
# Log martians
net.ipv4.conf.all.log_martians=1
# SYN flood protection
net.ipv4.tcp_syncookies=1
net.ipv4.tcp_max_syn_backlog=4096
# Disable IPv6 router advertisements (we use static config)
net.ipv6.conf.all.accept_ra=0
# Address randomisation for IPv6
net.ipv6.conf.all.use_tempaddr=2
net.ipv6.conf.default.use_tempaddr=2
EOF
sysctl --system >/dev/null

# ----------------------------------------------------------------------------
# 10 · final summary
# ----------------------------------------------------------------------------
log "================================================================"
log "Bootstrap complete."
log ""
log "Next steps · BEFORE you close this root session:"
log "  1. From a NEW terminal on your laptop, run:"
log "       ssh $COUNSEL_USER@\$(hostname -I | awk '{print \$1}')"
log "     Confirm you can sign in as $COUNSEL_USER."
log ""
log "  2. Once that works, you can exit this root session."
log ""
log "  3. Then follow SETUP.md from Phase B.4 onward:"
log "       - LUKS-format the data volume"
log "       - Install Caddy + Infisical"
log "       - Wire the LUKS unlock systemd unit"
log ""
log "DO NOT log out as root until the counsel SSH login is confirmed."
log "================================================================"
