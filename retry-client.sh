BASEDIR="/home/pi/orobot-firmware"

echo "sudo $BASEDIR/switch-to-wifi-client.sh" | bash >> $BASEDIR/tmp/run.log &
while [ "$(iw wlan0 info | grep 'type managed')" = "" ]; do
  echo "No network: $(date)"
  sleep 5s
  echo "sudo $BASEDIR/switch-to-wifi-client.sh" | bash >> $BASEDIR/tmp/run.log &
done
