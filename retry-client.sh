BASEDIR="/home/pi/orobot-firmware"

while [ "$(iw wlan0 info | grep 'type managed')" = "" ]; do
  echo -e "\e[1A\e[KNo network: $(date)"
  sleep 5
  echo "sudo $BASEDIR/switch-to-wifi-ap.sh" | bash
done
