BASEDIR="/home/pi/orobot-firmware"

echo "sudo $BASEDIR/switch-to-wifi-client.sh" | bash >> $BASEDIR/tmp/run.log &
sleep 15s
while [ "$(iw wlan0 info | grep 'type managed')" = "" ]; do
  echo "No network: $(date)"
  sleep 15s
  echo "sudo $BASEDIR/switch-to-wifi-client.sh" | bash >> $BASEDIR/tmp/run.log &
done
echo "Update to Wifi Client mode"
