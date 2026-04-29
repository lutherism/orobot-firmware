#!/usr/bin/env bash
# Install orobot firmware on an NVIDIA Jetson (Nano / Xavier NX / Orin Nano).
#
# Run on a JetPack-flashed device:
#   curl -fsSL https://raw.githubusercontent.com/lutherism/orobot-firmware/master/scripts/install-jetson.sh | sudo bash
# or after cloning:
#   sudo ./scripts/install-jetson.sh
#
# Idempotent: safe to re-run after kernel updates or board re-flash.
# State in /var/lib/orobot (device UUID) is preserved on re-run.
set -euo pipefail

REPO_URL="${OROBOT_REPO_URL:-https://github.com/lutherism/orobot-firmware.git}"
INSTALL_DIR="${OROBOT_INSTALL_DIR:-/opt/orobot}"
DATA_DIR="${OROBOT_DATA_DIR:-/var/lib/orobot}"
# Run service as the user who invoked sudo, falling back to the current user.
SERVICE_USER="${SUDO_USER:-$(whoami)}"

if [[ $EUID -ne 0 ]]; then
  echo "This script must be run as root (try: sudo $0)" >&2
  exit 1
fi

echo "==> Installing Node.js 20"
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v)" != v20* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

# JetPack ships a 'gpio' group; add the service user so it can write /sys/class/gpio.
if getent group gpio >/dev/null 2>&1; then
  usermod -a -G gpio "$SERVICE_USER"
fi

echo "==> Cloning/updating $REPO_URL into $INSTALL_DIR"
git config --global --add safe.directory "$INSTALL_DIR"
if [[ -d "$INSTALL_DIR/.git" ]]; then
  git -C "$INSTALL_DIR" fetch --depth=1 origin master
  git -C "$INSTALL_DIR" reset --hard origin/master
else
  git clone --depth=1 "$REPO_URL" "$INSTALL_DIR"
fi
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"

echo "==> Installing dependencies and building"
sudo -u "$SERVICE_USER" bash -lc "cd '$INSTALL_DIR' && npm ci && npm run build:firmware"

echo "==> Creating persistent data directory $DATA_DIR"
mkdir -p "$DATA_DIR"
chown "$SERVICE_USER:$SERVICE_USER" "$DATA_DIR"

# Seed hardware profile on first install.
DATA_FILE="$DATA_DIR/data.json"
if [[ ! -f "$DATA_FILE" ]]; then
  echo '{"hardware":"jetson"}' > "$DATA_FILE"
  chown "$SERVICE_USER:$SERVICE_USER" "$DATA_FILE"
fi

echo "==> Installing orobot-claim helper"
cp "$INSTALL_DIR/scripts/claim.sh" /usr/local/bin/orobot-claim
chmod +x /usr/local/bin/orobot-claim

echo "==> Writing systemd unit"
cat >/etc/systemd/system/orobot.service <<EOF
[Unit]
Description=orobot firmware (Jetson)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR
Environment=OROBOT_PLATFORM=jetson
Environment=OROBOT_DATA_DIR=$DATA_DIR
Environment=NODE_ENV=production
ExecStart=/usr/bin/node $INSTALL_DIR/dist/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now orobot.service

echo
echo "  orobot firmware installed on Jetson (running as $SERVICE_USER)."
echo
echo "  Claim this device to your account:"
echo "    1. Go to orobot.io/o/robots and generate a claim code."
echo "    2. Run: orobot-claim <code>"
echo
echo "  Useful commands:"
echo "    systemctl status orobot.service"
echo "    journalctl -u orobot.service -f"
