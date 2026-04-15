#!/usr/bin/env bash
# Install ORobot firmware on an NVIDIA Jetson (Nano / Xavier NX / Orin Nano).
#
# Run on a fresh JetPack-flashed device:
#   curl -fsSL https://orobot.io/install-jetson.sh | sudo bash
# or after cloning:
#   sudo ./scripts/install-jetson.sh
#
# What it does:
#   1. Installs Node.js 20 from NodeSource (Jetson stock repo is older).
#   2. Clones (or updates) orobot-firmware into /opt/orobot.
#   3. Installs deps + builds.
#   4. Writes a systemd unit that boots the firmware with OROBOT_PLATFORM=jetson.
#
# Idempotent: safe to re-run after kernel updates or board re-flash.
set -euo pipefail

REPO_URL="${OROBOT_REPO_URL:-https://github.com/lutherism/orobot-firmware.git}"
INSTALL_DIR="${OROBOT_INSTALL_DIR:-/opt/orobot}"
SERVICE_USER="${OROBOT_USER:-orobot}"

if [[ $EUID -ne 0 ]]; then
  echo "This script must be run as root (try: sudo $0)" >&2
  exit 1
fi

echo "==> Installing Node.js 20"
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v)" != v20* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo "==> Ensuring system user '$SERVICE_USER' exists and is in gpio group"
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --create-home --shell /bin/bash "$SERVICE_USER"
fi
# JetPack ships a 'gpio' group whose members can write /sys/class/gpio without root.
if getent group gpio >/dev/null 2>&1; then
  usermod -a -G gpio "$SERVICE_USER"
fi

echo "==> Cloning/updating $REPO_URL into $INSTALL_DIR"
if [[ -d "$INSTALL_DIR/.git" ]]; then
  git -C "$INSTALL_DIR" fetch --depth=1 origin master
  git -C "$INSTALL_DIR" reset --hard origin/master
else
  git clone --depth=1 "$REPO_URL" "$INSTALL_DIR"
fi
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"

echo "==> Installing dependencies and building"
sudo -u "$SERVICE_USER" bash -lc "cd '$INSTALL_DIR' && npm ci && npm run build:firmware"

echo "==> Writing systemd unit"
cat >/etc/systemd/system/orobot.service <<EOF
[Unit]
Description=ORobot firmware (Jetson)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR
Environment=OROBOT_PLATFORM=jetson
Environment=NODE_ENV=production
ExecStart=/usr/bin/node $INSTALL_DIR/dist/dev.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now orobot.service

echo
echo "✓ ORobot firmware installed."
echo "  Status:  systemctl status orobot.service"
echo "  Logs:    journalctl -u orobot.service -f"
