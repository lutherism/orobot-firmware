sudo /root/.nvm/versions/node/v8.17.0/bin/node -e "require('/home/pi/orobot-firmware/scripts/switch-to-wifi-ap.js').upWifiAP()"
sleep 2;
sudo ip addr flush dev wlan0
sudo ip addr add 192.168.0.172 dev wlan0
sudo rfkill unblock all
sudo systemctl restart dnsmasq.service
sudo systemctl unmask hostapd
sudo systemctl enable hostapd
sudo systemctl restart hostapd.service
sudo systemctl restart nginx
sudo systemctl restart isc-dhcp-server
