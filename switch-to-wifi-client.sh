sudo /root/.nvm/versions/node/v8.17.0/bin/node -e "require('/home/pi/orobot-firmware/scripts/switch-to-wifi-client.js').writeWPAConf()"
sleep 2
sudo systemctl stop hostapd.service
sudo systemctl stop dnsmasq.service
sudo systemctl restart wpa_supplicant
sudo rfkill unblock all
sudo killall dhcpd
sudo killall dnsmasq
sudo ifconfig wlan0 down
sudo ifconfig wlan0 up
sleep 3
sudo dhclient wlan0 &
sudo systemctl restart dnsmasq
