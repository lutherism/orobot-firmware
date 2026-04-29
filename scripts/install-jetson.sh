#!/usr/bin/env bash
# Install orobot firmware on an NVIDIA Jetson (Nano / Xavier NX / Orin Nano).
#
# Run on a JetPack-flashed device (USB SSH or local terminal):
#   curl -fsSL https://orobot.io/install-jetson.sh | sudo bash
# or after cloning:
#   sudo ./scripts/install-jetson.sh
#
# What it does:
#   1. Installs Node.js 20 from NodeSource.
#   2. Clones (or updates) orobot-firmware into /opt/orobot.
#   3. Installs deps + builds.
#   4. Creates /var/lib/orobot for persistent device state (survives firmware updates).
#   5. Writes a systemd unit that boots the firmware with OROBOT_PLATFORM=jetson.
#
# Idempotent: safe to re-run after kernel updates or board re-flash.
# State in /var/lib/orobot (WiFi credentials, device UUID) is preserved on re-run.
set -euo pipefail

REPO_URL="${OROBOT_REPO_URL:-https://github.com/lutherism/orobot-firmware.git}"
INSTALL_DIR="${OROBOT_INSTALL_DIR:-/opt/orobot}"
DATA_DIR="${OROBOT_DATA_DIR:-/var/lib/orobot}"
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

echo "==> Ensuring system user '$SERVICE_USER' exists"
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --create-home --shell /bin/bash "$SERVICE_USER"
fi
# JetPack ships a 'gpio' group; members can write /sys/class/gpio without root.
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

echo "==> Creating persistent data directory $DATA_DIR"
mkdir -p "$DATA_DIR"
chown "$SERVICE_USER:$SERVICE_USER" "$DATA_DIR"
chmod 750 "$DATA_DIR"

# Seed hardware profile on first install so the firmware knows it's on Jetson.
DATA_FILE="$DATA_DIR/data.json"
if [[ ! -f "$DATA_FILE" ]]; then
  echo '{"hardware":"jetson"}' > "$DATA_FILE"
  chown "$SERVICE_USER:$SERVICE_USER" "$DATA_FILE"
fi

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
Environment=OROBOT_INSTALL_DIR=$INSTALL_DIR
Environment=NODE_ENV=production
ExecStart=/usr/bin/node $INSTALL_DIR/dist/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now orobot.service

# Determine the AP SSID the device will broadcast if WiFi isn't configured.
DEVICE_UUID=""
if [[ -f "$DATA_FILE" ]]; then
  DEVICE_UUID=$(node -e "try{const d=require('$DATA_FILE');process.stdout.write(d.deviceUuid||'')}catch{}" 2>/dev/null || true)
fi
AP_SUFFIX="${DEVICE_UUID:0:5}"
AP_SSID="OROBOT-Setup${AP_SUFFIX:+-$AP_SUFFIX}"

echo
echo "  orobot firmware installed on Jetson."
echo
echo "  Next step — claim this device to your account:"
echo "    1. On your phone or laptop, connect to the WiFi network: $AP_SSID"
echo "       (The device broadcasts this AP when WiFi is not yet configured.)"
echo "    2. Your browser should open the setup portal automatically."
echo "       If not, navigate to http://192.168.4.1"
echo "    3. Enter your WiFi credentials and the claim code shown on screen"
echo "       at orobot.io/claim"
echo
echo "  Useful commands:"
echo "    systemctl status orobot.service"
echo "    journalctl -u orobot.service -f"
