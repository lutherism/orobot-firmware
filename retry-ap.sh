BASEDIR="/home/pi/orobot-firmware"
NODE_BIN="/root/.nvm/versions/node/v8.17.0/bin/node"
script_name=$(basename -- "$0")

if pidof -x "$script_name" -o $$ >/dev/null;
then
  echo "Duplicate process"
  exit 0;
fi

while [ "$(iw wlan0 info | grep 'type AP')" = "" ]; do
  echo "No network: $(date)"
  if ps ax | grep -v grep | grep "switch-to-wifi-ap.sh" > /dev/null
  then
    echo "Already running switch to ap" >> $BASEDIR/tmp/run.log
  else
    echo "sudo $BASEDIR/switch-to-wifi-ap.sh &" | bash >> $BASEDIR/tmp/run.log &
  fi
  sleep 25s
done
echo "sudo $BASEDIR/kill-switch-network.sh" | bash
echo "sudo $BASEDIR/kill-web-ap.sh" | bash
echo "sudo $NODE_BIN $BASEDIR/ap-server.js" | bash
echo "Updated to Access Provider mode"
