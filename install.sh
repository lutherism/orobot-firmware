#!/usr/bin/env bash

curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.1/install.sh | bash
export NVM_DIR="$HOME/.config/nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion.sh" ] && \. "$NVM_DIR/bash_completion"
nvm bash_completion
nvm install 8
nvm use 8
cd ~/orobot-firmware
npm i
sudo apt-get update
sudo apt-get install hostapd dnsmasq nginx
printf 'y\n' | sudo apt-get install hostapd dnsmasq
