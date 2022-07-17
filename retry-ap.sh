BASEDIR="/home/pi/orobot-firmware"

echo "sudo $BASEDIR/switch-to-wifi-ap.sh &" | bash >> $BASEDIR/tmp/run.log &
while [ "$(iw wlan0 info | grep 'type AP')" = "" ]; do
  echo "No network: $(date)"
  sleep 5
  echo "sudo $BASEDIR/switch-to-wifi-ap.sh &" | bash >> $BASEDIR/tmp/run.log &
done
