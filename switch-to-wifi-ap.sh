/home/pi/.config/nvm/versions/node/v8.17.0/bin/node -e "require('./scripts/switch-to-wifi-ap.js').upWifiAP()"
sudo ip link set dev wlan0 down
sudo ip addr flush dev wlan0
sudo ip addr add 192.168.0.172/24 dev wlan0
sudo systemctl restart dnsmasq.service
sudo systemctl restart hostapd.service
sudo rfkill unblock all
sudo ifconfig wlan0 down
sudo ifconfig wlan0 up
wpa_cli -i wlan0 reconfigure
