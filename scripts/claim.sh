#!/usr/bin/env bash
# Claim this Jetson device to your orobot.io account.
#
# Usage:
#   orobot-claim <code>           # code printed by: journalctl -u orobot.service -n 20
#
# You will be prompted for your orobot.io email and password.
set -euo pipefail

GATEWAY="${OROBOT_API:-https://orobot.io}"
CODE="${1:-}"

if [[ -z "$CODE" ]]; then
  echo "Usage: $0 <claim-code>" >&2
  echo "  Find your code with: journalctl -u orobot.service -n 20" >&2
  exit 1
fi

read -rp "orobot.io email: " EMAIL
read -rsp "orobot.io password: " PASSWORD
echo

COOKIE_JAR=$(mktemp)
trap 'rm -f "$COOKIE_JAR"' EXIT

LOGIN=$(curl -fsSL -c "$COOKIE_JAR" -X POST "$GATEWAY/api/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":$(printf '%s' "$EMAIL" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'),\"password\":$(printf '%s' "$PASSWORD" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')}")

if ! echo "$LOGIN" | grep -q '"uuid"'; then
  echo "Login failed." >&2
  exit 1
fi

RESULT=$(curl -fsSL -b "$COOKIE_JAR" -X POST "$GATEWAY/api/device/claim-code/link" \
  -H "Content-Type: application/json" \
  -d "{\"code\":\"$CODE\"}")

if echo "$RESULT" | grep -q '"deviceUuid"'; then
  DEVICE_UUID=$(echo "$RESULT" | grep -o '"deviceUuid":"[^"]*"' | cut -d'"' -f4)
  echo "Device claimed: $DEVICE_UUID"
  echo "Visit $GATEWAY/o/robots to see it."
else
  echo "Claim failed: $RESULT" >&2
  exit 1
fi
