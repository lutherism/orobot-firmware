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
sudo killall wpa_supplicant
sudo killall dnsmasq
sudo iwconfig wlan0 power off
sudo ifconfig wlan0 down
sudo ifconfig wlan0 up
sudo wpa_supplicant -i wlan0 -c/etc/wpa_supplicant/wpa_supplicant.conf | \
  sudo awk '/Associated with/{system("sudo dhclient &")} {print}'
sudo systemctl restart dnsmasq
