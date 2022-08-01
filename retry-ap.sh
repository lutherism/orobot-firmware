BASEDIR="/home/pi/orobot-firmware"
NODE_BIN="/home/pi/.config/nvm/versions/node/v8.17.0/bin/node"

echo "sudo $BASEDIR/switch-to-wifi-ap.sh &" | bash >> $BASEDIR/tmp/run.log &
sleep 15s
while [ "$(iw wlan0 info | grep 'type AP')" = "" ]; do
  echo "No network: $(date)"
  if ps ax | grep -v grep | grep "switch-to-wifi-ap.sh" > /dev/null
  then
    echo "Already running switch to ap" >> $BASEDIR/tmp/run.log
  else
    echo "sudo $BASEDIR/switch-to-wifi-ap.sh &" | bash >> $BASEDIR/tmp/run.log &
  fi
  sleep 15s
done
echo "sudo $BASEDIR/kill-web-ap.sh" | bash
echo "sudo $NODE_BIN $BASEDIR/ap-server.js" | bash
echo "Updated to Access Provider mode"
