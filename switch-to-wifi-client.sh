/home/pi/.config/nvm/versions/node/v8.17.0/bin/node -e "require('./scripts/switch-to-wifi-client.js').writeWPAConf()"
sudo systemctl stop hostapd.service
sudo systemctl stop dnsmasq.service
sudo rfkill unblock all
sudo ifconfig wlan0 down
sudo ifconfig wlan0 up
