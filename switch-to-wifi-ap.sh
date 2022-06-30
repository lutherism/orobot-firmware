node -e "require('./scripts/switch-to-wifi-ap.js').upWifiAP()"
sudo ip link set dev wlan0 down
sudo ip addr add 192.168.0.172/24 dev wlan0
sudo systemctl restart dnsmasq.service
sudo systemctl restart hostapd.service
reboot
