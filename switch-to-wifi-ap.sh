/home/pi/.config/nvm/versions/node/v8.17.0/bin/node -e "require('./scripts/switch-to-wifi-ap.js').upWifiAP()"
sudo ip addr flush dev wlan0
sudo ip addr add 192.168.0.172 dev wlan0
sudo systemctl restart dnsmasq.service
sudo systemctl restart hostapd.service
sudo rfkill unblock all
sudo ifconfig wlan0 down
sudo ifconfig wlan0 up
sudo systemctl restart nginx
sudo /home/pi/.config/nvm/versions/node/v8.17.0/bin/node server.js >> /home/pi/orobot-firmware/tmp/web.log &
sudo killall wpa_supplicant
sudo wpa_supplicant -i wlan0 -c/etc/wpa_supplicant/wpa_supplicant.conf &
