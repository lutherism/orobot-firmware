sudo /root/.nvm/versions/node/v8.17.0/bin/node -e "require('/home/pi/orobot-firmware/scripts/switch-to-wifi-client.js').writeWPAConf()"
sleep 2
sudo systemctl stop hostapd.service
sudo systemctl stop dnsmasq.service
sudo rfkill unblock all
sudo killall dhcpd
sudo killall wpa_supplicant
sudo killall dnsmasq
sudo ifconfig wlan0 down
sudo ifconfig wlan0 up
sudo wpa_supplicant -i wlan0 -c/etc/wpa_supplicant/wpa_supplicant.conf &
sleep 5
sudo dhclient &
sudo systemctl restart dnsmasq
sudo /home/pi/orobot-firmware/kill-keep-alive.sh
sudo /home/pi/orobot-firmware/reboot.sh
