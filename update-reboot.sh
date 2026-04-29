#!/usr/bin/env bash
# Pull the latest firmware and restart the service.
# Invoked by the firmware's 'update' message handler.
set -euo pipefail

INSTALL_DIR="${OROBOT_INSTALL_DIR:-/opt/orobot}"

git -C "$INSTALL_DIR" fetch --depth=1 origin master
git -C "$INSTALL_DIR" reset --hard origin/master
npm --prefix "$INSTALL_DIR" ci
npm --prefix "$INSTALL_DIR" run build:firmware

systemctl restart orobot.service
