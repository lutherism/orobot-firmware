/home/pi/.config/nvm/versions/node/v8.17.0/bin/node -e "require('./scripts/switch-to-wifi-client.js').createWPAConf()"
sudo systemctl stop hostapd.service
sudo systemctl stop dnsmasq.service
reboot
