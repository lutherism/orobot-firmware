/home/pi/.config/nvm/versions/node/v8.17.0/bin/node -e "require('./scripts/switch-to-wifi-ap.js').upWifiAP()"
sudo ip addr flush dev wlan0
sudo ip addr add 192.168.0.172 dev wlan0
sudo systemctl restart dnsmasq.service
sudo systemctl restart hostapd.service
sudo rfkill unblock all
sudo ifconfig wlan0 down
sudo ifconfig wlan0 up
sudo wpa_cli -i wlan0 reconfigure
sudo systemctl restart nginx
