sudo /root/.nvm/versions/node/v8.17.0/bin/node -e "require('/home/pi/orobot-firmware/scripts/switch-to-wifi-client.js').writeWPAConf()"
sudo systemctl stop hostapd.service
sudo systemctl stop dnsmasq.service
sudo rfkill unblock all
sudo killall dhcpd
sudo systemctl restart wpa_supplicant
sudo dhclient &
sudo systemctl restart dnsmasq
sudo /home/pi/orobot-firmware/kill-keep-alive.sh
sudo /home/pi/orobot-firmware/reboot.sh
