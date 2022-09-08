#!/usr/bin/env bash

curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.1/install.sh | bash
source /root/.nvm/install.sh
nvm bash_completion
nvm install 8
nvm use 8
cd /home/pi/orobot-firmware
npm i
sudo apt-get update
printf 'y\n' | sudo apt-get install hostapd dnsmasq nginx
sudo crontab /home/pi/reboot.cron
sudo service cron reload
./factory-reset.sh
