sudo ip link set dev wlan0 down
sudo systemctl restart dnsmasq.service
sudo systemctl restart hostapd.service
