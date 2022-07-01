/home/pi/.config/nvm/versions/node/v8.17.0/bin/node -e "require('./scripts/switch-to-wifi-client.js').writeWPAConf()"
sudo systemctl stop hostapd.service
sudo systemctl stop dnsmasq.service
sudo rfkill unblock all
sudo killall dhcpd
sudo killall wpa_supplicant
sudo ifconfig wlan0 down
sudo ifconfig wlan0 up
sudo wpa_supplicant -i wlan0 -c/etc/wpa_supplicant/wpa_supplicant.conf
