BASEDIR="/home/pi/orobot-firmware"

while [ "$(hostname -I)" = "" ]; do
  echo -e "\e[1A\e[KNo network: $(date)"
  sleep 5
  echo "sudo $BASEDIR/switch-to-wifi-ap.sh" | bash
done
