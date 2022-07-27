BASEDIR="/home/pi/orobot-firmware"
NODE_BIN="/home/pi/.config/nvm/versions/node/v8.17.0/bin/node"

while [ "$(iw wlan0 info | grep 'type AP')" = "" ]; do
  echo "No network: $(date)"
  sleep 15s
  echo "sudo $BASEDIR/switch-to-wifi-ap.sh &" | bash >> $BASEDIR/tmp/run.log &
done
echo "sudo $BASEDIR/kill-web-ap.sh" | bash
echo "sudo $NODE_BIN $BASEDIR/ap-server.js" | bash
echo "Updated to Access Provider mode"
