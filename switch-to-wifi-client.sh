sudo /root/.nvm/versions/node/v8.17.0/bin/node -e "require('/home/pi/orobot-firmware/scripts/switch-to-wifi-client.js').writeWPAConf()"
sleep 2
sudo systemctl stop hostapd.service
sudo systemctl stop dnsmasq
sudo killall dhclient
sudo killall wpa_supplicant
sudo rm -rf /var/run/wpa_supplicant/
sudo ip link set dev wlan0 down
sudo systemctl restart networking
