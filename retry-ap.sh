BASEDIR="/home/pi/orobot-firmware"

while [ "$(iw wlan0 info | grep 'type AP')" = "" ]; do
  echo "No network: $(date)"
  sleep 5
  echo "sudo $BASEDIR/switch-to-wifi-ap.sh &" | bash
done
