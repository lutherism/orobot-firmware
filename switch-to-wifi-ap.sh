sudo /root/.nvm/versions/node/v8.17.0/bin/node -e "require('./scripts/switch-to-wifi-ap.js').upWifiAP()"
sleep 2;
sudo ip addr flush dev wlan0
sudo ip addr add 192.168.0.172 dev wlan0
sudo rfkill unblock all
sudo killall wpa_supplicant
sudo systemctl restart dnsmasq.service
sudo systemctl stop wpa_supplicant
sudo systemctl unmask hostapd
sudo systemctl enable hostapd
sudo systemctl restart hostapd.service
sudo systemctl restart nginx
sudo /root/.nvm/versions/node/v8.17.0/bin/node ap-server.js >> /home/pi/orobot-firmware/tmp/run.log &
sudo wpa_supplicant -i wlan0 -c/etc/wpa_supplicant/wpa_supplicant.conf &
