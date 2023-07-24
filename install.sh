#!/usr/bin/env bash
ps -ax | grep wpa_supp | awk '{print $1}' | xargs kill
cp ./scripts/datatemplates/factory_install.conf /etc/wpa_supplicant/wpa_supplicant.conf
wpa_supplicant -iwlan0 -c /etc/wpa_supplicant/wpa_supplicant.conf &
dhclient wlan0
sleep 3
sudo apt-get update
printf 'y\n' | sudo apt-get install hostapd dnsmasq nginx curl jq
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.1/install.sh | bash
source /root/.nvm/install.sh
nvm bash_completion
source ~/.bashrc
nvm install 8.17.0
nvm use 8.17.0
cd /home/pi/orobot-firmware
git pull
sudo npm i
sudo npm rebuild
sudo crontab /home/pi/orobot-firmware/reboot.cron
sudo echo 'net.ipv4.ip_forward=1' >> /etc/sysctl.conf
sudo service cron reload
sudo sysctl net.ipv4.ip_forward=1
./factory-reset.sh
