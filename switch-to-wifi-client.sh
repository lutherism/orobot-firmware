sudo /root/.nvm/versions/node/v8.17.0/bin/node -e "require('/home/pi/orobot-firmware/scripts/switch-to-wifi-client.js').writeWPAConf()"
sleep 2
sudo systemctl stop hostapd.service
sudo systemctl stop dnsmasq.service
sudo systemctl stop dhclient
sudo systemctl stop wpa_supplicant
sudo systemctl stop networking
sudo rfkill unblock all
sudo killall dhcpd
sudo killall dhclient
sudo killall wpa_suppplicant
sudo killall dnsmasq
sudo ifconfig wlan0 down
sudo ifconfig wlan0 up
sudo wpa_supplicant -i wlan0 -c/etc/wpa_supplicant/wpa_supplicant.conf
sleep 3
sudo dhclient wlan0 &
sudo systemctl restart dnsmasq
