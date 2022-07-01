/home/pi/.config/nvm/versions/node/v8.17.0/bin/node -e "require('./scripts/switch-to-wifi-client.js').writeWPAConf()"
sudo systemctl restart hostapd.service
sudo systemctl restart dnsmasq.service
sudo rfkill unblock all
sudo ifconfig wlan0 down
sudo ifconfig wlan0 up
sudo wpa_supplicant -i wlan0 -c/etc/wpa_supplicant/wpa_supplicant.conf
