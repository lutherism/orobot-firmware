node -c "require('./scripts/switch-to-wifi-client.js').createWPAConf()"
sudo systemctl stop hostapd.service
sudo systemctl stop dnsmasq.service
