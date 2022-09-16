if [ "$(curl google.com | grep 301)" != "" ];
then
  echo "Already a wifi client";
  exit 0;
fi

sudo /root/.nvm/versions/node/v8.17.0/bin/node -e "require('/home/pi/orobot-firmware/scripts/switch-to-wifi-client.js').writeWPAConf()"
sudo systemctl stop hostapd.service
sudo systemctl stop dnsmasq.service
sudo systemctl stop wpa_supplicant
sudo rfkill unblock all
sudo killall dhcpd
sudo killall wpa_supplicant
sudo killall dnsmasq
sudo ifconfig wlan0 down
sudo ifconfig wlan0 up
sudo wpa_supplicant -i wlan0 -c/etc/wpa_supplicant/wpa_supplicant.conf &
sudo dhclient &
sudo systemctl restart dnsmasq
