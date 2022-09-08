#!/usr/bin/env bash
cp ./scripts/datatemplates/factory_install.conf /etc/wpa_supplicant/wpa_supplicant.conf
wpa_supplicant -iwlan0 -c /etc/wpa_supplicant/wpa_supplicant.conf &
sleep 3
sudo apt-get update
printf 'y\n' | sudo apt-get install hostapd dnsmasq nginx curl
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.1/install.sh | bash
source /root/.nvm/install.sh
nvm bash_completion
nvm install 8
nvm use 8
cd /home/pi/orobot-firmware
npm i
sudo crontab /home/pi/reboot.cron
sudo service cron reload
./factory-reset.sh
